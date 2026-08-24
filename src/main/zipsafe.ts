/**
 * Bezpieczne rozpakowywanie archiwów ZIP.
 *
 * Blokujemy:
 *  - Zip Slip (`../`, ścieżki absolutne, litery dysków, ścieżki UNC),
 *  - dowiązania symboliczne w archiwum,
 *  - bomby ZIP (limit rozmiaru po rozpakowaniu i współczynnika kompresji),
 *  - archiwa z absurdalną liczbą wpisów,
 *  - nadpisanie plików poza katalogiem docelowym.
 *
 * Rozmiar po rozpakowaniu jest liczony ZANIM cokolwiek trafi na dysk.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { LIMITS } from '../shared/constants.js';
import { isInside } from './paths.js';

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeArchiveError';
  }
}

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

/** Normalizuje nazwę wpisu i odrzuca wszystko, co próbuje uciec z katalogu. */
export function sanitizeEntryName(entryName: string): string {
  const name = entryName.replace(/\\/g, '/');

  if (name.length === 0) throw new UnsafeArchiveError('Pusta nazwa wpisu w archiwum');
  if (name.length > 1024) throw new UnsafeArchiveError(`Zbyt długa nazwa wpisu: ${name.slice(0, 60)}...`);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) throw new UnsafeArchiveError('Nazwa wpisu zawiera znaki sterujące');
  if (name.startsWith('/')) throw new UnsafeArchiveError(`Ścieżka absolutna w archiwum: ${name}`);
  if (/^[A-Za-z]:/.test(name)) throw new UnsafeArchiveError(`Ścieżka z literą dysku w archiwum: ${name}`);
  if (name.startsWith('//') || name.startsWith('\\\\')) throw new UnsafeArchiveError(`Ścieżka UNC w archiwum: ${name}`);

  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  for (const part of parts) {
    if (part === '..') throw new UnsafeArchiveError(`Próba wyjścia poza katalog (Zip Slip): ${name}`);
    // Zarezerwowane nazwy urządzeń Windows.
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)) {
      throw new UnsafeArchiveError(`Zarezerwowana nazwa systemowa w archiwum: ${part}`);
    }
  }
  return parts.join('/');
}

function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  // Górne 16 bitów `attr` to tryb uniksowy; 0xA000 = S_IFLNK.
  const mode = (entry.header.attr ?? 0) >>> 16;
  return (mode & 0xf000) === 0xa000;
}

/** Zwraca listę wpisów wraz z informacją o rozmiarze - bez zapisu na dysk. */
export function inspectArchive(zipPath: string): { entries: ZipEntryInfo[]; totalBytes: number } {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  if (entries.length > LIMITS.maxZipEntries) {
    throw new UnsafeArchiveError(`Archiwum ma zbyt wiele wpisów (${entries.length})`);
  }
  let totalBytes = 0;
  const list: ZipEntryInfo[] = entries.map((e) => {
    const size = Number(e.header.size ?? 0);
    const compressed = Number(e.header.compressedSize ?? 0);
    totalBytes += size;
    if (compressed > 0 && size / compressed > LIMITS.maxCompressionRatio) {
      throw new UnsafeArchiveError(
        `Podejrzany współczynnik kompresji (${Math.round(size / compressed)}x) dla "${e.entryName}" - możliwa bomba ZIP`,
      );
    }
    return {
      name: e.entryName,
      size,
      compressedSize: compressed,
      isDirectory: e.isDirectory,
      isSymlink: isSymlinkEntry(e),
    };
  });
  if (totalBytes > LIMITS.maxExtractBytes) {
    throw new UnsafeArchiveError(
      `Archiwum po rozpakowaniu zajęłoby ${Math.round(totalBytes / 1024 / 1024)} MiB - przekroczono limit`,
    );
  }
  return { entries: list, totalBytes };
}

export interface ExtractOptions {
  /** Rozpakuj tylko wpisy z tym prefiksem (np. "overrides/"), usuwając prefiks. */
  stripPrefix?: string;
  /** Pomiń wpisy pasujące do dowolnego z prefiksów (np. "META-INF/"). */
  exclude?: string[];
  /** Nadpisuj istniejące pliki. */
  overwrite?: boolean;
  /** Wywoływane po każdym wypakowanym pliku. */
  onFile?: (relPath: string, bytes: number) => void;
}

/**
 * Rozpakowuje archiwum do `destRoot`. `destRoot` MUSI istnieć lub zostanie utworzony.
 * Każda ścieżka jest weryfikowana dwa razy: przez sanitizeEntryName i przez isInside.
 */
export async function extractArchive(
  zipPath: string,
  destRoot: string,
  opts: ExtractOptions = {},
): Promise<{ files: number; bytes: number }> {
  inspectArchive(zipPath);

  const zip = new AdmZip(zipPath);
  const root = path.resolve(destRoot);
  await fsp.mkdir(root, { recursive: true });

  let files = 0;
  let bytes = 0;

  for (const entry of zip.getEntries()) {
    if (isSymlinkEntry(entry)) {
      throw new UnsafeArchiveError(`Archiwum zawiera dowiązanie symboliczne: ${entry.entryName}`);
    }

    let rel = sanitizeEntryName(entry.entryName);
    if (rel === '') continue;

    if (opts.stripPrefix) {
      const prefix = opts.stripPrefix.replace(/\\/g, '/').replace(/\/*$/, '/');
      if (!rel.startsWith(prefix)) continue;
      rel = rel.slice(prefix.length);
      if (rel === '') continue;
    }

    if (opts.exclude?.some((p) => rel === p.replace(/\/*$/, '') || rel.startsWith(p.replace(/\/*$/, '') + '/'))) {
      continue;
    }

    const target = path.resolve(root, ...rel.split('/'));
    if (!isInside(root, target)) {
      throw new UnsafeArchiveError(`Wpis próbuje zapisać poza katalogiem docelowym: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }

    if (!opts.overwrite && fs.existsSync(target)) continue;

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const data = entry.getData();
    await fsp.writeFile(target, data);
    files++;
    bytes += data.length;
    opts.onFile?.(rel, data.length);
  }

  return { files, bytes };
}

/** Odczytuje pojedynczy plik z archiwum jako bufor (bez zapisu na dysk). */
export function readArchiveEntry(zipPath: string, entryName: string, maxBytes = 16 * 1024 * 1024): Buffer | null {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  if (Number(entry.header.size ?? 0) > maxBytes) {
    throw new UnsafeArchiveError(`Wpis "${entryName}" przekracza limit ${maxBytes} B`);
  }
  return entry.getData();
}

/** Lista nazw wpisów (do podglądu paczek). */
export function listArchive(zipPath: string): string[] {
  return new AdmZip(zipPath).getEntries().map((e) => e.entryName);
}

/** Rozpakowuje natives z uwzględnieniem wykluczeń z metadanych wersji. */
export async function extractNatives(
  jarPath: string,
  destDir: string,
  excludes: string[],
): Promise<number> {
  const defaults = ['META-INF/'];
  const result = await extractArchive(jarPath, destDir, {
    exclude: [...defaults, ...excludes],
    overwrite: true,
  });
  return result.files;
}
