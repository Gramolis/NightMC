/**
 * NightMC - proces główny Electrona.
 *
 * Bezpieczeństwo okna: contextIsolation ON, nodeIntegration OFF, sandbox ON,
 * CSP bez `unsafe-eval`, blokada nawigacji poza aplikację, linki zewnętrzne
 * otwierane w systemowej przeglądarce, DevTools wyłączone w buildzie produkcyjnym.
 *
 * Renderer nie ma dostępu do plików ani do poleceń - wyłącznie do kanałów IPC
 * z `src/shared/ipc.ts`, których ładunki są walidowane przed użyciem.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  INVOKE_SCHEMAS,
  isInvokeChannel,
  ValidationError,
  type InvokeChannel,
} from '../shared/ipc.js';
import { LEGAL_DISCLAIMER, LIMITS, NETWORK_SERVICES } from '../shared/constants.js';
import type { DownloadProgress, GameState, Result } from '../shared/types.js';

import { cacheDir, dataDir, ensureDirs, instanceDir, instancesDir, logsDir, runtimesDir, dbPath } from './paths.js';
import { initDb, closeDb } from './db.js';
import { clearLogs, formatLogs, getLogs, log, onLogLine, writeLogFile } from './logging.js';
import { getSettings, setSettings } from './settings.js';
import { clearMetadataCache, filterVersions, getVersionJson, getVersionManifest } from './minecraft.js';
import { loaderVersions } from './modloaders.js';
import {
  backupInstance,
  createInstance,
  deleteInstance,
  duplicateInstance,
  exportInstance,
  getInstance,
  importInstance,
  installInstance,
  listInstances,
  refreshModCount,
  repairInstance,
  updateInstance,
} from './instances.js';
import { detectJava, downloadJava, memoryAdvice, probeJava, removeManagedJava } from './java.js';
import { addOfflineAccount, activeAccount, listAccounts, removeAccount, setActiveAccount, upsertAccount } from './accounts.js';
import { AuthError, getValidSession, isAuthConfigured, loginMicrosoft, refreshAccount } from './auth.js';
import { offlineSession } from './offline.js';
import { addServer, getServer, listServers, pingServer, removeServer, updateServer } from './servers.js';
import { checkModUpdates, deleteMod, installMod, listMods, projectVersions, searchMods, toggleMod, updateMod } from './mods.js';
import { analyzeModsDirectory } from './mod-analyzer.js';
import { exportMrpack, importPack, previewPack, repairPackFiles, setManualFile } from './packs.js';
import {
  installCatalogModpack,
  checkCurseForgeUpdates,
  installPackBuilderItems,
  modpackCatalogVersions,
  packCatalogVersions,
  searchModpackCatalog,
  searchPackCatalog,
  updateCurseForgeMod,
} from './pack-builder.js';
import { launchGame, setLauncherVersion, stopAll, stopGame, runningGames } from './launcher.js';
import { checkForUpdate, downloadUpdate, revealUpdate } from './updates.js';
import { getNews } from './news.js';
import { getChangelog } from './changelog.js';
import { deleteSecret, SECRET_KEYS, secretsBackend, setSecret } from './secrets.js';
import { DATA_SOURCES, THIRD_PARTY_LICENSES } from './licenses.js';

const isDev = process.env.NODE_ENV === 'development';
const DEV_SERVER = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let gameState: GameState = { status: 'idle' };

/* ------------------------------------------------------------------ */
/* Pojedyncza instancja aplikacji                                      */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/* ------------------------------------------------------------------ */
/* Okno                                                                */
/* ------------------------------------------------------------------ */

function resolveAsset(...parts: string[]): string {
  // W buildzie pliki leżą w out/, w dev w tym samym miejscu.
  const base = path.dirname(fileURLToPath(import.meta.url ?? `file://${__filename}`));
  return path.join(base, ...parts);
}

function preloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'index.cjs');
}

function rendererIndex(): string {
  return path.join(__dirname, '..', 'renderer', 'index.html');
}

function iconPath(): string {
  const candidates = [
    path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '', 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) ?? '';
}

