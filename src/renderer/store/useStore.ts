/** Globalny stan renderera (Zustand). */

import { create } from 'zustand';
import { call, callSafe, on } from '../api.js';
import type {
  Account,
  DownloadProgress,
  GameState,
  Instance,
  LogLine,
  NewsItem,
  Settings,
  UpdateInfo,
} from '../../shared/types.js';

export type PageId =
  | 'home'
  | 'instances'
  | 'wizard'
  | 'versions'
  | 'loaders'
  | 'mods'
  | 'packs'
  | 'servers'
  | 'accounts'
  | 'java'
  | 'settings'
  | 'logs'
  | 'about';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface SystemInfoExt {
  platform: string;
  arch: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpuCount: number;
  appVersion: string;
  electronVersion: string;
  dataDir: string;
  instancesDir: string;
  runtimesDir: string;
  cacheDir: string;
  isDev: boolean;
  secretsBackend: string;
  authConfigured: boolean;
  disclaimer: string;
  networkServices: { name: string; hosts: string[]; purpose: string; optional: boolean }[];
}

interface State {
  page: PageId;
  ready: boolean;
  system: SystemInfoExt | null;
  settings: Settings | null;

  instances: Instance[];
  selectedInstanceId: string | null;
  accounts: Account[];
  authConfigured: boolean;

  gameState: GameState;
  progress: DownloadProgress | null;
  logs: LogLine[];
  news: NewsItem[];
  update: UpdateInfo | null;
  toasts: Toast[];

  setPage: (page: PageId) => void;
  selectInstance: (id: string | null) => void;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: number) => void;

  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshLogs: (instanceId?: string) => Promise<void>;
  bootstrap: () => Promise<void>;
}

let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  page: 'home',
  ready: false,
  system: null,
  settings: null,

  instances: [],
  selectedInstanceId: null,
  accounts: [],
  authConfigured: false,

  gameState: { status: 'idle' },
  progress: null,
  logs: [],
  news: [],
  update: null,
  toasts: [],

  setPage: (page) => set({ page }),
  selectInstance: (id) => set({ selectedInstanceId: id }),

  pushToast: (kind, message) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refreshInstances: async () => {
    const instances = await callSafe<Instance[]>('instances:list', undefined, []);
    const selected = get().selectedInstanceId;
    set({
      instances,
      selectedInstanceId: selected && instances.some((i) => i.id === selected) ? selected : (instances[0]?.id ?? null),
    });
  },

  refreshAccounts: async () => {
    const res = await callSafe<{ accounts: Account[]; authConfigured: boolean }>('accounts:list', undefined, {
      accounts: [],
      authConfigured: false,
    });
    set({ accounts: res.accounts, authConfigured: res.authConfigured });
  },

  refreshSettings: async () => {
    const settings = await callSafe<Settings | null>('settings:get', undefined, null);
    if (settings) set({ settings });
  },

  refreshLogs: async (instanceId) => {
    const logs = await callSafe<LogLine[]>('logs:get', { instanceId, limit: 2000 }, []);
    set({ logs });
  },

  bootstrap: async () => {
    const system = await callSafe<SystemInfoExt | null>('app:systemInfo', undefined, null);
    set({ system });
    await Promise.all([get().refreshSettings(), get().refreshInstances(), get().refreshAccounts()]);
    void callSafe<NewsItem[]>('news:get', undefined, []).then((news) => set({ news }));
    void callSafe<UpdateInfo | null>('updates:check', undefined, null).then((update) => {
      if (update?.available) set({ update });
    });
    void get().refreshLogs();
    set({ ready: true });
  },
}));

/** Podpina zdarzenia z procesu głównego do stanu. */
export function installEventBridge(): () => void {
  const store = useStore.getState;
  const offs = [
    on('event:download-progress', (p: DownloadProgress) => useStore.setState({ progress: p })),
    on('event:game-state', (s: GameState) => {
      useStore.setState({ gameState: s });
      if (s.status === 'idle' || s.status === 'exited') useStore.setState({ progress: null });
    }),
    on('event:log-line', (line: LogLine) =>
      useStore.setState((prev) => ({ logs: [...prev.logs, line].slice(-2000) })),
    ),
    on('event:instances-changed', () => void store().refreshInstances()),
    on('event:accounts-changed', () => void store().refreshAccounts()),
    on('event:update-available', (info: UpdateInfo) => useStore.setState({ update: info })),
    on('event:toast', (t: { kind: Toast['kind']; message: string }) => store().pushToast(t.kind, t.message)),
  ];
  return () => offs.forEach((off) => off());
}

/** Skrót: aktywny profil. */
export function useActiveAccount(): Account | null {
  return useStore((s) => s.accounts.find((a) => a.active) ?? null);
}

/** Skrót: wybrana instancja. */
export function useSelectedInstance(): Instance | null {
  return useStore((s) => s.instances.find((i) => i.id === s.selectedInstanceId) ?? null);
}

export { call };
