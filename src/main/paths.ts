/**
 * Katalogi danych NightMC.
 *
 * Wszystko ląduje w %APPDATA%\NightMC (Windows). Nic nie jest zapisywane obok
 * pliku EXE - dzięki temu portable NightMC.exe można przenosić dowolnie.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { APP_NAME } from '../shared/constants.js';

let overrideInstancesDir: string | null = null;

/** %APPDATA%\NightMC */
export function dataDir(): string {
  // app.getPath('appData') to %APPDATA% na Windows, ~/.config na Linux.
  return path.join(app.getPath('appData'), APP_NAME);
}

export function instancesDir(): string {
  return overrideInstancesDir ?? path.join(dataDir(), 'instances');
}

export function setInstancesDir(dir: string | null): void {
  overrideInstancesDir = dir && dir.trim() ? path.resolve(dir) : null;
  if (overrideInstancesDir) fs.mkdirSync(overrideInstancesDir, { recursive: true });
}

export function runtimesDir(): string {
  return path.join(dataDir(), 'runtimes');
}

export function cacheDir(): string {
  return path.join(dataDir(), 'cache');
}

/** Wspólny magazyn bibliotek/assetów - współdzielony przez wszystkie instancje. */
export function sharedDir(): string {
  return path.join(dataDir(), 'shared');
}

export function librariesDir(): string {
  return path.join(sharedDir(), 'libraries');
}

export function assetsDir(): string {
  return path.join(sharedDir(), 'assets');
}

export function versionsDir(): string {
  return path.join(sharedDir(), 'versions');
}

export function logsDir(): string {
  return path.join(dataDir(), 'logs');
}

export function tempDir(): string {
  return path.join(dataDir(), 'temp');
}

export function dbPath(): string {
  return path.join(dataDir(), 'nightmc.db');
}

export function secretsPath(): string {
  return path.join(dataDir(), 'secrets.bin');
}

/** Katalog konkretnej instancji. */
export function instanceDir(instanceId: string): string {
  return path.join(instancesDir(), instanceId);
}

/** Katalog `.minecraft` instancji - katalog roboczy procesu gry. */
export function instanceGameDir(instanceId: string): string {
  return path.join(instanceDir(instanceId), 'minecraft');
}

/** Tworzy komplet katalogów przy pierwszym uruchomieniu. */
export function ensureDirs(): void {
  for (const d of [
    dataDir(),
    instancesDir(),
    runtimesDir(),
    cacheDir(),
    sharedDir(),
    librariesDir(),
    assetsDir(),
    path.join(assetsDir(), 'objects'),
    path.join(assetsDir(), 'indexes'),
    versionsDir(),
    logsDir(),
    tempDir(),
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/**
 * Zabezpieczenie przed path traversal: sprawdza, czy `target` leży wewnątrz `root`.
 * Używane wszędzie, gdzie ścieżka pochodzi z danych zewnętrznych (ZIP, API, IPC).
 */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Rzuca, jeśli ścieżka wychodzi poza dozwolony katalog. */
export function assertInside(root: string, target: string): string {
  if (!isInside(root, target)) {
    throw new Error(`Odrzucono ścieżkę poza katalogiem docelowym: ${target}`);
  }
  return path.resolve(target);
}

/** Usuwa z nazwy znaki niedozwolone w systemie plików Windows. */
export function sanitizeFileName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim() || 'bez_nazwy';
}