function createWindow(): void {
  const icon = iconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#07070f',
    title: 'NightMC',
    icon: icon ? nativeImage.createFromPath(icon) : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: isDev,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  // Content Security Policy - bez eval, bez zdalnego kodu.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://cdn.modrinth.com https://textures.minecraft.net https://crafatar.com",
            "font-src 'self' data:",
            "connect-src 'self'",
            "media-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "worker-src 'self'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
        ],
      },
    });
  });

  // Blokada nawigacji poza aplikację.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER && url.startsWith(DEV_SERVER);
    if (!allowed) {
      event.preventDefault();
      log.warn(`Zablokowano nawigację renderera do ${url}`);
    }
  });

  // Linki zewnętrzne -> systemowa przeglądarka, nigdy nowe okno Electrona.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (DEV_SERVER) {
    void mainWindow.loadURL(DEV_SERVER);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(rendererIndex());
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupTray(): void {
  const icon = iconPath();
  if (!icon) return;
  try {
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
    tray.setToolTip('NightMC');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Pokaż NightMC', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Zakończ', click: () => app.quit() },
      ]),
    );
    tray.on('double-click', () => mainWindow?.show());
  } catch (e) {
    log.warn(`Nie udało się utworzyć ikony w zasobniku: ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Emisja zdarzeń do renderera                                         */
/* ------------------------------------------------------------------ */

function emit(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function emitProgress(p: DownloadProgress): void {
  emit('event:download-progress', p);
}

function setGameState(state: GameState): void {
  gameState = state;
  emit('event:game-state', state);
}

function toast(kind: 'info' | 'success' | 'error', message: string): void {
  emit('event:toast', { kind, message });
}

/* ------------------------------------------------------------------ */
/* Rejestracja kanałów IPC                                             */
/* ------------------------------------------------------------------ */

type Handler = (payload: any) => Promise<unknown> | unknown;

const handlers = new Map<string, Handler>();

function on(channel: InvokeChannel, handler: Handler): void {
  handlers.set(channel, handler);
}

/** Rejestruje jeden `ipcMain.handle` dla wszystkich kanałów - z walidacją. */
function installIpc(): void {
  for (const channel of Object.keys(INVOKE_SCHEMAS)) {
    ipcMain.handle(channel, async (_event, rawPayload): Promise<Result<unknown>> => {
      if (!isInvokeChannel(channel)) return { ok: false, error: 'Nieznany kanał' };
      const handler = handlers.get(channel);
      if (!handler) return { ok: false, error: `Kanał "${channel}" nie ma obsługi` };
      try {
        const validate = INVOKE_SCHEMAS[channel] as (v: unknown) => unknown;
        const payload = validate(rawPayload ?? undefined);
        const data = await handler(payload);
        return { ok: true, data };
      } catch (e) {
        const err = e as Error & { code?: string; hint?: string };
        if (err instanceof ValidationError) {
          log.error(`Odrzucono wywołanie IPC "${channel}": ${err.message}`);
          return { ok: false, error: err.message, code: 'VALIDATION' };
        }
        const message = err.hint ? `${err.message} ${err.hint}` : err.message;
        log.error(`Błąd kanału "${channel}": ${message}`);
        return { ok: false, error: message, code: err.code };
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Obsługa kanałów                                                     */
/* ------------------------------------------------------------------ */

function registerHandlers(): void {
  /* --- system --- */
  on('app:systemInfo', () => ({
    platform: process.platform,
    arch: process.arch,
    totalMemoryMB: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemoryMB: Math.floor(os.freemem() / 1024 / 1024),
    cpuCount: os.cpus().length,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    dataDir: dataDir(),
    instancesDir: instancesDir(),
    runtimesDir: runtimesDir(),
    cacheDir: cacheDir(),
    isDev,
    secretsBackend: secretsBackend(),
    authConfigured: isAuthConfigured(),
    disclaimer: LEGAL_DISCLAIMER,
    networkServices: NETWORK_SERVICES,
  }));

  on('app:openExternal', async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Można otwierać wyłącznie adresy https://');
    await shell.openExternal(parsed.toString());
    return true;
  });

  on('app:openPath', async ({ target, instanceId }) => {
    const map: Record<string, string> = {
      data: dataDir(),
      instances: instanceId ? instanceDir(instanceId) : instancesDir(),
      runtimes: runtimesDir(),
      cache: cacheDir(),
      logs: logsDir(),
    };
    const dir = map[target];
    if (!dir) throw new Error('Nieznany katalog');
    await fsp.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return dir;
  });

  on('app:licenses', () => ({ libraries: THIRD_PARTY_LICENSES, sources: DATA_SOURCES }));

  /* --- ustawienia --- */
  on('settings:get', () => getSettings());
  on('settings:set', ({ patch }) => setSettings(patch));
  on('settings:pickInstancesDir', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Wybierz katalog instancji',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return setSettings({ instancesDir: res.filePaths[0] });
  });

  /* --- wersje --- */
  on('mc:versions', async ({ refresh }) => {
    if (refresh) clearMetadataCache();
    const manifest = await getVersionManifest(Boolean(refresh));
    const settings = getSettings();
    return {
      latest: manifest.latest,
      versions: filterVersions(manifest.versions, {
        snapshots: settings.showSnapshots,
        old: settings.showOldVersions,
      }),
      all: manifest.versions.length,
    };
  });
  on('mc:versionDetail', async ({ versionId }) => getVersionJson(versionId));

  /* --- loadery --- */
  on('loader:versions', async ({ loader, mcVersion }) => loaderVersions(loader, mcVersion));

  /* --- instancje --- */
  on('instances:list', () => listInstances());
  on('instances:create', (payload) => {
    const s = getSettings();
    const inst = createInstance(payload, {
      memoryMin: s.defaultMemoryMin,
      memoryMax: s.defaultMemoryMax,
      jvmArgs: s.defaultJvmArgs,
    });
    emit('event:instances-changed', null);
    return inst;
  });
  on('instances:update', ({ id, patch }) => {
    const inst = updateInstance(id, patch as any);
    emit('event:instances-changed', null);
    return inst;
  });
  on('instances:delete', async ({ id }) => {
    await deleteInstance(id);
    emit('event:instances-changed', null);
    return true;
  });
  on('instances:duplicate', async ({ id, name }) => {
    const copy = await duplicateInstance(id, name);
    emit('event:instances-changed', null);
    return copy;
  });
  on('instances:install', async ({ id }) => {
    const s = getSettings();
    setGameState({ status: 'preparing', instanceId: id, progress: emptyProgress('Przygotowanie') });
    try {
      await installInstance(id, { onProgress: emitProgress, concurrency: s.concurrency });
      emit('event:instances-changed', null);
      toast('success', 'Instancja gotowa do gry.');
      return getInstance(id);
    } finally {
      setGameState({ status: 'idle' });
    }
  });
  on('instances:repair', async ({ id }) => {
    const s = getSettings();
    setGameState({ status: 'preparing', instanceId: id, progress: emptyProgress('Naprawa') });
    try {
      const core = await repairInstance(id, { onProgress: emitProgress, concurrency: s.concurrency });
      const pack = await repairPackFiles(id, emitProgress);
      emit('event:instances-changed', null);
      return { repaired: core.repaired + pack.repaired, coreRepaired: core.repaired, pack };
    } finally {
      setGameState({ status: 'idle' });
    }
  });
  on('instances:export', async ({ id }) => {
    const inst = getInstance(id);
    const res = await dialog.showSaveDialog({
      title: 'Eksport instancji',
      defaultPath: `${inst.name}.nightmc.zip`,
      filters: [{ name: 'Instancja NightMC', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return exportInstance(id, res.filePath);
  });
  on('instances:import', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import instancji NightMC',
      filters: [{ name: 'Instancja NightMC', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const s = getSettings();
    const inst = await importInstance(res.filePaths[0], {
      memoryMin: s.defaultMemoryMin,
      memoryMax: s.defaultMemoryMax,
      jvmArgs: s.defaultJvmArgs,
    });
    emit('event:instances-changed', null);
    return inst;
  });
  on('instances:backup', async ({ id }) => {
    const res = await dialog.showOpenDialog({
      title: 'Wybierz katalog kopii zapasowej',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return backupInstance(id, res.filePaths[0]);
  });
  on('instances:shortcut', async ({ id }) => {
    const inst = getInstance(id);
    const target = process.execPath;
    const link = path.join(app.getPath('desktop'), `${inst.name}.lnk`);
    if (process.platform !== 'win32') throw new Error('Skróty są obsługiwane tylko na Windows');
    const ok = shell.writeShortcutLink(link, 'create', {
      target,
      args: `--instance ${inst.id}`,
      description: `NightMC - ${inst.name}`,
      icon: iconPath() || target,
      iconIndex: 0,
    });
    if (!ok) throw new Error('Nie udało się utworzyć skrótu na pulpicie');
    return link;
  });

  /* --- mody --- */
  on('mods:list', ({ instanceId }) => listMods(instanceId));
  on('mods:toggle', ({ instanceId, fileName }) => toggleMod(instanceId, fileName));
  on('mods:delete', ({ instanceId, fileName }) => deleteMod(instanceId, fileName));
  on('mods:search', (opts) => searchMods(opts));
  on('mods:versions', ({ projectId, mcVersion, loader }) => projectVersions(projectId, { mcVersion, loader }));
  on('mods:install', async ({ instanceId, versionId, withDependencies }) => {
    const res = await installMod(instanceId, versionId, { withDependencies, onProgress: emitProgress });
    emit('event:instances-changed', null);
    return res;
  });
  on('mods:analyze', ({ instanceId }) => {
    const instance = getInstance(instanceId);
    return analyzeModsDirectory(
      path.join(instance.dir, 'minecraft', 'mods'),
      { loader: instance.loader, mcVersion: instance.mcVersion },
      { instanceId },
    );
  });
  on('mods:checkUpdates', async ({ instanceId }) => [
    ...(await checkModUpdates(instanceId)),
    ...(await checkCurseForgeUpdates(instanceId)),
  ]);
  on('mods:update', async ({ instanceId, fileName, source, projectId, newVersionId }) => {
    const mods = source === 'curseforge'
      ? await updateCurseForgeMod(instanceId, fileName, projectId ?? '', newVersionId, emitProgress)
      : await updateMod(instanceId, fileName, newVersionId, emitProgress);
    emit('event:instances-changed', null);
    return mods;
  });

  /* --- paczki --- */
  on('packs:pickAndPreview', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Wybierz paczkę modów',
      filters: [
        { name: 'Paczki modów', extensions: ['mrpack', 'zip'] },
        { name: 'Wszystkie pliki', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return previewPack(res.filePaths[0]);
  });
  on('packs:pickManualFile', async ({ previewToken, fileName }) => {
    const res = await dialog.showOpenDialog({
      title: `Wskaż plik dla: ${fileName}`,
      filters: [{ name: 'Mody', extensions: ['jar'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    setManualFile(previewToken, fileName, res.filePaths[0]);
    return res.filePaths[0];
  });
  on('packs:import', async ({ previewToken, instanceName }) => {
    const s = getSettings();
    const inst = await importPack(
      previewToken,
      instanceName,
      { memoryMin: s.defaultMemoryMin, memoryMax: s.defaultMemoryMax, jvmArgs: s.defaultJvmArgs },
      emitProgress,
    );
    emit('event:instances-changed', null);
    return inst;
  });
  on('packs:exportMrpack', async ({ instanceId }) => {
    const inst = getInstance(instanceId);
    const res = await dialog.showSaveDialog({
      title: 'Eksport do .mrpack',
      defaultPath: `${inst.name}.mrpack`,
      filters: [{ name: 'Paczka Modrinth', extensions: ['mrpack'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return exportMrpack(instanceId, res.filePath);
  });
  on('packBuilder:search', (input) => searchPackCatalog(input));
  on('packBuilder:versions', (input) => packCatalogVersions(input));
  on('packBuilder:install', async ({ instanceId, items }) => {
    const result = await installPackBuilderItems(instanceId, items, emitProgress);
    emit('event:instances-changed', null);
    return result;
  });
  on('packBuilder:searchPacks', (input) => searchModpackCatalog(input));
  on('packBuilder:packVersions', (input) => modpackCatalogVersions(input));
  on('packBuilder:installPack', async (input) => {
    const s = getSettings();
    const instance = await installCatalogModpack(
      input,
      { memoryMin: s.defaultMemoryMin, memoryMax: s.defaultMemoryMax, jvmArgs: s.defaultJvmArgs },
      emitProgress,
    );
    emit('event:instances-changed', null);
    return instance;
  });

  /* --- Java --- */
  on('java:detect', async () => ({
    installs: await detectJava(),
    memory: memoryAdvice(os.totalmem(), os.freemem()),
  }));
  on('java:download', async ({ major }) => {
    const install = await downloadJava(major, emitProgress);
    toast('success', `Zainstalowano Java ${install.version}.`);
    return install;
  });
  on('java:pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Wskaż plik java.exe',
      filters: [{ name: 'Java', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const info = await probeJava(res.filePaths[0]);
    if (!info) throw new Error('Wskazany plik nie jest działającym środowiskiem Java');
    return info;
  });
  on('java:test', async ({ path: p }) => probeJava(p));
  on('java:remove', async ({ path: p }) => {
    await removeManagedJava(p);
    return true;
  });

  /* --- konta --- */
  on('accounts:list', () => ({ accounts: listAccounts(), authConfigured: isAuthConfigured() }));
  on('accounts:loginMicrosoft', async () => {
    const { account } = await loginMicrosoft();
    const saved = upsertAccount(account);
    emit('event:accounts-changed', null);
    if (!saved.ownsGame) {
      toast('error', 'To konto Microsoft nie ma Minecraft Java Edition. Możesz grać przez profil Offline.');
    }
    return saved;
  });
  on('accounts:addOffline', ({ username, skinPath, avatar }) => {
    const acc = addOfflineAccount(username, { skinPath, avatar });
    emit('event:accounts-changed', null);
    return acc;
  });
  on('accounts:remove', async ({ id }) => {
    await removeAccount(id);
    emit('event:accounts-changed', null);
    return true;
  });
  on('accounts:setActive', ({ id }) => {
    const acc = setActiveAccount(id);
    emit('event:accounts-changed', null);
    return acc;
  });
  on('accounts:refresh', async ({ id }) => {
    const { account } = await refreshAccount(id);
    const saved = upsertAccount(account);
    emit('event:accounts-changed', null);
    return saved;
  });
  on('accounts:pickSkin', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Wybierz skórkę (PNG 64x64)',
      filters: [{ name: 'Obraz PNG', extensions: ['png'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  /* --- serwery --- */
  on('servers:list', () => listServers());
  on('servers:add', (payload) => addServer(payload));
  on('servers:update', ({ id, patch }) => updateServer(id, patch as any));
  on('servers:remove', ({ id }) => {
    removeServer(id);
    return true;
  });
  on('servers:ping', ({ address, port }) => pingServer(address, port));

  /* --- gra --- */
  on('game:state', () => ({ state: gameState, running: runningGames() }));
  on('game:cancelDownload', () => {
    return true;
  });
  on('game:stop', ({ instanceId }) => stopGame(instanceId));
  on('game:launch', async ({ instanceId, serverId }) => {
    const account = activeAccount();
    if (!account) throw new Error('Nie wybrano profilu. Dodaj konto Microsoft albo profil Offline w zakładce "Konta".');

    const instance = getInstance(instanceId);
    const settings = getSettings();
    const server = serverId ? getServer(serverId) : undefined;

    // Ostrzeżenie o multiplayerze offline pokazujemy raz.
    if (account.type === 'offline' && server && !settings.acceptedOfflineWarning) {
      setSettings({ acceptedOfflineWarning: true });
    }

    // 1. Sesja: premium (odświeżana) albo lokalna offline.
    let session;
    if (account.type === 'microsoft') {
      try {
        session = await getValidSession(account.id);
      } catch (e) {
        const err = e as AuthError;
        throw new Error(
          `Nie udało się odświeżyć sesji Microsoft: ${err.message}${err.hint ? ` ${err.hint}` : ''}`,
        );
      }
    } else {
      session = offlineSession(account);
    }

    // 2. Instalacja / weryfikacja plików.
    setGameState({ status: 'preparing', instanceId, progress: emptyProgress('Weryfikacja plików') });
    await installInstance(instanceId, { onProgress: emitProgress, concurrency: settings.concurrency });

    // 3. Uruchomienie.
    const game = await launchGame(instanceId, session, server, {
      onStarted: (pid) => {
        setGameState({ status: 'running', instanceId, pid, startedAt: Date.now() });
        if (settings.closeOnLaunch === 'minimize') mainWindow?.minimize();
        else if (settings.closeOnLaunch === 'tray') mainWindow?.hide();
        else if (settings.closeOnLaunch === 'close') app.quit();
      },
      onExit: (code, diagnosis) => {
        setGameState({ status: 'exited', instanceId, code, diagnosis });
        if (settings.closeOnLaunch === 'minimize') mainWindow?.restore();
        if (settings.closeOnLaunch === 'tray') mainWindow?.show();
        emit('event:instances-changed', null);
        if (diagnosis) toast('error', `${diagnosis.title}. ${diagnosis.hint}`);
      },
    });

    refreshModCount(instanceId);
    return { pid: game.pid, instanceId, versionId: instance.versionId };
  });

  /* --- logi --- */
  on('logs:get', ({ instanceId, limit }) => getLogs(instanceId, limit ?? LIMITS.maxLogLines));
  on('logs:clear', ({ instanceId }) => {
    clearLogs(instanceId);
    return true;
  });
  on('logs:copy', ({ instanceId }) => formatLogs(getLogs(instanceId)));
  on('logs:saveToFile', async ({ instanceId }) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `nightmc-${instanceId ?? 'launcher'}-${stamp}.log`;
    const res = await dialog.showSaveDialog({ title: 'Zapisz log', defaultPath: name });
    if (res.canceled || !res.filePath) return null;
    return writeLogFile(path.dirname(res.filePath), path.basename(res.filePath), getLogs(instanceId));
  });

  /* --- aktualizacje / aktualności --- */
  on('updates:check', () => checkForUpdate());
  on('updates:download', async () => {
    const info = await checkForUpdate();
    if (!info.available) return { downloaded: false, reason: 'Masz najnowszą wersję.' };
    const result = await downloadUpdate(info, emitProgress);
    revealUpdate(result.file);
    return { downloaded: true, file: result.file, signatureValid: result.signatureValid };
  });
  on('news:get', () => getNews());
  on('changelog:get', ({ refresh }) => getChangelog(refresh));

  /* --- CurseForge --- */
  on('curseforge:setKey', async ({ key }) => {
    if (!key.trim()) throw new Error('Klucz nie może być pusty');
    await setSecret(SECRET_KEYS.curseforgeApiKey(), key.trim());
    setSettings({ curseforgeKeySet: true });
    return true;
  });
  on('curseforge:clearKey', async () => {
    await deleteSecret(SECRET_KEYS.curseforgeApiKey());
    setSettings({ curseforgeKeySet: false });
    return true;
  });
}

function emptyProgress(phase: string): DownloadProgress {
  return {
    progress: 0,
    filesDone: 0,
    filesTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    speed: 0,
    etaSeconds: -1,
    currentFile: '',
    phase,
  };
}

/* ------------------------------------------------------------------ */
/* Cykl życia                                                          */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  app.setAppUserModelId('pl.nightmc.launcher');
  ensureDirs();
  setLauncherVersion(app.getVersion());
  initDb(dbPath());
  getSettings();

  onLogLine((line) => emit('event:log-line', line));
  registerHandlers();
  installIpc();
  createWindow();
  setupTray();

  log.info(`NightMC ${app.getVersion()} uruchomiony (Electron ${process.versions.electron})`);
  log.info(LEGAL_DISCLAIMER);

  // Sprawdzenie aktualizacji w tle - nigdy nie blokuje startu.
  if (getSettings().checkUpdates) {
    void checkForUpdate()
      .then((info) => {
        if (info.available) emit('event:update-available', info);
      })
      .catch(() => undefined);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopAll();
  closeDb();
});

// Blokada tworzenia okien z niezaufanych źródeł.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

export { resolveAsset };
