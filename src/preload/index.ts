/**
 * Preload NightMC.
 *
 * Działa z `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
 * Eksponuje MINIMALNE API: jedno `invoke` ograniczone do znanej listy kanałów
 * i subskrypcję zdarzeń ograniczoną do znanej listy zdarzeń.
 *
 * Renderer nie dostaje `ipcRenderer`, `require`, `process` ani `fs`.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_SCHEMAS, type EventChannel, type InvokeChannel } from '../shared/ipc.js';

const invokeChannels = new Set<string>(Object.keys(INVOKE_SCHEMAS));
const eventChannels = new Set<string>(EVENT_CHANNELS);

type Listener = (payload: unknown) => void;

const api = {
  /** Wywołanie kanału po stronie procesu głównego. Zwraca `Result<T>`. */
  invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown> {
    if (!invokeChannels.has(channel)) {
      return Promise.resolve({ ok: false, error: `Nieznany kanał IPC: ${String(channel)}` });
    }
    // Struktura klonowalna - odcinamy prototypy, funkcje i gettery.
    let safePayload: unknown;
    try {
      safePayload = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
    } catch {
      return Promise.resolve({ ok: false, error: 'Ładunek IPC nie jest serializowalny' });
    }
    return ipcRenderer.invoke(channel, safePayload);
  },

  /** Subskrypcja zdarzenia. Zwraca funkcję odsubskrybowania. */
  on(channel: EventChannel, listener: Listener): () => void {
    if (!eventChannels.has(channel)) return () => {};
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /** Lista kanałów - używana tylko przez warstwę typów w rendererze. */
  channels: Object.freeze([...invokeChannels]),
} as const;

contextBridge.exposeInMainWorld('nightmc', api);

export type NightMcApi = typeof api;
