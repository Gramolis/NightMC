import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DownloadQueue, hashBuffer, hashFile, verifyFile, writeAtomic } from '../src/main/downloader.js';
import { isAllowedUrl } from '../src/main/net.js';

const PAYLOAD = Buffer.from('NightMC testowa zawartość pliku — '.repeat(500), 'utf8');
const SHA1 = hashBuffer(PAYLOAD, 'sha1');
const SHA256 = hashBuffer(PAYLOAD, 'sha256');

let server: http.Server;
let base = '';
let tmp = '';
/** Liczba żądań na dany zasób - do sprawdzenia ponawiania. */
const hits: Record<string, number> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;

    if (url.pathname === '/ok') {
      const range = req.headers['range'];
      if (range) {
        const start = Number(/bytes=(\d+)-/.exec(String(range))?.[1] ?? 0);
        const slice = PAYLOAD.subarray(start);
        res.writeHead(206, {
          'Content-Length': String(slice.length),
          'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        });
        res.end(slice);
        return;
      }
      res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) });
      res.end(PAYLOAD);
      return;
    }

    if (url.pathname === '/corrupt') {
      res.writeHead(200).end(Buffer.from('to nie jest oczekiwana zawartość'));
      return;
    }

    if (url.pathname === '/flaky') {
      // Pierwsze dwie próby padają, trzecia się udaje.
      if (hits['/flaky']! < 3) {
        res.writeHead(500).end('błąd serwera');
        return;
      }
      res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) }).end(PAYLOAD);
      return;
    }

    if (url.pathname === '/norange') {
      // Serwer ignoruje Range i zawsze oddaje całość ze statusem 200.
      res.writeHead(200, { 'Content-Length': String(PAYLOAD.length) }).end(PAYLOAD);
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nightmc-dl-'));
});

const extra = ['127.0.0.1'];

describe('sumy kontrolne', () => {
  it('liczy SHA-1 i SHA-256 pliku', async () => {
    const file = path.join(tmp, 'a.bin');
    await writeAtomic(file, PAYLOAD);
    expect(await hashFile(file, 'sha1')).toBe(SHA1);
    expect(await hashFile(file, 'sha256')).toBe(SHA256);
  });

  it('weryfikuje rozmiar i sumę', async () => {
    const file = path.join(tmp, 'a.bin');
    await writeAtomic(file, PAYLOAD);
    expect(await verifyFile(file, { size: PAYLOAD.length, sha1: SHA1 })).toBe(true);
    expect(await verifyFile(file, { sha1: 'f'.repeat(40) })).toBe(false);
    expect(await verifyFile(file, { size: 1 })).toBe(false);
    expect(await verifyFile(path.join(tmp, 'brak.bin'), { sha1: SHA1 })).toBe(false);
  });

  it('akceptuje SHA-256, gdy jest dostępne', async () => {
    const file = path.join(tmp, 'a.bin');
    await writeAtomic(file, PAYLOAD);
    expect(await verifyFile(file, { sha256: SHA256 })).toBe(true);
    expect(await verifyFile(file, { sha256: '0'.repeat(64) })).toBe(false);
  });
});

