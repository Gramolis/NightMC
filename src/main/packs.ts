/**
 * Import i eksport paczek: Modrinth `.mrpack` oraz lokalny ZIP CurseForge.
 *
 * CurseForge bez backendu: NightMC NIE zawiera żadnego klucza API. Odczytujemy
 * `manifest.json` z ZIP-a wskazanego przez użytkownika, rozpakowujemy `overrides`
 * i pokazujemy listę brakujących modów do ręcznego wskazania. Opcjonalnie
 * użytkownik może wpisać WŁASNY klucz API - trafia on do magazynu poświadczeń
 * systemu, nigdy do repozytorium ani do EXE.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { ENDPOINTS } from '../shared/constants.js';
import { DownloadQueue, verifyFile } from './downloader.js';
import { extractArchive, inspectArchive, readArchiveEntry, UnsafeArchiveError } from './zipsafe.js';
import { createInstance, getInstance, refreshModCount } from './instances.js';
import { getSecret, SECRET_KEYS } from './secrets.js';
import { fetchJson, isAllowedUrl } from './net.js';
import { log } from './logging.js';
import type {
  CurseForgeManifest,
  DownloadProgress,
  Instance,
  LoaderId,
  MrPackIndex,
  PackPreview,
} from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Wspólne                                                             */
/* ------------------------------------------------------------------ */

export class PackError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'PackError';
  }
}

interface PackLockDownloadFile {
  source: 'download';
  path: string;
  downloads: string[];
  size?: number;
  sha1?: string;
}

interface PackLockCurseForgeFile {
  source: 'curseforge';
  projectID: number;
  fileID: number;
}

interface PackRepairLock {
  format: 'nightmc-pack-lock';
  formatVersion: 1;
  kind: 'mrpack' | 'curseforge';
  name: string;
  files: (PackLockDownloadFile | PackLockCurseForgeFile)[];
}

function packLockPath(instance: Instance): string {
  return path.join(instance.dir, 'minecraft', '.nightmc-pack-lock.json');
}

async function savePackLock(instance: Instance, lock: PackRepairLock): Promise<void> {
  const file = packLockPath(instance);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(lock, null, 2), 'utf8');
}

export function parsePackLock(raw: unknown): PackRepairLock | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<PackRepairLock>;
  if (value.format !== 'nightmc-pack-lock' || value.formatVersion !== 1) return null;
  if (value.kind !== 'mrpack' && value.kind !== 'curseforge') return null;
  if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 200) return null;
  if (!Array.isArray(value.files) || value.files.length > 200_000) return null;
  const files: (PackLockDownloadFile | PackLockCurseForgeFile)[] = [];
  for (const item of value.files as unknown[]) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    if (candidate['source'] === 'download') {
      if (typeof candidate['path'] !== 'string') return null;
      validatePackFilePath(candidate['path']);
      if (!Array.isArray(candidate['downloads']) || candidate['downloads'].length > 16) return null;
      if (!candidate['downloads'].every((url) => typeof url === 'string' && url.length <= 4096)) return null;
      if (candidate['size'] !== undefined && (!Number.isSafeInteger(candidate['size']) || Number(candidate['size']) < 0)) return null;
      if (candidate['sha1'] !== undefined && (typeof candidate['sha1'] !== 'string' || !/^[a-f0-9]{40}$/i.test(candidate['sha1']))) return null;
      files.push({
        source: 'download',
        path: candidate['path'],
        downloads: candidate['downloads'] as string[],
        size: candidate['size'] as number | undefined,
        sha1: candidate['sha1'] as string | undefined,
      });
    } else if (candidate['source'] === 'curseforge') {
      if (!Number.isSafeInteger(candidate['projectID']) || Number(candidate['projectID']) <= 0) return null;
      if (!Number.isSafeInteger(candidate['fileID']) || Number(candidate['fileID']) <= 0) return null;
      files.push({ source: 'curseforge', projectID: Number(candidate['projectID']), fileID: Number(candidate['fileID']) });
    } else {
      return null;
    }
  }
  return { format: 'nightmc-pack-lock', formatVersion: 1, kind: value.kind, name: value.name, files };
}

export async function readPackLock(instance: Instance): Promise<PackRepairLock | null> {
  try {
    return parsePackLock(JSON.parse(await fsp.readFile(packLockPath(instance), 'utf8')));
  } catch {
    return null;
  }
}

