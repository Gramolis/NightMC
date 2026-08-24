/**
 * Aktualizacje launchera przez GitHub Releases - bez własnego backendu.
 *
 * Zasady bezpieczeństwa:
 *  - pobieramy tylko po HTTPS z api.github.com / objects.githubusercontent.com,
 *  - plik ląduje w katalogu tymczasowym,
 *  - preferujemy instalator `NightMC-Setup.exe` i weryfikujemy jego SHA-256,
 *  - starsze wydania z portable `NightMC.exe` pozostają obsługiwane awaryjnie,
 *  - opcjonalnie weryfikujemy podpis Ed25519 (w EXE jest TYLKO klucz publiczny),
 *  - użytkownik zatwierdza aktualizację ręcznie,
 *  - NightMC NIGDY nie wykonuje skryptu pobranego z sieci.
 *
 * Po weryfikacji otwieramy katalog z instalatorem. Użytkownik nadal sam zatwierdza
 * jego uruchomienie, więc pobrany plik nigdy nie wykonuje się bez wiedzy gracza.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, shell } from 'electron';
import { ENDPOINTS } from '../shared/constants.js';
import { fetchJson } from './net.js';
import { DownloadQueue, downloadToBuffer, hashFile } from './downloader.js';
import { tempDir } from './paths.js';
import { log } from './logging.js';
import type { DownloadProgress, UpdateInfo } from '../shared/types.js';

/** owner/repo - wstrzykiwane przy budowaniu (patrz .env.example). */
export const UPDATE_REPO = process.env.NIGHTMC_UPDATE_REPO ?? '';
/** Publiczny klucz Ed25519 w base64. Klucz prywatny NIGDY nie trafia do EXE. */
export const UPDATE_PUBKEY = process.env.NIGHTMC_UPDATE_PUBKEY ?? '';

export interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface SelectedUpdateAssets {
  executable?: GhAsset;
  checksum?: GhAsset;
  signature?: GhAsset;
  assetType?: 'installer' | 'portable';
}

/** Preferuje instalator; portable obsługuje tylko starsze wydania. */
export function selectUpdateAssets(assets: GhAsset[]): SelectedUpdateAssets {
  const installer = assets.find((asset) => asset.name.toLowerCase() === 'nightmc-setup.exe');
  const portable = assets.find((asset) => asset.name.toLowerCase() === 'nightmc.exe');
  const executable = installer ?? portable;
  if (!executable) return {};
  const base = executable.name.toLowerCase();
  return {
    executable,
    checksum: assets.find((asset) => asset.name.toLowerCase() === `${base}.sha256`),
    signature: assets.find((asset) => asset.name.toLowerCase() === `${base}.sig`),
    assetType: installer ? 'installer' : 'portable',
  };
}

interface GhRelease {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: GhAsset[];
}

/** Porównuje wersje semantyczne. Zwraca >0 jeśli `a` jest nowsza. */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, '').split(/[.\-+]/);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10);
    const nb = Number.parseInt(pb[i] ?? '0', 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? '';
      const sb = pb[i] ?? '';
      if (sa !== sb) return sa > sb ? 1 : -1;
      continue;
    }
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function isUpdatesConfigured(): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(UPDATE_REPO);
}

