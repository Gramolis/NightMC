import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractArchive,
  inspectArchive,
  listArchive,
  readArchiveEntry,
  sanitizeEntryName,
  UnsafeArchiveError,
} from '../src/main/zipsafe.js';
import { isInside, sanitizeFileName } from '../src/main/paths.js';

let tmp = '';

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nightmc-zip-'));
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function makeZip(entries: { name: string; data?: string; attr?: number }[]): string {
  const zip = new AdmZip();
  for (const e of entries) zip.addFile(e.name, Buffer.from(e.data ?? 'x'), '', e.attr);
  const file = path.join(tmp, `test-${Math.random().toString(36).slice(2)}.zip`);
  zip.writeZip(file);
  return file;
}

/** AdmZip normalizuje nazwy przy tworzeniu archiwum, więc złośliwą nazwę
 * wstawiamy bezpośrednio do lokalnego i centralnego nagłówka ZIP. */
function makeRawNamedZip(safeName: string, rawName: string, data = 'x'): string {
  if (Buffer.byteLength(safeName) !== Buffer.byteLength(rawName)) throw new Error('Nazwy muszą mieć tę samą długość');
  const zip = new AdmZip();
  zip.addFile(safeName, Buffer.from(data));
  const buffer = zip.toBuffer();
  const safe = Buffer.from(safeName);
  const raw = Buffer.from(rawName);
  let offset = 0;
  let replacements = 0;
  while ((offset = buffer.indexOf(safe, offset)) !== -1) {
    raw.copy(buffer, offset);
    offset += raw.length;
    replacements++;
  }
  if (replacements !== 2) throw new Error(`Nieoczekiwana liczba nazw wpisu w ZIP: ${replacements}`);
  const file = path.join(tmp, `test-raw-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, buffer);
  return file;
}

/** Ustawia uniksowy typ wpisu S_IFLNK w zewnętrznych atrybutach
 * centralnego nagłówka ZIP. */
function makeSymlinkZip(name: string, target: string): string {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(target));
  const buffer = zip.toBuffer();
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (central < 0) throw new Error('Brak centralnego nagłówka ZIP');
  buffer[central + 5] = 3; // system tworzący: Unix
  buffer.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38);
  const file = path.join(tmp, `test-link-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, buffer);
  return file;
}

describe('normalizacja nazw wpisów', () => {
  it('przepuszcza zwykłe ścieżki', () => {
    expect(sanitizeEntryName('mods/fabric-api-0.100.jar')).toBe('mods/fabric-api-0.100.jar');
    expect(sanitizeEntryName('config\\some\\file.toml')).toBe('config/some/file.toml');
    expect(sanitizeEntryName('./a/./b.txt')).toBe('a/b.txt');
  });

  it('blokuje Zip Slip przez ../', () => {
    expect(() => sanitizeEntryName('../evil.jar')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('mods/../../../evil.jar')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('a/../../b')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('..\\..\\Windows\\System32\\evil.dll')).toThrow(UnsafeArchiveError);
  });

  it('blokuje ścieżki absolutne, litery dysków i UNC', () => {
    expect(() => sanitizeEntryName('/etc/passwd')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('C:/Windows/evil.dll')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('C:\\Windows\\evil.dll')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('//serwer/udzial/evil.dll')).toThrow(UnsafeArchiveError);
  });

  it('blokuje znaki sterujące i zarezerwowane nazwy Windows', () => {
    expect(() => sanitizeEntryName('a\u0000b')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('CON')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('mods/NUL.jar')).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('COM1.txt')).toThrow(UnsafeArchiveError);
  });

  it('blokuje absurdalnie długie nazwy', () => {
    expect(() => sanitizeEntryName('a'.repeat(2000))).toThrow(UnsafeArchiveError);
    expect(() => sanitizeEntryName('')).toThrow(UnsafeArchiveError);
  });
});

