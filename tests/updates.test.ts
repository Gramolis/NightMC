import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { compareVersions, verifySignature } from '../src/main/updates.js';
import { parseNews, sanitizeUrl } from '../src/main/news.js';

describe('porównywanie wersji', () => {
  it('rozpoznaje nowszą wersję', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  it('ignoruje prefiks v', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('v1.2.1', 'v1.2.0')).toBeGreaterThan(0);
  });

  it('rozpoznaje starszą i równą', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('radzi sobie z różną liczbą członów', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.2', '1.1.9')).toBeGreaterThan(0);
  });
});

describe('podpis Ed25519 aktualizacji', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const hash = crypto.createHash('sha256').update('zawartość NightMC.exe').digest('hex');

  it('akceptuje poprawny podpis', () => {
    const sig = crypto.sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
    expect(verifySignature(hash, sig, rawPublic)).toBe(true);
  });

  it('odrzuca podpis innego pliku', () => {
    const other = crypto.createHash('sha256').update('podmieniony plik').digest('hex');
    const sig = crypto.sign(null, Buffer.from(other, 'hex'), privateKey).toString('base64');
    expect(verifySignature(hash, sig, rawPublic)).toBe(false);
  });

  it('odrzuca podpis obcym kluczem', () => {
    const evil = crypto.generateKeyPairSync('ed25519');
    const sig = crypto.sign(null, Buffer.from(hash, 'hex'), evil.privateKey).toString('base64');
    expect(verifySignature(hash, sig, rawPublic)).toBe(false);
  });

  it('nie wywraca się na śmieciowych danych', () => {
    expect(verifySignature(hash, 'niepodpis', rawPublic)).toBe(false);
    expect(verifySignature(hash, 'abc', 'niepoprawnyklucz')).toBe(false);
  });
});

describe('aktualności', () => {
  it('przepuszcza wyłącznie https', () => {
    expect(sanitizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeUrl('http://example.com/a')).toBeUndefined();
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('data:text/html,<script>')).toBeUndefined();
    expect(sanitizeUrl('file:///C:/Windows')).toBeUndefined();
    expect(sanitizeUrl(123)).toBeUndefined();
  });

  it('usuwa znaczniki HTML z treści', () => {
    const items = parseNews({
      items: [
        {
          id: 'n1',
          title: 'NightMC <script>alert(1)</script> 1.0',
          description: '<b>Pierwsze</b> wydanie<img src=x onerror=alert(1)>',
          url: 'https://example.com/changelog',
          publishedAt: '2026-01-01T12:00:00Z',
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).not.toContain('<');
    expect(items[0]!.description).toBe('Pierwsze wydanie');
  });

  it('sortuje od najnowszych i pomija wpisy bez tytułu', () => {
    const items = parseNews({
      items: [
        { id: 'a', title: 'Starsze', publishedAt: '2025-01-01T00:00:00Z' },
        { id: 'b', title: '', publishedAt: '2026-01-01T00:00:00Z' },
        { id: 'c', title: 'Nowsze', publishedAt: '2026-06-01T00:00:00Z' },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['c', 'a']);
  });

  it('zwraca pustą listę dla śmieci zamiast rzucać', () => {
    expect(parseNews(null)).toEqual([]);
    expect(parseNews({})).toEqual([]);
    expect(parseNews({ items: 'nie tablica' })).toEqual([]);
  });

  it('ogranicza liczbę wpisów', () => {
    const many = { items: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, title: `T${i}`, publishedAt: '2026-01-01T00:00:00Z' })) };
    expect(parseNews(many).length).toBeLessThanOrEqual(50);
  });
});
