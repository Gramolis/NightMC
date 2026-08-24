/**
 * Warstwa sieciowa NightMC.
 *
 * Zasady:
 *  - tylko HTTPS,
 *  - tylko hosty z ALLOWED_HOSTS (twarda ochrona przed SSRF z danych zdalnych),
 *  - każde żądanie ma timeout,
 *  - odpowiedzi JSON mają limit rozmiaru,
 *  - brak ciasteczek, brak przekierowań na nieautoryzowane hosty.
 */

import { ALLOWED_HOSTS, LIMITS } from '../shared/constants.js';
import { log } from './logging.js';

export class NetError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = 'NetError';
  }
}

/** Adres do komunikatu błędu bez parametrów, które mogą zawierać token pobierania. */
export function safeUrlForMessage(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[nieprawidłowy adres]';
  }
}

/** Sprawdza, czy URL jest bezpiecznym adresem HTTPS na dozwolonym hoście. */
export function isAllowedUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function assertAllowedUrl(rawUrl: string): URL {
  if (!isAllowedUrl(rawUrl)) {
    throw new NetError(`Adres zablokowany przez politykę sieciową NightMC: ${safeUrlForMessage(rawUrl)}`);
  }
  return new URL(rawUrl);
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Dodatkowe hosty dozwolone tylko dla tego wywołania (np. CDN paczki). */
  allowExtraHosts?: string[];
}

const USER_AGENT = 'NightMC/1.0.3 (+https://github.com/Gramolis/NightMC)';

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}

/** Surowe żądanie z timeoutem i kontrolą hosta. */
export async function httpRequest(url: string, opts: FetchOptions = {}): Promise<Response> {
  const extra = opts.allowExtraHosts ?? [];
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const inExtra = extra.some((h) => host === h.toLowerCase());
  // Pętla zwrotna jest dopuszczana WYŁĄCZNIE gdy wywołujący jawnie ją wskaże
  // (używane w testach). Adresy z danych zdalnych nigdy nie ustawiają allowExtraHosts,
  // więc nie da się tego wykorzystać do SSRF z paczki albo z API.
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  const hostOk =
    isAllowedUrl(url) ||
    (inExtra && (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback)));
  if (!hostOk) throw new NetError(`Adres zablokowany przez politykę sieciową NightMC: ${safeUrlForMessage(url)}`);

  const timeout = opts.timeoutMs ?? LIMITS.metaTimeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'User-Agent': USER_AGENT, ...(opts.headers ?? {}) },
      body: opts.body,
      redirect: 'follow',
      signal: combineSignals(opts.signal, ctrl.signal),
    });
    // Po przekierowaniach sprawdzamy host końcowy jeszcze raz.
    if (res.url && res.url !== url) {
      const finalHost = new URL(res.url).hostname.toLowerCase();
      const finalOk = isAllowedUrl(res.url) || extra.some((h) => finalHost === h.toLowerCase());
      if (!finalOk) throw new NetError(`Przekierowanie na niedozwolony host: ${safeUrlForMessage(res.url)}`);
    }
    return res;
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new NetError(`Przekroczono limit czasu (${timeout} ms): ${safeUrlForMessage(url)}`, undefined, url);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Pobiera tekst z limitem rozmiaru. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await httpRequest(url, opts);
  if (!res.ok) throw new NetError(`HTTP ${res.status} dla ${safeUrlForMessage(url)}`, res.status, url);
  const max = opts.maxBytes ?? LIMITS.maxJsonBytes;
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > max) throw new NetError(`Odpowiedź za duża (${declared} B > ${max} B): ${safeUrlForMessage(url)}`);

  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new NetError(`Odpowiedź przekroczyła limit ${max} B: ${safeUrlForMessage(url)}`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** Pobiera i parsuje JSON. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NetError(`Nieprawidłowy JSON z ${safeUrlForMessage(url)}`);
  }
}

/** Prosty cache w pamięci dla metadanych (TTL w ms). */
export class MemoryCache<T> {
  private store = new Map<string, { value: T; expires: number }>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/** Ponawianie z wykładniczym backoffem. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; signal?: AbortSignal; label?: string } = {},
): Promise<T> {
  const retries = opts.retries ?? LIMITS.retries;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new NetError('Anulowano');
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      // Błędy 4xx (poza 408/429) nie mają sensu do ponawiania.
      const status = (e as NetError).status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) throw e;
      if (attempt === retries) break;
      const delay = Math.min(30_000, (opts.baseDelayMs ?? 500) * 2 ** attempt) + Math.random() * 250;
      if (opts.label) log.warn(`${opts.label}: próba ${attempt + 1}/${retries + 1} nieudana, ponawiam za ${Math.round(delay)} ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
