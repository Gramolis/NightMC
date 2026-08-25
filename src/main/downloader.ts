/**
 * Kolejka pobierania NightMC.
 *
 * Cechy: równoległość z limitem, timeouty, ponawianie, anulowanie, wznawianie
 * przez nagłówek Range, pliki tymczasowe `.part`, atomowa podmiana, weryfikacja
 * SHA-1/SHA-256 i rozmiaru, pomiar prędkości i ETA.
 *
 * Instalacja NIE jest uznana za zakończoną, dopóki każdy plik nie przejdzie
 * weryfikacji - `run()` zwraca listę plików, które zawiodły.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LIMITS } from '../shared/constants.js';
import { httpRequest, NetError, withRetry } from './net.js';
import { log } from './logging.js';
import type { DownloadProgress, DownloadResult, DownloadTask } from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Sumy kontrolne                                                      */
/* ------------------------------------------------------------------ */

export async function hashFile(file: string, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export function hashBuffer(buf: Buffer, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  return crypto.createHash(algo).update(buf).digest('hex');
}

/** Sprawdza, czy istniejący plik zgadza się z oczekiwanym rozmiarem i sumą. */
export async function verifyFile(
  file: string,
  expect: { size?: number; sha1?: string; sha256?: string },
): Promise<boolean> {
  let st: fs.Stats;
  try {
    st = await fsp.stat(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (expect.size !== undefined && st.size !== expect.size) return false;
  if (expect.sha1) {
    if ((await hashFile(file, 'sha1')).toLowerCase() !== expect.sha1.toLowerCase()) return false;
  }
  if (expect.sha256) {
    if ((await hashFile(file, 'sha256')).toLowerCase() !== expect.sha256.toLowerCase()) return false;
  }
  // Brak jakiejkolwiek sumy i rozmiaru: uznajemy niepusty plik za poprawny.
  if (expect.size === undefined && !expect.sha1 && !expect.sha256) return st.size > 0;
  return true;
}

/* ------------------------------------------------------------------ */
/* Pomiar prędkości                                                    */
/* ------------------------------------------------------------------ */

class SpeedMeter {
  private samples: { t: number; bytes: number }[] = [];
  private windowMs = 4000;

  add(bytes: number): void {
    const now = Date.now();
    this.samples.push({ t: now, bytes });
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0]!.t < cutoff) this.samples.shift();
  }

  /** bajty na sekundę */
  get speed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const span = (Date.now() - first.t) / 1000;
    if (span <= 0.001) return 0;
    const total = this.samples.reduce((a, s) => a + s.bytes, 0);
    return total / span;
  }
}

/* ------------------------------------------------------------------ */
/* Kolejka                                                             */
/* ------------------------------------------------------------------ */

export interface QueueOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  onProgress?: (p: DownloadProgress) => void;
  /** Dodatkowe hosty dozwolone dla tej kolejki (np. CDN paczki). */
  allowExtraHosts?: string[];
  phase?: string;
}

/** Kolejki aktywne w tej chwili. Używane przez wspólny przycisk „Anuluj”. */
const activeQueues = new Set<DownloadQueue>();

/** Anuluje wszystkie trwające pobrania, niezależnie od ekranu, który je uruchomił. */
export function cancelActiveDownloads(): number {
  const count = activeQueues.size;
  for (const queue of activeQueues) queue.cancel();
  return count;
}

export class DownloadQueue {
  private tasks: DownloadTask[] = [];
  private abort = new AbortController();
  private meter = new SpeedMeter();
  private bytesDone = 0;
  private bytesTotal = 0;
  private filesDone = 0;
  private currentFile = '';
  private cancelled = false;
  private lastEmit = 0;

  constructor(private opts: QueueOptions = {}) {}

  add(task: DownloadTask): this {
    this.tasks.push(task);
    this.bytesTotal += task.size ?? 0;
    return this;
  }

  addAll(tasks: DownloadTask[]): this {
    for (const t of tasks) this.add(t);
    return this;
  }

  get size(): number {
    return this.tasks.length;
  }

