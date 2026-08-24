import { describe, it, expect } from 'vitest';
import { filterVersions, parseVersionManifest } from '../src/main/minecraft.js';
import { RAW_MANIFEST } from './fixtures.js';

describe('manifest Mojang', () => {
  it('parsuje manifest i odrzuca wpisy o nieznanym typie', () => {
    const manifest = parseVersionManifest(RAW_MANIFEST);
    expect(manifest.latest.release).toBe('1.21.4');
    expect(manifest.latest.snapshot).toBe('25w02a');
    expect(manifest.versions).toHaveLength(5);
    expect(manifest.versions.some((v) => v.id === 'ZEPSUTA')).toBe(false);
  });

  it('odrzuca manifest o nieoczekiwanej strukturze', () => {
    expect(() => parseVersionManifest({})).toThrow();
    expect(() => parseVersionManifest(null)).toThrow();
    expect(() => parseVersionManifest({ versions: 'nie tablica' })).toThrow();
  });

  it('domyślnie pokazuje tylko wydania stabilne', () => {
    const { versions } = parseVersionManifest(RAW_MANIFEST);
    const filtered = filterVersions(versions);
    expect(filtered.map((v) => v.id)).toEqual(['1.21.4', '1.12.2']);
  });

  it('pokazuje snapshoty i wersje archiwalne po włączeniu filtrów', () => {
    const { versions } = parseVersionManifest(RAW_MANIFEST);
    expect(filterVersions(versions, { snapshots: true }).map((v) => v.id)).toContain('25w02a');
    const old = filterVersions(versions, { old: true }).map((v) => v.id);
    expect(old).toContain('b1.7.3');
    expect(old).toContain('a1.0.4');
  });

  it('filtruje po fragmencie nazwy', () => {
    const { versions } = parseVersionManifest(RAW_MANIFEST);
    expect(filterVersions(versions, { query: '1.12' }).map((v) => v.id)).toEqual(['1.12.2']);
  });
});
