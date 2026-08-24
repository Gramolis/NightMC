/**
 * Magazyn danych poufnych (tokeny Microsoft, klucz API CurseForge).
 *
 * Kolejność preferencji:
 *   1. keytar  -> Windows Credential Manager (magazyn systemowy),
 *   2. Electron safeStorage -> DPAPI, zaszyfrowany blob w %APPDATA%\NightMC.
 *
 * keytar jest od 2023 archiwalny i bywa niemożliwy do zbudowania bez
 * Visual Studio Build Tools, dlatego jest zależnością OPCJONALNĄ, a NightMC
 * automatycznie przechodzi na wbudowane safeStorage. Obie ścieżki dają
 * szyfrowanie powiązane z kontem użytkownika Windows.
 *
 * Czego tu NIE MA i być nie może: haseł Microsoft (launcher ich nigdy nie
 * widzi) ani zapisu tokenów do SQLite lub JSON-a w postaci jawnej.
 */

import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { APP_NAME } from '../shared/constants.js';
import { log } from './logging.js';
import { secretsPath } from './paths.js';
import { optionalRequire } from './native.js';

type Keytar = {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<{ account: string; password: string }[]>;
};

let keytar: Keytar | null = null;
let keytarChecked = false;

function tryKeytar(): Keytar | null {
  if (keytarChecked) return keytar;
  keytarChecked = true;
  keytar = optionalRequire<Keytar>('keytar');
  if (keytar && typeof keytar.getPassword === 'function') {
    log.info('Magazyn poświadczeń: keytar (Menedżer poświadczeń Windows)');
  } else {
    keytar = null;
    log.warn('keytar niedostępny - używam Electron safeStorage (DPAPI)');
  }
  return keytar;
}

/* ------------------------------------------------------------------ */
/* Fallback: zaszyfrowany plik (safeStorage / DPAPI)                   */
/* ------------------------------------------------------------------ */

type Vault = Record<string, string>;

function readVault(): Vault {
  const file = secretsPath();
  if (!fs.existsSync(file)) return {};
  try {
    const blob = fs.readFileSync(file);
    if (!safeStorage.isEncryptionAvailable()) {
      log.error('safeStorage niedostępny - nie mogę odczytać magazynu poświadczeń');
      return {};
    }
    const plain = safeStorage.decryptString(blob);
    return JSON.parse(plain) as Vault;
  } catch (e) {
    log.error(`Nie udało się odczytać magazynu poświadczeń: ${(e as Error).message}`);
    return {};
  }
}

function writeVault(vault: Vault): void {
  const file = secretsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Szyfrowanie systemowe jest niedostępne. NightMC nie zapisze tokenów w postaci jawnej.',
    );
  }
  const blob = safeStorage.encryptString(JSON.stringify(vault));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, blob, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export async function setSecret(key: string, value: string): Promise<void> {
  const kt = tryKeytar();
  if (kt) {
    await kt.setPassword(APP_NAME, key, value);
    return;
  }
  const vault = readVault();
  vault[key] = value;
  writeVault(vault);
}

export async function getSecret(key: string): Promise<string | null> {
  const kt = tryKeytar();
  if (kt) return kt.getPassword(APP_NAME, key);
  return readVault()[key] ?? null;
}

export async function deleteSecret(key: string): Promise<void> {
  const kt = tryKeytar();
  if (kt) {
    await kt.deletePassword(APP_NAME, key);
    return;
  }
  const vault = readVault();
  delete vault[key];
  writeVault(vault);
}

/** Usuwa WSZYSTKIE dane poufne - używane przy "Wyloguj wszystkich". */
export async function purgeAllSecrets(): Promise<void> {
  const kt = tryKeytar();
  if (kt) {
    const creds = await kt.findCredentials(APP_NAME);
    await Promise.all(creds.map((c) => kt.deletePassword(APP_NAME, c.account)));
    return;
  }
  try {
    fs.rmSync(secretsPath(), { force: true });
  } catch {
    /* ignorujemy - plik mógł nie istnieć */
  }
}

/** Klucze używane przez NightMC. */
export const SECRET_KEYS = {
  msRefresh: (accountId: string) => `ms-refresh:${accountId}`,
  mcAccess: (accountId: string) => `mc-access:${accountId}`,
  curseforgeApiKey: () => 'curseforge-api-key',
} as const;

/** Informacja diagnostyczna dla ekranu "O programie". */
export function secretsBackend(): 'keytar' | 'safeStorage' {
  return tryKeytar() ? 'keytar' : 'safeStorage';
}
