/**
 * Atrapa modułu `electron` na potrzeby testów.
 *
 * Moduły procesu głównego importują `electron` (app, shell, safeStorage), a Vitest
 * uruchamia je w zwykłym Node. Alias jest ustawiony w `vitest.config.ts`.
 */

import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const testRoot = path.join(os.tmpdir(), `nightmc-test-${process.pid}`);

export const app = {
  getVersion: () => '1.0.0-test',
  getPath: (name: string) => path.join(testRoot, name),
  getAppPath: () => testRoot,
  setAppUserModelId: () => undefined,
  requestSingleInstanceLock: () => true,
  whenReady: async () => undefined,
  on: () => undefined,
  quit: () => undefined,
};

const key = crypto.randomBytes(32);

export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]);
  },
  decryptString: (buf: Buffer) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  },
};

export const shell = {
  openExternal: async () => undefined,
  openPath: async () => '',
  showItemInFolder: () => undefined,
  writeShortcutLink: () => true,
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined as string | undefined }),
};

export const ipcMain = { handle: () => undefined };
export const BrowserWindow = class {};
export const Menu = { setApplicationMenu: () => undefined, buildFromTemplate: () => ({}) };
export const Tray = class {};
export const nativeImage = { createFromPath: () => ({ resize: () => ({}) }) };
export const contextBridge = { exposeInMainWorld: () => undefined };
export const ipcRenderer = { invoke: async () => undefined, on: () => undefined, removeListener: () => undefined };

export default { app, safeStorage, shell, dialog, ipcMain, BrowserWindow, Menu, Tray, nativeImage };
