/**
 * Aktualności ze statycznego pliku JSON po HTTPS.
 *
 * Wymagania bezpieczeństwa:
 *  - nie renderujemy surowego HTML (renderer wstawia wyłącznie tekst),
 *  - nie wykonujemy JavaScriptu z odpowiedzi,
 *  - walidujemy każdy URL (tylko https),
 *  - ograniczamy rozmiar odpowiedzi i stosujemy timeout,
 *  - trzymamy cache,
 *  - brak aktualności NIE MOŻE zablokować launchera.
 */

import { LIMITS } from '../shared/constants.js';
import { fetchJson, MemoryCache } from './net.js';
import { log } from './logging.js';
import type { NewsItem } from '../shared/types.js';

export const NEWS_URL = process.env.NIGHTMC_NEWS_URL ?? '';

const cache = new MemoryCache<NewsItem[]>(30 * 60 * 1000);

/** Dopuszczamy wyłącznie bezpieczne, absolutne adresy https. */
export function sanitizeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function plainText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  // Usuwamy znaczniki - w UI i tak wstawiamy to jako czysty tekst.
  return raw.replace(/<[^>]*>/g, '').slice(0, max).trim();
}

/** Waliduje i normalizuje odpowiedź news.json. */
export function parseNews(raw: unknown): NewsItem[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, 50)
    .map((entry, i): NewsItem | null => {
      const e = entry as Record<string, unknown>;
      const id = typeof e['id'] === 'string' ? e['id'].slice(0, 64) : `news-${i}`;
      const title = plainText(e['title'], 160);
      if (!title) return null;
      return {
        id,
        title,
        description: plainText(e['description'], 600),
        image: sanitizeUrl(e['image']),
        url: sanitizeUrl(e['url']),
        publishedAt: typeof e['publishedAt'] === 'string' ? e['publishedAt'] : new Date(0).toISOString(),
      };
    })
    .filter((x): x is NewsItem => x !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function isNewsConfigured(): boolean {
  return Boolean(sanitizeUrl(NEWS_URL));
}

/** Pobiera aktualności. Każdy błąd kończy się pustą listą, nigdy wyjątkiem. */
export async function getNews(): Promise<NewsItem[]> {
  const url = sanitizeUrl(NEWS_URL);
  if (!url) return [];

  const hit = cache.get(url);
  if (hit) return hit;

  try {
    const raw = await fetchJson(url, { timeoutMs: 10_000, maxBytes: LIMITS.maxNewsBytes });
    const items = parseNews(raw);
    cache.set(url, items);
    return items;
  } catch (e) {
    log.warn(`Nie udało się pobrać aktualności: ${(e as Error).message}`);
    return [];
  }
}