  cancel(): void {
    this.cancelled = true;
    this.abort.abort();
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  private emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 120) return;
    this.lastEmit = now;
    const speed = this.meter.speed;
    const remaining = Math.max(0, this.bytesTotal - this.bytesDone);
    const filesProgress = this.tasks.length === 0 ? 1 : this.filesDone / this.tasks.length;
    const allSizesKnown = this.tasks.length > 0 && this.tasks.every((task) => (task.size ?? 0) > 0);
    const finished = this.tasks.length === 0 || this.filesDone >= this.tasks.length;
    // Dla dużego pojedynczego pliku licznik plików pozostaje na 0/1 aż do końca.
    // Gdy znamy rozmiary, pokazujemy więc rzeczywisty postęp odebranych bajtów.
    const progress = finished
      ? 1
      : allSizesKnown
        ? Math.min(0.999, Math.max(0, this.bytesDone / this.bytesTotal))
        : filesProgress;
    this.opts.onProgress?.({
      progress,
      filesDone: this.filesDone,
      filesTotal: this.tasks.length,
      bytesDone: this.bytesDone,
      bytesTotal: this.bytesTotal,
      speed,
      etaSeconds: speed > 1024 && remaining > 0 ? Math.round(remaining / speed) : -1,
      currentFile: this.currentFile,
      phase: this.opts.phase ?? 'Pobieranie',
    });
  }

  /** Uruchamia kolejkę. Zwraca wynik ze wszystkimi błędami. */
  async run(): Promise<DownloadResult> {
    const failed: DownloadResult['failed'] = [];
    const concurrency = Math.max(1, Math.min(this.opts.concurrency ?? LIMITS.defaultConcurrency, LIMITS.maxConcurrency));
    let cursor = 0;

    activeQueues.add(this);
    this.emit(true);

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.cancelled) return;
        const index = cursor++;
        const task = this.tasks[index];
        if (!task) return;
        this.currentFile = task.label ?? path.basename(task.dest);
        try {
          await this.fetchOne(task);
        } catch (e) {
          if (this.cancelled) return;
          failed.push({ url: task.url, dest: task.dest, error: (e as Error).message });
          log.error(`Nie udało się pobrać ${task.url}: ${(e as Error).message}`);
        }
        this.filesDone++;
        this.emit();
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, this.tasks.length || 1) }, worker));
      this.emit(true);
      return { ok: !this.cancelled && failed.length === 0, cancelled: this.cancelled, failed };
    } finally {
      activeQueues.delete(this);
    }
  }

  private async fetchOne(task: DownloadTask): Promise<void> {
    const expect = { size: task.size, sha1: task.sha1, sha256: task.sha256 };

    // 1. Plik już jest i przechodzi weryfikację - pomijamy (cache bibliotek).
    if (await verifyFile(task.dest, expect)) {
      this.bytesDone += task.size ?? (await fsp.stat(task.dest)).size;
      this.emit();
      return;
    }
    if (task.verifyOnly) throw new Error(`Plik nie przeszedł weryfikacji: ${task.dest}`);

    await fsp.mkdir(path.dirname(task.dest), { recursive: true });
    const part = `${task.dest}.part`;

    await withRetry(
      async (attempt) => {
        // Wznowienie: jeżeli mamy fragment i znamy docelowy rozmiar.
        let start = 0;
        if (attempt > 0 || fs.existsSync(part)) {
          try {
            const st = await fsp.stat(part);
            if (task.size === undefined || st.size < task.size) start = st.size;
            else await fsp.rm(part, { force: true });
          } catch {
            start = 0;
          }
        }

        const headers: Record<string, string> = { ...(task.headers ?? {}) };
        if (start > 0) headers['Range'] = `bytes=${start}-`;

        const res = await httpRequest(task.url, {
          headers,
          timeoutMs: this.opts.timeoutMs ?? LIMITS.downloadTimeoutMs,
          signal: this.abort.signal,
          allowExtraHosts: this.opts.allowExtraHosts,
        });

        if (!res.ok && res.status !== 206) {
          throw new NetError(`HTTP ${res.status}`, res.status, task.url);
        }
        // Serwer zignorował Range - zaczynamy od zera.
        const resuming = start > 0 && res.status === 206;
        if (start > 0 && !resuming) {
          await fsp.rm(part, { force: true });
          start = 0;
        }
        if (!res.body) throw new NetError('Pusta odpowiedź serwera', res.status, task.url);

        const out = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
        const source = Readable.fromWeb(res.body as any);
        source.on('data', (chunk: Buffer) => {
          this.bytesDone += chunk.length;
          this.meter.add(chunk.length);
          this.emit();
        });
        await pipeline(source, out);

        // 2. Weryfikacja przed podmianą.
        if (!(await verifyFile(part, expect))) {
          const actual = (await fsp.stat(part)).size;
          await fsp.rm(part, { force: true });
          throw new Error(
            task.sha1 || task.sha256
              ? `Suma kontrolna się nie zgadza (${task.label ?? path.basename(task.dest)})`
              : `Nieoczekiwany rozmiar pliku (${actual} B, oczekiwano ${task.size} B)`,
          );
        }

        // 3. Atomowa podmiana.
        await fsp.rm(task.dest, { force: true });
        await fsp.rename(part, task.dest);
      },
      { retries: this.opts.retries ?? LIMITS.retries, signal: this.abort.signal, label: task.label ?? task.url },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Pomocnicze                                                          */
/* ------------------------------------------------------------------ */

/** Pobiera pojedynczy plik do pamięci (małe pliki: manifesty, ikony). */
export async function downloadToBuffer(
  url: string,
  opts: { maxBytes?: number; headers?: Record<string, string>; allowExtraHosts?: string[]; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const res = await httpRequest(url, {
    headers: opts.headers,
    timeoutMs: LIMITS.downloadTimeoutMs,
    allowExtraHosts: opts.allowExtraHosts,
    signal: opts.signal,
  });
  if (!res.ok) throw new NetError(`HTTP ${res.status} dla ${url}`, res.status, url);
  const max = opts.maxBytes ?? LIMITS.maxJsonBytes;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new NetError(`Plik przekracza limit ${max} B`);
  return buf;
}

/** Zapisuje bufor atomowo. */
export async function writeAtomic(dest: string, data: Buffer | string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rm(dest, { force: true });
  await fsp.rename(tmp, dest);
}

/** Formatuje bajty do postaci czytelnej dla człowieka. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
