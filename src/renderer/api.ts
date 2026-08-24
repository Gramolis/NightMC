/**
 * Typowany most do procesu głównego.
 *
 * Renderer nie ma dostępu do Node ani do plików - wszystko idzie tędy,
 * przez kanały zadeklarowane w `src/shared/ipc.ts`.
 */

import type { EventChannel, InvokeChannel } from '../shared/ipc.js';
import type { Result } from '../shared/types.js';

declare global {
  interface Window {
    nightmc: {
      invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown>;
      on(channel: EventChannel, listener: (payload: unknown) => void): () => void;
      channels: readonly string[];
    };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Wywołanie kanału. Rzuca ApiError, gdy proces główny zwrócił błąd. */
export async function call<T = unknown>(channel: InvokeChannel, payload?: unknown): Promise<T> {
  const res = (await window.nightmc.invoke(channel, payload)) as Result<T> | undefined;
  if (!res) throw new ApiError('Brak odpowiedzi z procesu głównego');
  if (!res.ok) throw new ApiError(res.error, res.code);
  return res.data;
}

/** Wariant, który zamiast rzucać zwraca wartość zapasową. */
export async function callSafe<T>(channel: InvokeChannel, payload: unknown, fallback: T): Promise<T> {
  try {
    return await call<T>(channel, payload);
  } catch {
    return fallback;
  }
}

export function on(channel: EventChannel, listener: (payload: any) => void): () => void {
  return window.nightmc.on(channel, listener);
}

/* Pomocnicze formatowanie ------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '—';
}

export function formatEta(seconds: number): string {
  if (seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m} min ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatPlayTime(seconds: number): string {
  if (!seconds) return 'jeszcze nie grano';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export function formatDate(ts?: number | string): string {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('pl-PL').format(n);
}