/** Sprawdza najnowsze wydanie. Brak konfiguracji lub błąd sieci nie blokuje launchera. */
export async function checkForUpdate(currentVersion = app?.getVersion?.() ?? '1.0.3'): Promise<UpdateInfo> {
  if (!isUpdatesConfigured()) {
    return { available: false, currentVersion };
  }
  try {
    const release = await fetchJson<GhRelease>(`${ENDPOINTS.githubApi}/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      timeoutMs: 15_000,
    });
    if (!release || release.draft) return { available: false, currentVersion };

    const latest = release.tag_name.replace(/^v/i, '');
    const selected = selectUpdateAssets(release.assets);

    let sha256: string | undefined;
    if (selected.checksum) {
      const text = (await downloadToBuffer(selected.checksum.browser_download_url, { maxBytes: 4096 })).toString('utf8');
      sha256 = text.trim().split(/\s+/)[0]?.toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) sha256 = undefined;
    }
    let signature: string | undefined;
    if (selected.signature) {
      signature = (await downloadToBuffer(selected.signature.browser_download_url, { maxBytes: 4096 })).toString('utf8').trim();
    }

    const completeUpdate = Boolean(selected.executable && sha256);
    if (compareVersions(latest, currentVersion) > 0 && !completeUpdate) {
      log.warn(`Wydanie ${latest} nie zawiera kompletnego instalatora aktualizacji i sumy SHA-256.`);
    }

    return {
      available: compareVersions(latest, currentVersion) > 0 && completeUpdate,
      currentVersion,
      latestVersion: latest,
      changelog: release.body?.slice(0, 20_000),
      downloadUrl: selected.executable?.browser_download_url,
      fileName: selected.executable?.name,
      assetType: selected.assetType,
      size: selected.executable?.size,
      sha256,
      signature,
      publishedAt: release.published_at,
      htmlUrl: release.html_url,
    };
  } catch (e) {
    log.warn(`Sprawdzanie aktualizacji nie powiodło się: ${(e as Error).message}`);
    return { available: false, currentVersion };
  }
}

/** Weryfikuje podpis Ed25519 pliku. Brak klucza publicznego = pomijamy. */
export function verifySignature(fileHashHex: string, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        // Prefiks DER dla surowego klucza Ed25519 (RFC 8410).
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyB64, 'base64'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(fileHashHex, 'hex'), key, Buffer.from(signatureB64, 'base64'));
  } catch (e) {
    log.warn(`Weryfikacja podpisu nie powiodła się: ${(e as Error).message}`);
    return false;
  }
}

export interface DownloadedUpdate {
  file: string;
  sha256: string;
  signatureValid: boolean | null;
}

/** Pobiera i weryfikuje nową wersję. Nie uruchamia jej samodzielnie. */
export async function downloadUpdate(
  info: UpdateInfo,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadedUpdate> {
  if (!info.downloadUrl) throw new Error('Wydanie nie zawiera instalatora NightMC.');
  if (!info.sha256) throw new Error('Wydanie nie zawiera wymaganej sumy SHA-256 instalatora.');

  const targetName = info.assetType === 'portable'
    ? `NightMC-${info.latestVersion ?? 'new'}.exe`
    : `NightMC-Setup-${info.latestVersion ?? 'new'}.exe`;
  const dest = path.join(tempDir(), targetName);
  await fsp.mkdir(tempDir(), { recursive: true });

  const queue = new DownloadQueue({ concurrency: 1, onProgress, phase: 'Pobieranie aktualizacji NightMC' });
  queue.add({
    id: 'update',
    url: info.downloadUrl,
    dest,
    size: info.size,
    sha256: info.sha256,
    label: info.fileName ?? `NightMC ${info.latestVersion}`,
  });
  const res = await queue.run();
  if (!res.ok) {
    await fsp.rm(dest, { force: true });
    throw new Error(`Pobieranie aktualizacji nie powiodło się: ${res.failed[0]?.error ?? 'anulowano'}`);
  }

  const actual = await hashFile(dest, 'sha256');
  if (info.sha256 && actual.toLowerCase() !== info.sha256.toLowerCase()) {
    await fsp.rm(dest, { force: true });
    throw new Error('Suma SHA-256 pobranej aktualizacji się nie zgadza. Plik został usunięty.');
  }

  let signatureValid: boolean | null = null;
  if (info.signature && UPDATE_PUBKEY) {
    signatureValid = verifySignature(actual, info.signature, UPDATE_PUBKEY);
    if (!signatureValid) {
      await fsp.rm(dest, { force: true });
      throw new Error('Podpis Ed25519 aktualizacji jest nieprawidłowy. Plik został usunięty.');
    }
  }

  log.info(`Pobrano aktualizację do ${dest} (SHA-256 zweryfikowana)`);
  return { file: dest, sha256: actual, signatureValid };
}

/** Pokazuje zweryfikowany instalator w Eksploratorze; uruchomienie zatwierdza użytkownik. */
export function revealUpdate(file: string): void {
  shell.showItemInFolder(file);
}