/** Bufor podglądów - klucz zwracany do UI, żeby renderer nie dostawał ścieżek. */
const previews = new Map<string, { file: string; preview: PackPreview; manual: Map<string, string> }>();

export function getPreview(token: string): { file: string; preview: PackPreview; manual: Map<string, string> } {
  const entry = previews.get(token);
  if (!entry) throw new PackError('Podgląd paczki wygasł. Wybierz plik ponownie.');
  return entry;
}

function storePreview(file: string, preview: PackPreview): string {
  const token = `pk${crypto.randomBytes(8).toString('hex')}`;
  previews.set(token, { file, preview, manual: new Map() });
  // Bufor trzymamy maksymalnie 30 minut.
  setTimeout(() => previews.delete(token), 30 * 60_000).unref?.();
  return token;
}

/** Rozpoznaje typ archiwum po zawartości, nie po rozszerzeniu. */
export function detectPackKind(zipFile: string): 'mrpack' | 'curseforge' {
  const zip = new AdmZip(zipFile);
  if (zip.getEntry('modrinth.index.json')) return 'mrpack';
  if (zip.getEntry('manifest.json')) return 'curseforge';
  throw new PackError(
    'To archiwum nie jest paczką Modrinth ani CurseForge.',
    'Oczekiwano pliku modrinth.index.json (.mrpack) albo manifest.json (CurseForge).',
  );
}

/* ------------------------------------------------------------------ */
/* MRPACK                                                              */
/* ------------------------------------------------------------------ */

/** Mapuje zależności z modrinth.index.json na loader NightMC. */
export function loaderFromMrpackDeps(deps: Record<string, string>): { loader: LoaderId; loaderVersion?: string; mcVersion: string } {
  const mcVersion = deps['minecraft'];
  if (!mcVersion) throw new PackError('Paczka nie deklaruje wersji Minecrafta.');

  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'], mcVersion };
  if (deps['neoforge']) return { loader: 'neoforge', loaderVersion: deps['neoforge'], mcVersion };
  if (deps['forge']) return { loader: 'forge', loaderVersion: `${mcVersion}-${deps['forge']}`, mcVersion };
  if (deps['quilt-loader']) {
    throw new PackError(
      'Ta paczka wymaga loadera Quilt, którego NightMC nie obsługuje.',
      'Poszukaj wersji paczki dla Fabric.',
    );
  }
  return { loader: 'vanilla', mcVersion };
}

export function parseMrpackIndex(raw: unknown): MrPackIndex {
  const idx = raw as MrPackIndex;
  if (!idx || typeof idx !== 'object') throw new PackError('modrinth.index.json jest uszkodzony.');
  if (idx.formatVersion !== 1) throw new PackError(`Nieobsługiwana wersja formatu paczki: ${idx.formatVersion}`);
  if (!Array.isArray(idx.files)) throw new PackError('modrinth.index.json nie zawiera listy plików.');
  if (!idx.dependencies || typeof idx.dependencies !== 'object') {
    throw new PackError('modrinth.index.json nie zawiera sekcji dependencies.');
  }
  return idx;
}

/**
 * Sprawdza ścieżkę docelową pliku z paczki.
 * Paczka nie może zapisać niczego poza katalogiem instancji.
 */
export function validatePackFilePath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new UnsafeArchiveError(`Paczka próbuje zapisać plik pod ścieżką absolutną: ${relPath}`);
  }
  const parts = normalized.split('/').filter((p) => p && p !== '.');
  if (parts.includes('..')) throw new UnsafeArchiveError(`Paczka próbuje wyjść poza katalog instancji: ${relPath}`);
  return parts.join('/');
}