describe('bezpieczne rozpakowywanie', () => {
  it('rozpakowuje zwykłe archiwum', async () => {
    const zip = makeZip([
      { name: 'mods/a.jar', data: 'AAA' },
      { name: 'config/b.toml', data: 'BBB' },
    ]);
    const out = path.join(tmp, 'out');
    const res = await extractArchive(zip, out);
    expect(res.files).toBe(2);
    expect(await fsp.readFile(path.join(out, 'mods', 'a.jar'), 'utf8')).toBe('AAA');
    expect(await fsp.readFile(path.join(out, 'config', 'b.toml'), 'utf8')).toBe('BBB');
  });

  it('odmawia rozpakowania archiwum z Zip Slip i nie tworzy pliku poza katalogiem', async () => {
    const zip = makeRawNamedZip('00/aa/wykradzione.txt', '../../wykradzione.txt');
    const out = path.join(tmp, 'out2');
    await expect(extractArchive(zip, out)).rejects.toThrow(UnsafeArchiveError);
    expect(fs.existsSync(path.join(tmp, 'wykradzione.txt'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(tmp), 'wykradzione.txt'))).toBe(false);
  });

  it('odrzuca dowiązania symboliczne w archiwum', async () => {
    const zip = makeSymlinkZip('link', '/etc/passwd');
    await expect(extractArchive(zip, path.join(tmp, 'out3'))).rejects.toThrow(/dowiązanie symboliczne/);
  });

  it('obsługuje stripPrefix (overrides paczki)', async () => {
    const zip = makeZip([
      { name: 'overrides/config/x.cfg', data: 'C' },
      { name: 'overrides/mods/y.jar', data: 'M' },
      { name: 'modrinth.index.json', data: '{}' },
    ]);
    const out = path.join(tmp, 'out4');
    const res = await extractArchive(zip, out, { stripPrefix: 'overrides' });
    expect(res.files).toBe(2);
    expect(fs.existsSync(path.join(out, 'config', 'x.cfg'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'modrinth.index.json'))).toBe(false);
  });

  it('respektuje wykluczenia (natives: META-INF)', async () => {
    const zip = makeZip([
      { name: 'META-INF/MANIFEST.MF', data: 'x' },
      { name: 'lwjgl.dll', data: 'DLL' },
    ]);
    const out = path.join(tmp, 'out5');
    const res = await extractArchive(zip, out, { exclude: ['META-INF/'] });
    expect(res.files).toBe(1);
    expect(fs.existsSync(path.join(out, 'lwjgl.dll'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'META-INF'))).toBe(false);
  });

  it('inspectArchive liczy rozmiar przed rozpakowaniem', () => {
    const zip = makeZip([{ name: 'a.txt', data: 'x'.repeat(1000) }]);
    const info = inspectArchive(zip);
    expect(info.totalBytes).toBe(1000);
    expect(info.entries[0]!.name).toBe('a.txt');
  });

  it('czyta pojedynczy wpis bez zapisu na dysk', () => {
    const zip = makeZip([{ name: 'manifest.json', data: '{"ok":true}' }]);
    expect(readArchiveEntry(zip, 'manifest.json')!.toString('utf8')).toBe('{"ok":true}');
    expect(readArchiveEntry(zip, 'brak.json')).toBeNull();
    expect(listArchive(zip)).toEqual(['manifest.json']);
  });

  it('odrzuca wpis przekraczający limit odczytu', () => {
    const zip = makeZip([{ name: 'big.bin', data: 'x'.repeat(5000) }]);
    expect(() => readArchiveEntry(zip, 'big.bin', 100)).toThrow(UnsafeArchiveError);
  });
});

describe('ochrona ścieżek', () => {
  it('isInside wykrywa wyjście poza katalog', () => {
    expect(isInside('/a/b', '/a/b/c/d.txt')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/c/d.txt')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });

  it('sanitizeFileName usuwa znaki zabronione w Windows', () => {
    expect(sanitizeFileName('moja:paczka?')).toBe('moja_paczka_');
    expect(sanitizeFileName('a/b\\c')).toBe('a_b_c');
    expect(sanitizeFileName('...')).toBe('_');
    expect(sanitizeFileName('   ')).toBe('bez_nazwy');
    // Myślniki i spacje w środku są dozwolone.
    expect(sanitizeFileName('Moja paczka 1.20')).toBe('Moja paczka 1.20');
  });
});