describe('kolejka pobierania', () => {
  it('pobiera plik i weryfikuje sumę', async () => {
    const dest = path.join(tmp, 'sub', 'ok.bin');
    const q = new DownloadQueue({ allowExtraHosts: extra, concurrency: 2 });
    q.add({ id: '1', url: `${base}/ok`, dest, sha1: SHA1, size: PAYLOAD.length });
    const res = await q.run();
    expect(res.ok).toBe(true);
    expect(await hashFile(dest, 'sha1')).toBe(SHA1);
    // Plik tymczasowy nie może zostać.
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('raportuje błąd, gdy suma się nie zgadza, i nie zostawia pliku', async () => {
    const dest = path.join(tmp, 'corrupt.bin');
    const q = new DownloadQueue({ allowExtraHosts: extra, retries: 1 });
    q.add({ id: '1', url: `${base}/corrupt`, dest, sha1: SHA1 });
    const res = await q.run();
    expect(res.ok).toBe(false);
    expect(res.failed[0]!.error).toContain('Suma kontrolna');
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('wznawia pobieranie z istniejącego pliku .part', async () => {
    const dest = path.join(tmp, 'resume.bin');
    const part = `${dest}.part`;
    const half = Math.floor(PAYLOAD.length / 2);
    await fsp.writeFile(part, PAYLOAD.subarray(0, half));

    const q = new DownloadQueue({ allowExtraHosts: extra });
    q.add({ id: '1', url: `${base}/ok`, dest, sha1: SHA1, size: PAYLOAD.length });
    const res = await q.run();
    expect(res.ok).toBe(true);
    expect(await hashFile(dest, 'sha1')).toBe(SHA1);
  });

  it('radzi sobie, gdy serwer ignoruje nagłówek Range', async () => {
    const dest = path.join(tmp, 'norange.bin');
    await fsp.writeFile(`${dest}.part`, PAYLOAD.subarray(0, 100));
    const q = new DownloadQueue({ allowExtraHosts: extra });
    q.add({ id: '1', url: `${base}/norange`, dest, sha1: SHA1, size: PAYLOAD.length });
    const res = await q.run();
    expect(res.ok).toBe(true);
    expect(await hashFile(dest, 'sha1')).toBe(SHA1);
  });

  it('ponawia po błędzie 5xx', async () => {
    const dest = path.join(tmp, 'flaky.bin');
    const q = new DownloadQueue({ allowExtraHosts: extra, retries: 4 });
    q.add({ id: '1', url: `${base}/flaky`, dest, sha1: SHA1, size: PAYLOAD.length });
    const res = await q.run();
    expect(res.ok).toBe(true);
    expect(hits['/flaky']).toBeGreaterThanOrEqual(3);
  });

  it('pomija pliki, które już przeszły weryfikację (cache bibliotek)', async () => {
    const dest = path.join(tmp, 'cached.bin');
    await writeAtomic(dest, PAYLOAD);
    const before = hits['/ok'] ?? 0;
    const q = new DownloadQueue({ allowExtraHosts: extra });
    q.add({ id: '1', url: `${base}/ok`, dest, sha1: SHA1, size: PAYLOAD.length });
    const res = await q.run();
    expect(res.ok).toBe(true);
    expect(hits['/ok'] ?? 0).toBe(before);
  });

  it('anulowanie kończy kolejkę bez pobrania', async () => {
    const q = new DownloadQueue({ allowExtraHosts: extra });
    for (let i = 0; i < 20; i++) {
      q.add({ id: String(i), url: `${base}/ok`, dest: path.join(tmp, `c${i}.bin`), sha1: SHA1, size: PAYLOAD.length });
    }
    const promise = q.run();
    q.cancel();
    const res = await promise;
    expect(res.cancelled).toBe(true);
    expect(res.ok).toBe(false);
  });

  it('raportuje postęp z prędkością i licznikiem plików', async () => {
    const events: number[] = [];
    const q = new DownloadQueue({
      allowExtraHosts: extra,
      onProgress: (p) => events.push(p.filesDone),
    });
    q.add({ id: '1', url: `${base}/ok`, dest: path.join(tmp, 'p.bin'), sha1: SHA1, size: PAYLOAD.length });
    await q.run();
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBe(1);
  });

  it('blokuje adresy spoza dozwolonej listy hostów', async () => {
    const q = new DownloadQueue({});
    q.add({ id: '1', url: 'https://zloszliwy.example.com/plik.jar', dest: path.join(tmp, 'x.bin') });
    const res = await q.run();
    expect(res.ok).toBe(false);
    expect(res.failed[0]!.error).toContain('polityk');
  });
});

describe('polityka adresów', () => {
  it('przepuszcza oficjalne hosty po https', () => {
    expect(isAllowedUrl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toBe(true);
    expect(isAllowedUrl('https://cdn.modrinth.com/data/abc/versions/1/mod.jar')).toBe(true);
    expect(isAllowedUrl('https://maven.neoforged.net/releases/x.jar')).toBe(true);
  });

  it('odrzuca http, obce hosty i adresy z danymi logowania', () => {
    expect(isAllowedUrl('http://piston-meta.mojang.com/x.json')).toBe(false);
    expect(isAllowedUrl('https://evil.com/x.jar')).toBe(false);
    expect(isAllowedUrl('https://user:pass@api.modrinth.com/v2/search')).toBe(false);
    expect(isAllowedUrl('nie-adres')).toBe(false);
    // Podszywanie się pod dozwolony host jako prefiks nazwy.
    expect(isAllowedUrl('https://api.modrinth.com.evil.com/x')).toBe(false);
  });

  it('zapisuje pliki atomowo', async () => {
    const dest = path.join(tmp, 'atomic', 'f.bin');
    await writeAtomic(dest, 'abc');
    expect(await fsp.readFile(dest, 'utf8')).toBe('abc');
    await writeAtomic(dest, 'xyz');
    expect(await fsp.readFile(dest, 'utf8')).toBe('xyz');
    const leftovers = (await fsp.readdir(path.dirname(dest))).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
    expect(crypto.createHash('sha1').update('xyz').digest('hex')).toBe(await hashFile(dest, 'sha1'));
  });
});
