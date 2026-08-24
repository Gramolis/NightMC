/**
 * Logi NightMC + redakcja danych poufnych.
 *
 * Reguła: żaden token, refresh token, kod autoryzacyjny ani klucz API nie może
 * trafić do bufora logów, na dysk, do schowka ani do UI. Redakcja jest
 * stosowana JEDNORAZOWO przy wejściu do systemu logów, więc nie da się jej
 * pominąć zapominając o wywołaniu.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../shared/constants.js';
import type { LogLine } from '../shared/types.js';

/** Wzorce danych, których nigdy nie logujemy. */
const REDACTIONS: { re: RegExp; replace: string }[] = [
  // JWT (Minecraft/Microsoft access token)
  { re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, replace: '[TOKEN USUNIĘTY]' },
  // Microsoft refresh token (M.C5xx..., M.R3_BAY...)
  { re: /\bM\.[A-Za-z0-9]{1,4}_[A-Za-z0-9._-]{20,}/g, replace: '[REFRESH TOKEN USUNIĘTY]' },
  // Argumenty wiersza poleceń z tokenem
  // `(?!\[)` chroni przed ponowną redakcją tekstu już zredagowanego przez regułę wyżej.
  { re: /(--accessToken|--session|--auth_access_token)(\s+|=)(?!\[)\S+/gi, replace: '$1 [USUNIĘTY]' },
  // Pola JSON
  {
    re: /("(?:access_token|refresh_token|id_token|accessToken|Token|code|client_secret|api_key|apiKey|x-api-key)"\s*:\s*")[^"]*(")/gi,
    replace: '$1[USUNIĘTY]$2',
  },
  // Nagłówki HTTP
  { re: /(Authorization|X-Api-Key|x-api-key)\s*:\s*\S+/gi, replace: '$1: [USUNIĘTY]' },
  // XBL/XSTS token
  { re: /\b(XBL3\.0 x=)[^\s"]+/g, replace: '$1[USUNIĘTY]' },
  // Kod autoryzacyjny w URL
  {
    re: /([?&](?:code|access_token|refresh_token|state|code_verifier|sig|jwt|token|skoid|sktid|skt|ske|sks|skv)=)[^&\s]+/gi,
    replace: '$1[USUNIĘTY]',
  },
  // Klucz CurseForge ($2a$10$... 60 znaków)
  { re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, replace: '[KLUCZ USUNIĘTY]' },
];

/** Usuwa dane poufne z dowolnego tekstu. */
export function redact(text: string): string {
  let out = text;
  for (const { re, replace } of REDACTIONS) out = out.replace(re, replace);
  return out;
}

/** Redakcja dowolnej struktury (do logowania obiektów). */
export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[zbyt głęboko]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((x) => redactDeep(x, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|credential|apikey|api_key|verifier/i.test(k)) {
        out[k] = '[USUNIĘTY]';
      } else {
        out[k] = redactDeep(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Bufor logów                                                         */
/* ------------------------------------------------------------------ */

type Sink = (line: LogLine) => void;

const buffers = new Map<string, LogLine[]>();
const sinks = new Set<Sink>();

const GLOBAL = '__launcher__';

export function onLogLine(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function pushLog(
  scope: string | undefined,
  level: LogLine['level'],
  source: LogLine['source'],
  text: string,
): LogLine {
  const key = scope ?? GLOBAL;
  const line: LogLine = { ts: Date.now(), level, source, text: redact(text) };
  let buf = buffers.get(key);
  if (!buf) {
    buf = [];
    buffers.set(key, buf);
  }
  buf.push(line);
  if (buf.length > LIMITS.maxLogLines) buf.splice(0, buf.length - LIMITS.maxLogLines);
  for (const s of sinks) {
    try {
      s(line);
    } catch {
      /* sink nie może wywrócić logowania */
    }
  }
  return line;
}

export function getLogs(scope?: string, limit = LIMITS.maxLogLines): LogLine[] {
  const buf = buffers.get(scope ?? GLOBAL) ?? [];
  return buf.slice(-limit);
}

export function clearLogs(scope?: string): void {
  buffers.delete(scope ?? GLOBAL);
}

export function formatLogs(lines: LogLine[]): string {
  return lines
    .map((l) => `[${new Date(l.ts).toISOString()}] [${l.level.toUpperCase()}] [${l.source}] ${l.text}`)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Skróty                                                              */
/* ------------------------------------------------------------------ */

export const log = {
  info: (msg: string, scope?: string) => pushLog(scope, 'info', 'launcher', msg),
  warn: (msg: string, scope?: string) => pushLog(scope, 'warn', 'launcher', msg),
  error: (msg: string, scope?: string) => pushLog(scope, 'error', 'launcher', msg),
  debug: (msg: string, scope?: string) => pushLog(scope, 'debug', 'launcher', msg),
};

/** Zapisuje log do pliku (już zredagowany). */
export function writeLogFile(dir: string, name: string, lines: LogLine[]): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, formatLogs(lines), 'utf8');
  return file;
}