export function previewMrpack(zipFile: string): PackPreview {
  const { totalBytes } = inspectArchive(zipFile);
  const raw = readArchiveEntry(zipFile, 'modrinth.index.json', 8 * 1024 * 1024);
  if (!raw) throw new PackError('Archiwum nie zawiera modrinth.index.json.');
  const index = parseMrpackIndex(JSON.parse(raw.toString('utf8')));
  const target = loaderFromMrpackDeps(index.dependencies);

  const warnings: string[] = [];
  const requiredFiles = index.files
    .filter((f) => (f.env?.client ?? 'required') !== 'unsupported')
    .map((f) => {
      validatePackFilePath(f.path);
      const url = f.downloads.find((d) => isAllowedUrl(d));
      if (!url) warnings.push(`Plik "${f.path}" wskazuje na host spoza dozwolonej listy - zostanie pominięty.`);
      return { name: f.path, url, size: f.fileSize };
    });

  const overrideCount = new AdmZip(zipFile)
    .getEntries()
    .filter((e) => !e.isDirectory && (e.entryName.startsWith('overrides/') || e.entryName.startsWith('client-overrides/')))
    .length;

  return {
    kind: 'mrpack',
    name: index.name,
    version: index.versionId,
    mcVersion: target.mcVersion,
    loader: target.loader,
    loaderVersion: target.loaderVersion,
    requiredFiles,
    overrideCount,
    estimatedBytes: totalBytes + requiredFiles.reduce((a, f) => a + (f.size ?? 0), 0),
    warnings,
  };
}

async function importMrpack(
  zipFile: string,
  instanceName: string,
  defaults: { memoryMin: number; memoryMax: number; jvmArgs: string },
  onProgress?: (p: DownloadProgress) => void,
): Promise<Instance> {
  const raw = readArchiveEntry(zipFile, 'modrinth.index.json', 8 * 1024 * 1024);
  if (!raw) throw new PackError('Archiwum nie zawiera modrinth.index.json.');
  const index = parseMrpackIndex(JSON.parse(raw.toString('utf8')));
  const target = loaderFromMrpackDeps(index.dependencies);

  const instance = createInstance(
    {
      name: instanceName,
      mcVersion: target.mcVersion,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
      icon: 'package',
      memoryMin: defaults.memoryMin,
      memoryMax: Math.max(defaults.memoryMax, 4096),
    },
    defaults,
  );

  const gameDir = path.join(instance.dir, 'minecraft');

  // 1. Nadpisania z archiwum (bezpiecznie).
  await extractArchive(zipFile, gameDir, { stripPrefix: 'overrides', overwrite: true });
  await extractArchive(zipFile, gameDir, { stripPrefix: 'client-overrides', overwrite: true });

  // 2. Pobranie plików z sieci.
  const queue = new DownloadQueue({ onProgress, phase: `Pobieranie zawartości paczki "${index.name}"` });
  for (const f of index.files) {
    if ((f.env?.client ?? 'required') === 'unsupported') continue;
    const rel = validatePackFilePath(f.path);
    const url = f.downloads.find((d) => isAllowedUrl(d));
    if (!url) {
      log.warn(`Pominięto "${f.path}" - żaden adres nie jest na dozwolonej liście hostów`);
      continue;
    }
    queue.add({
      id: rel,
      url,
      dest: path.join(gameDir, ...rel.split('/')),
      sha1: f.hashes.sha1,
      size: f.fileSize,
      label: path.basename(rel),
    });
  }
  const res = await queue.run();
  if (!res.ok && !res.cancelled) {
    throw new PackError(
      `Nie udało się pobrać ${res.failed.length} plików paczki.`,
      res.failed[0]?.error,
    );
  }

  await savePackLock(instance, {
    format: 'nightmc-pack-lock',
    formatVersion: 1,
    kind: 'mrpack',
    name: index.name,
    files: index.files
      .filter((f) => (f.env?.client ?? 'required') !== 'unsupported')
      .map((f) => ({
        source: 'download' as const,
        path: validatePackFilePath(f.path),
        downloads: f.downloads.filter((url) => isAllowedUrl(url)),
        size: f.fileSize,
        sha1: f.hashes.sha1,
      })),
  });

  refreshModCount(instance.id);
  log.info(`Zaimportowano paczkę Modrinth "${index.name}" jako instancję "${instanceName}"`);
  return getInstance(instance.id);
}

