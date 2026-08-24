import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectPackKind,
  loaderFromCurseForgeId,
  loaderFromMrpackDeps,
  parseCurseForgeManifest,
  parseMrpackIndex,
  PackError,
  previewCurseForge,
  previewMrpack,
  validatePackFilePath,
} from '../src/main/packs.js';
import { UnsafeArchiveError } from '../src/main/zipsafe.js';

let tmp = '';
beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nightmc-pack-'));
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const MRPACK_INDEX = {
  formatVersion: 1,
  game: 'minecraft',
  versionId: '2.1.0',
  name: 'Nocna Paczka',
  files: [
    {
      path: 'mods/sodium.jar',
      hashes: { sha1: 'a'.repeat(40) },
      downloads: ['https://cdn.modrinth.com/data/AABB/versions/1/sodium.jar'],
      fileSize: 800000,
    },
    {
      path: 'mods/serwerowy.jar',
      hashes: { sha1: 'b'.repeat(40) },
      env: { client: 'unsupported', server: 'required' },
      downloads: ['https://cdn.modrinth.com/data/CCDD/versions/1/serwerowy.jar'],
      fileSize: 1000,
    },
    {
      path: 'mods/podejrzany.jar',
      hashes: { sha1: 'c'.repeat(40) },
      downloads: ['https://zloszliwy.example.com/malware.jar'],
      fileSize: 10,
    },
  ],
  dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.9' },
};

const CF_MANIFEST = {
  minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.20', primary: true }] },
  manifestType: 'minecraftModpack',
  manifestVersion: 1,
  name: 'Paczka CF',
  version: '1.4.0',
  author: 'ktoś',
  files: [
    { projectID: 238222, fileID: 4712868, required: true },
    { projectID: 306612, fileID: 4661952, required: true },
  ],
  overrides: 'overrides',
};

function writeZip(entries: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.from(data));
  const file = path.join(tmp, `p-${Math.random().toString(36).slice(2)}.zip`);
  zip.writeZip(file);
  return file;
}

describe('rozpoznawanie formatu paczki', () => {
  it('rozpoznaje po zawartości, nie po rozszerzeniu', () => {
    expect(detectPackKind(writeZip({ 'modrinth.index.json': '{}' }))).toBe('mrpack');
    expect(detectPackKind(writeZip({ 'manifest.json': '{}' }))).toBe('curseforge');
  });

  it('odrzuca archiwum, które nie jest paczką', () => {
    expect(() => detectPackKind(writeZip({ 'cokolwiek.txt': 'x' }))).toThrow(PackError);
  });
});

describe('mrpack', () => {
  it('waliduje indeks', () => {
    expect(parseMrpackIndex(MRPACK_INDEX).name).toBe('Nocna Paczka');
    expect(() => parseMrpackIndex({ formatVersion: 99, files: [], dependencies: {} })).toThrow(PackError);
    expect(() => parseMrpackIndex({ formatVersion: 1, dependencies: {} })).toThrow(PackError);
    expect(() => parseMrpackIndex({ formatVersion: 1, files: [] })).toThrow(PackError);
  });

  it('mapuje zależności na loader NightMC', () => {
    expect(loaderFromMrpackDeps({ minecraft: '1.21.1', 'fabric-loader': '0.16.9' })).toEqual({
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mcVersion: '1.21.1',
    });
    expect(loaderFromMrpackDeps({ minecraft: '1.20.1', forge: '47.2.20' })).toEqual({
      loader: 'forge',
      loaderVersion: '1.20.1-47.2.20',
      mcVersion: '1.20.1',
    });
    expect(loaderFromMrpackDeps({ minecraft: '1.21', neoforge: '21.0.100' }).loader).toBe('neoforge');
    expect(loaderFromMrpackDeps({ minecraft: '1.21' }).loader).toBe('vanilla');
  });

  it('odrzuca paczki Quilt z czytelnym komunikatem', () => {
    expect(() => loaderFromMrpackDeps({ minecraft: '1.21', 'quilt-loader': '0.26' })).toThrow(/Quilt/);
  });

  it('wymaga wersji Minecrafta', () => {
    expect(() => loaderFromMrpackDeps({ 'fabric-loader': '0.16.9' })).toThrow(PackError);
  });

  it('blokuje ścieżki wychodzące poza katalog instancji', () => {
    expect(validatePackFilePath('mods/a.jar')).toBe('mods/a.jar');
    expect(validatePackFilePath('config\\sub\\a.toml')).toBe('config/sub/a.toml');
    expect(() => validatePackFilePath('../../evil.jar')).toThrow(UnsafeArchiveError);
    expect(() => validatePackFilePath('/etc/passwd')).toThrow(UnsafeArchiveError);
    expect(() => validatePackFilePath('C:/Windows/evil.dll')).toThrow(UnsafeArchiveError);
  });

  it('podgląd pomija pliki serwerowe i ostrzega o obcych hostach', () => {
    const file = writeZip({
      'modrinth.index.json': JSON.stringify(MRPACK_INDEX),
      'overrides/config/a.toml': 'x',
      'overrides/mods/lokalny.jar': 'y',
    });
    const preview = previewMrpack(file);
    expect(preview.kind).toBe('mrpack');
    expect(preview.mcVersion).toBe('1.21.1');
    expect(preview.loader).toBe('fabric');
    expect(preview.overrideCount).toBe(2);
    // Plik `client: unsupported` nie jest wymagany.
    expect(preview.requiredFiles.map((f) => f.name)).not.toContain('mods/serwerowy.jar');
    // Plik z niedozwolonego hosta jest oznaczony ostrzeżeniem i nie ma URL-a.
    const suspicious = preview.requiredFiles.find((f) => f.name === 'mods/podejrzany.jar');
    expect(suspicious?.url).toBeUndefined();
    expect(preview.warnings.join(' ')).toContain('podejrzany.jar');
  });
});

describe('CurseForge', () => {
  it('waliduje manifest', () => {
    expect(parseCurseForgeManifest(CF_MANIFEST).name).toBe('Paczka CF');
    expect(() => parseCurseForgeManifest({ manifestType: 'x' })).toThrow(PackError);
  });

  it('mapuje identyfikator loadera', () => {
    expect(loaderFromCurseForgeId('forge-47.2.20', '1.20.1')).toEqual({ loader: 'forge', loaderVersion: '1.20.1-47.2.20' });
    expect(loaderFromCurseForgeId('fabric-0.16.9', '1.21.1')).toEqual({ loader: 'fabric', loaderVersion: '0.16.9' });
    expect(loaderFromCurseForgeId('neoforge-21.0.100', '1.21')).toEqual({ loader: 'neoforge', loaderVersion: '21.0.100' });
    expect(loaderFromCurseForgeId('cokolwiek', '1.21').loader).toBe('vanilla');
  });

  it('podgląd pokazuje listę brakujących plików i wyjaśnia brak klucza API', () => {
    const file = writeZip({
      'manifest.json': JSON.stringify(CF_MANIFEST),
      'overrides/config/x.cfg': 'x',
    });
    const preview = previewCurseForge(file);
    expect(preview.kind).toBe('curseforge');
    expect(preview.mcVersion).toBe('1.20.1');
    expect(preview.loader).toBe('forge');
    expect(preview.requiredFiles).toHaveLength(2);
    expect(preview.overrideCount).toBe(1);
    expect(preview.warnings.join(' ')).toContain('klucza API');
  });
});
