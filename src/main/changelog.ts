/** Changelog NightMC pobierany z publicznego CHANGELOG.md na GitHubie. */

import { fetchText, MemoryCache } from './net.js';
import { cacheGet, cacheSet } from './db.js';
import { log } from './logging.js';
import type { ChangelogDocument } from '../shared/types.js';

export const CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/Gramolis/NightMC/main/CHANGELOG.md';
export const CHANGELOG_PAGE_URL = 'https://github.com/Gramolis/NightMC/blob/main/CHANGELOG.md';

const CACHE_KEY = 'github-changelog-v1';
const memory = new MemoryCache<ChangelogDocument>(15 * 60_000);

/** Zachowujemy wyłącznie tekst Markdown; renderer nie interpretuje HTML. */
export function sanitizeChangelog(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, 4000)
    .join('\n')
    .slice(0, 256 * 1024)
    .trim();
}

export async function getChangelog(refresh = false): Promise<ChangelogDocument> {
  if (!refresh) {
    const hit = memory.get(CACHE_KEY);
    if (hit) return hit;
  }

  try {
    const content = sanitizeChangelog(await fetchText(CHANGELOG_RAW_URL, {
      timeoutMs: 10_000,
      maxBytes: 256 * 1024,
      headers: { Accept: 'text/markdown, text/plain' },
    }));
    if (!content.startsWith('#')) throw new Error('Pobrany changelog ma nieprawidłowy format.');
    const document: ChangelogDocument = {
      content,
      sourceUrl: CHANGELOG_PAGE_URL,
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };
    memory.set(CACHE_KEY, document);
    cacheSet(CACHE_KEY, document, 30 * 24 * 60 * 60_000);
    return document;
  } catch (e) {
    const stale = cacheGet<ChangelogDocument>(CACHE_KEY);
    if (stale?.content) {
      const cached = { ...stale, fromCache: true };
      memory.set(CACHE_KEY, cached);
      log.warn(`Changelog GitHub niedostępny — używam zapisanej kopii: ${(e as Error).message}`);
      return cached;
    }
    throw new Error(`Nie udało się pobrać changeloga z GitHuba: ${(e as Error).message}`);
  }
}