/** Eksportuje instancję do `.mrpack`. */
export async function exportMrpack(instanceId: string, destFile: string): Promise<string> {
  const instance = getInstance(instanceId);
  const gameDir = path.join(instance.dir, 'minecraft');

  const dependencies: Record<string, string> = { minecraft: instance.mcVersion };
  if (instance.loader === 'fabric' && instance.loaderVersion) dependencies['fabric-loader'] = instance.loaderVersion;
  if (instance.loader === 'neoforge' && instance.loaderVersion) dependencies['neoforge'] = instance.loaderVersion;
  if (instance.loader === 'forge' && instance.loaderVersion) {
    dependencies['forge'] = instance.loaderVersion.replace(`${instance.mcVersion}-`, '');
  }

  const index: MrPackIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: instance.name,
    summary: `Wyeksportowane z NightMC`,
    files: [],
    dependencies,
  };

  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2), 'utf8'));

  // Wszystko wrzucamy jako overrides - to działa dla każdego pliku,
  // także dla modów spoza Modrinth.
  for (const sub of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts']) {
    const dir = path.join(gameDir, sub);
    if (fs.existsSync(dir)) zip.addLocalFolder(dir, `overrides/${sub}`);
  }
  const optionsFile = path.join(gameDir, 'options.txt');
  if (fs.existsSync(optionsFile)) zip.addLocalFile(optionsFile, 'overrides');

  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  zip.writeZip(destFile);
  log.info(`Wyeksportowano "${instance.name}" do ${destFile}`);
  return destFile;
}

/* ------------------------------------------------------------------ */
/* CURSEFORGE (lokalny ZIP)                                            */
/* ------------------------------------------------------------------ */

export function parseCurseForgeManifest(raw: unknown): CurseForgeManifest {
  const m = raw as CurseForgeManifest;
  if (!m || typeof m !== 'object') throw new PackError('manifest.json jest uszkodzony.');
  if (!m.minecraft?.version) throw new PackError('manifest.json nie zawiera wersji Minecrafta.');
  if (!Array.isArray(m.files)) m.files = [];
  return m;
}

/** Mapuje identyfikator modloadera CurseForge ("forge-47.2.0") na loader NightMC. */
export function loaderFromCurseForgeId(id: string, mcVersion: string): { loader: LoaderId; loaderVersion?: string } {
  const lower = id.toLowerCase();
  if (lower.startsWith('fabric')) return { loader: 'fabric', loaderVersion: lower.replace(/^fabric-/, '') };
  if (lower.startsWith('neoforge')) return { loader: 'neoforge', loaderVersion: lower.replace(/^neoforge-/, '') };
  if (lower.startsWith('forge')) {
    const v = lower.replace(/^forge-/, '');
    return { loader: 'forge', loaderVersion: v.startsWith(mcVersion) ? v : `${mcVersion}-${v}` };
  }
  return { loader: 'vanilla' };
}

export function previewCurseForge(zipFile: string): PackPreview {
  const { totalBytes } = inspectArchive(zipFile);
  const raw = readArchiveEntry(zipFile, 'manifest.json', 8 * 1024 * 1024);
  if (!raw) throw new PackError('Archiwum nie zawiera manifest.json.');
  const manifest = parseCurseForgeManifest(JSON.parse(raw.toString('utf8')));

  const primaryLoader = manifest.minecraft.modLoaders.find((l) => l.primary) ?? manifest.minecraft.modLoaders[0];
  const target = primaryLoader
    ? loaderFromCurseForgeId(primaryLoader.id, manifest.minecraft.version)
    : { loader: 'vanilla' as LoaderId };

  const overridesDir = manifest.overrides ?? 'overrides';
  const overrideCount = new AdmZip(zipFile)
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.startsWith(`${overridesDir}/`)).length;

  return {
    kind: 'curseforge',
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    mcVersion: manifest.minecraft.version,
    loader: target.loader,
    loaderVersion: target.loaderVersion,
    requiredFiles: manifest.files.map((f) => ({
      name: `projekt ${f.projectID} / plik ${f.fileID}`,
      projectID: f.projectID,
      fileID: f.fileID,
    })),
    overrideCount,
    estimatedBytes: totalBytes,
    warnings: [
      'NightMC nie zawiera klucza API CurseForge, więc nie pobiera modów automatycznie.',
      'Nadpisania (configi, skrypty, resource packi) zostaną rozpakowane normalnie.',
      'Brakujące mody możesz wskazać ręcznie albo wpisać własny klucz API w Ustawieniach.',
    ],
  };
}

interface CurseForgeFileInfo {
  data: { id: number; displayName: string; fileName: string; downloadUrl: string | null; fileLength: number; hashes: { value: string; algo: number }[] };
}

/** Pobiera metadane pliku przez API CurseForge - tylko z WŁASNYM kluczem użytkownika. */
async function curseForgeFileInfo(projectId: number, fileId: number, apiKey: string): Promise<CurseForgeFileInfo['data'] | null> {
  try {
    const res = await fetchJson<CurseForgeFileInfo>(
      `${ENDPOINTS.curseforgeApi}/mods/${projectId}/files/${fileId}`,
      { headers: { 'x-api-key': apiKey, Accept: 'application/json' } },
    );
    return res?.data ?? null;
  } catch (e) {
    log.warn(`CurseForge API: nie udało się pobrać pliku ${projectId}/${fileId}: ${(e as Error).message}`);
    return null;
  }
}

async function importCurseForge(
  zipFile: string,
  instanceName: string,
  manual: Map<string, string>,
  defaults: { memoryMin: number; memoryMax: number; jvmArgs: string },
  onProgress?: (p: DownloadProgress) => void,
): Promise<Instance> {
  const raw = readArchiveEntry(zipFile, 'manifest.json', 8 * 1024 * 1024);
  if (!raw) throw new PackError('Archiwum nie zawiera manifest.json.');
  const manifest = parseCurseForgeManifest(JSON.parse(raw.toString('utf8')));
  const primaryLoader = manifest.minecraft.modLoaders.find((l) => l.primary) ?? manifest.minecraft.modLoaders[0];
  const target = primaryLoader
    ? loaderFromCurseForgeId(primaryLoader.id, manifest.minecraft.version)
    : { loader: 'vanilla' as LoaderId, loaderVersion: undefined };

  const instance = createInstance(
    {
      name: instanceName,
      mcVersion: manifest.minecraft.version,
      loader: target.loader,
      loaderVersion: target.loaderVersion,
      icon: 'package',
      memoryMin: defaults.memoryMin,
      memoryMax: Math.max(defaults.memoryMax, 4096),
    },
    defaults,
  );

  const gameDir = path.join(instance.dir, 'minecraft');
  await extractArchive(zipFile, gameDir, { stripPrefix: manifest.overrides ?? 'overrides', overwrite: true });

  // 1. Ręcznie wskazane pliki kopiujemy do mods/.
  const modsTarget = path.join(gameDir, 'mods');
  await fsp.mkdir(modsTarget, { recursive: true });
  for (const [, src] of manual) {
    if (!fs.existsSync(src)) continue;
    await fsp.copyFile(src, path.join(modsTarget, path.basename(src)));
  }

  // 2. Jeżeli użytkownik podał własny klucz API - dociągamy resztę.
  const apiKey = await getSecret(SECRET_KEYS.curseforgeApiKey());
  if (apiKey && manifest.files.length > 0) {
    const queue = new DownloadQueue({ onProgress, phase: 'Pobieranie modów z CurseForge' });
    for (const f of manifest.files) {
      const info = await curseForgeFileInfo(f.projectID, f.fileID, apiKey);
      if (!info?.downloadUrl) {
        log.warn(`CurseForge: plik ${f.projectID}/${f.fileID} ma wyłączone pobieranie przez API - wskaż go ręcznie`);
        continue;
      }
      if (fs.existsSync(path.join(modsTarget, info.fileName))) continue;
      queue.add({
        id: `${f.projectID}-${f.fileID}`,
        url: info.downloadUrl,
        dest: path.join(modsTarget, info.fileName),
        size: info.fileLength,
        sha1: info.hashes?.find((h) => h.algo === 1)?.value,
        label: info.displayName,
      });
    }
    if (queue.size > 0) await queue.run();
  }

  await savePackLock(instance, {
    format: 'nightmc-pack-lock',
    formatVersion: 1,
    kind: 'curseforge',
    name: manifest.name,
    files: manifest.files
      .filter((f) => f.required !== false)
      .map((f) => ({ source: 'curseforge', projectID: f.projectID, fileID: f.fileID })),
  });

  refreshModCount(instance.id);
  log.info(`Zaimportowano paczkę CurseForge "${manifest.name}" jako "${instanceName}"`);
  return getInstance(instance.id);
}

/* ------------------------------------------------------------------ */
/* API modułu                                                          */
/* ------------------------------------------------------------------ */

/** Analizuje wskazany plik i zwraca podgląd + token do importu. */
export function previewPack(zipFile: string): { token: string; preview: PackPreview } {
  const kind = detectPackKind(zipFile);
  const preview = kind === 'mrpack' ? previewMrpack(zipFile) : previewCurseForge(zipFile);
  return { token: storePreview(zipFile, preview), preview };
}

/** Rejestruje ręcznie wskazany plik dla brakującego moda CurseForge. */
export function setManualFile(token: string, fileName: string, localPath: string): void {
  getPreview(token).manual.set(fileName, localPath);
}

export async function importPack(
  token: string,
  instanceName: string,
  defaults: { memoryMin: number; memoryMax: number; jvmArgs: string },
  onProgress?: (p: DownloadProgress) => void,
): Promise<Instance> {
  const entry = getPreview(token);
  const instance =
    entry.preview.kind === 'mrpack'
      ? await importMrpack(entry.file, instanceName, defaults, onProgress)
      : await importCurseForge(entry.file, instanceName, entry.manual, defaults, onProgress);
  previews.delete(token);
  return instance;
}

export interface PackRepairResult {
  manifestFound: boolean;
  checked: number;
  repaired: number;
  missing: number;
  warnings: string[];
}

/** Weryfikuje i ponownie pobiera pliki zadeklarowane przez zaimportowaną paczkę. */
export async function repairPackFiles(
  instanceId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<PackRepairResult> {
  const instance = getInstance(instanceId);
  const lock = await readPackLock(instance);
  if (!lock) return { manifestFound: false, checked: 0, repaired: 0, missing: 0, warnings: [] };

  const gameDir = path.join(instance.dir, 'minecraft');
  const queue = new DownloadQueue({ onProgress, phase: `Naprawa paczki „${lock.name}”` });
  const warnings: string[] = [];
  let repaired = 0;
  let missing = 0;
  const apiKey = lock.kind === 'curseforge' ? await getSecret(SECRET_KEYS.curseforgeApiKey()) : null;

  for (const item of lock.files) {
    if (item.source === 'download') {
      const rel = validatePackFilePath(item.path);
      const dest = path.join(gameDir, ...rel.split('/'));
      if (await verifyFile(dest, { size: item.size, sha1: item.sha1 })) continue;
      const url = item.downloads.find((candidate) => isAllowedUrl(candidate));
      if (!url) {
        missing++;
        warnings.push(`${rel}: brak bezpiecznego adresu pobierania.`);
        continue;
      }
      queue.add({ id: rel, url, dest, size: item.size, sha1: item.sha1, label: path.basename(rel) });
      repaired++;
      continue;
    }

    if (!apiKey) {
      missing++;
      continue;
    }
    const info = await curseForgeFileInfo(item.projectID, item.fileID, apiKey);
    if (!info?.downloadUrl) {
      missing++;
      warnings.push(`CurseForge ${item.projectID}/${item.fileID}: pobieranie przez aplikacje zewnętrzne jest niedostępne.`);
      continue;
    }
    const dest = path.join(gameDir, 'mods', path.basename(info.fileName));
    const sha1 = info.hashes?.find((hash) => hash.algo === 1)?.value;
    if (await verifyFile(dest, { size: info.fileLength, sha1 })) continue;
    queue.add({
      id: `cf-${item.projectID}-${item.fileID}`,
      url: info.downloadUrl,
      dest,
      size: info.fileLength,
      sha1,
      label: info.displayName,
    });
    repaired++;
  }

  if (!apiKey && lock.kind === 'curseforge' && lock.files.length > 0) {
    warnings.unshift('Brak klucza API CurseForge — nie można automatycznie sprawdzić ani pobrać wymaganych modów.');
  }

  if (queue.size > 0) {
    const result = await queue.run();
    if (!result.ok && !result.cancelled) {
      throw new PackError(`Nie udało się naprawić ${result.failed.length} plików paczki.`, result.failed[0]?.error);
    }
  }
  refreshModCount(instanceId);
  for (const warning of warnings) log.warn(`Naprawa paczki: ${warning}`, instanceId);
  return { manifestFound: true, checked: lock.files.length, repaired, missing, warnings };
}
