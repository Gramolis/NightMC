/**
 * Instancje gry: tworzenie, instalacja, naprawa, eksport, import.
 *
 * Każda instancja ma własny katalog `minecraft` (świat, mody, configi, logi),
 * ale biblioteki, assety i JAR-y klienta są WSPÓŁDZIELONE w %APPDATA%\NightMC\shared,
 * dzięki czemu dwie instancje na tej samej wersji nie pobierają dwa razy tego samego.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { DEFAULT_JVM_ARGS, LIMITS } from '../shared/constants.js';
import { db } from './db.js';
import {
  assetsDir,
  instanceDir,
  instanceGameDir,
  instancesDir,
  librariesDir,
  sanitizeFileName,
  versionsDir,
} from './paths.js';
import {
  assetObjectPath,
  assetUrl,
  currentOsContext,
  getVersionJson,
  parseAssetIndex,
  resolveLibraries,
  resolveVersionChain,
} from './minecraft.js';
import { DownloadQueue, hashFile, verifyFile } from './downloader.js';
import { extractArchive, extractNatives } from './zipsafe.js';
import { installFabric, installForgeLike, loadVersionProfile } from './modloaders.js';
import { detectJava, javaRequirementFor, pickJavaFor } from './java.js';
import { log } from './logging.js';
import type {
  AssetIndex,
  DownloadProgress,
  Instance,
  InstanceCreateOptions,
  LoaderId,
  VersionJson,
} from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Mapowanie wiersz <-> obiekt                                         */
/* ------------------------------------------------------------------ */

function rowToInstance(r: any): Instance {
  return {
    id: String(r.id),
    name: String(r.name),
    icon: r.icon ?? undefined,
    mcVersion: String(r.mc_version),
    loader: String(r.loader) as LoaderId,
    loaderVersion: r.loader_version ?? undefined,
    versionId: String(r.version_id),
    javaPath: r.java_path ?? undefined,
    memoryMin: Number(r.memory_min),
    memoryMax: Number(r.memory_max),
    jvmArgs: String(r.jvm_args ?? ''),
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    fullscreen: Number(r.fullscreen) === 1,
    playTimeSeconds: Number(r.play_time ?? 0),
    lastPlayedAt: r.last_played_at ?? undefined,
    createdAt: Number(r.created_at),
    dir: r.dir_override ? String(r.dir_override) : instanceDir(String(r.id)),
    notes: r.notes ?? undefined,
    modCount: Number(r.mod_count ?? 0),
    lastError: r.last_error ?? undefined,
    installed: Number(r.installed) === 1,
  };
}

export function listInstances(): Instance[] {
  return db()
    .prepare(`SELECT * FROM instances ORDER BY COALESCE(last_played_at, created_at) DESC`)
    .all()
    .map(rowToInstance);
}

export function getInstance(id: string): Instance {
  const row = db().prepare(`SELECT * FROM instances WHERE id = ?`).get(id);
  if (!row) throw new Error(`Instancja "${id}" nie istnieje`);
  return rowToInstance(row);
}

/* ------------------------------------------------------------------ */
/* Tworzenie                                                           */
/* ------------------------------------------------------------------ */

function newInstanceId(): string {
  return `inst-${crypto.randomBytes(8).toString('hex')}`;
}

/** Identyfikator zainstalowanej wersji: vanilla używa id gry, loadery własnego. */
export function versionIdFor(loader: LoaderId, mcVersion: string, loaderVersion?: string): string {
  switch (loader) {
    case 'vanilla':
      return mcVersion;
    case 'fabric':
      return `fabric-loader-${loaderVersion}-${mcVersion}`;
    case 'forge':
      return `${mcVersion}-forge-${loaderVersion?.replace(`${mcVersion}-`, '')}`;
    case 'neoforge':
      return `neoforge-${loaderVersion}`;
    default:
      return mcVersion;
  }
}

export function createInstance(opts: InstanceCreateOptions, defaults: { memoryMin: number; memoryMax: number; jvmArgs: string }): Instance {
  const id = newInstanceId();
  const dir = instanceDir(id);
  fs.mkdirSync(path.join(dir, 'minecraft', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'minecraft', 'resourcepacks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'minecraft', 'shaderpacks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'minecraft', 'saves'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'minecraft', 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'minecraft', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'natives'), { recursive: true });

  const versionId = versionIdFor(opts.loader, opts.mcVersion, opts.loaderVersion);

  db()
    .prepare(
      `INSERT INTO instances
       (id, name, icon, mc_version, loader, loader_version, version_id, memory_min, memory_max, jvm_args,
        fullscreen, play_time, created_at, installed, mod_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0)`,
    )
    .run(
      id,
      opts.name.trim(),
      opts.icon ?? 'moon',
      opts.mcVersion,
      opts.loader,
      opts.loaderVersion ?? null,
      versionId,
      opts.memoryMin ?? defaults.memoryMin,
      opts.memoryMax ?? defaults.memoryMax,
      defaults.jvmArgs || DEFAULT_JVM_ARGS,
      Date.now(),
    );

  log.info(`Utworzono instancję "${opts.name}" (${opts.mcVersion} / ${opts.loader})`);
  return getInstance(id);
}

export function updateInstance(id: string, patch: Partial<Instance>): Instance {
  const map: Record<string, string> = {
    name: 'name',
    icon: 'icon',
    javaPath: 'java_path',
    memoryMin: 'memory_min',
    memoryMax: 'memory_max',
    jvmArgs: 'jvm_args',
    width: 'width',
    height: 'height',
    notes: 'notes',
    lastError: 'last_error',
    modCount: 'mod_count',
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (patch as any)[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (patch.fullscreen !== undefined) {
    sets.push('fullscreen = ?');
    params.push(patch.fullscreen ? 1 : 0);
  }
  if (patch.installed !== undefined) {
    sets.push('installed = ?');
    params.push(patch.installed ? 1 : 0);
  }
  if (sets.length === 0) return getInstance(id);
  params.push(id);
  db().prepare(`UPDATE instances SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getInstance(id);
}

export async function deleteInstance(id: string): Promise<void> {
  const inst = getInstance(id);
  await fsp.rm(inst.dir, { recursive: true, force: true });
  db().prepare(`DELETE FROM instance_mods WHERE instance_id = ?`).run(id);
  db().prepare(`DELETE FROM instances WHERE id = ?`).run(id);
  log.info(`Usunięto instancję "${inst.name}"`);
}

export async function duplicateInstance(id: string, newName: string): Promise<Instance> {
  const src = getInstance(id);
  const copy = createInstance(
    {
      name: newName,
      mcVersion: src.mcVersion,
      loader: src.loader,
      loaderVersion: src.loaderVersion,
      icon: src.icon,
      memoryMin: src.memoryMin,
      memoryMax: src.memoryMax,
    },
    { memoryMin: src.memoryMin, memoryMax: src.memoryMax, jvmArgs: src.jvmArgs },
  );
  await fsp.cp(path.join(src.dir, 'minecraft'), path.join(copy.dir, 'minecraft'), { recursive: true });
  db()
    .prepare(`INSERT INTO instance_mods SELECT ?, file_name, project_id, version_id, display_name, loaders, game_versions, sha1 FROM instance_mods WHERE instance_id = ?`)
    .run(copy.id, src.id);
  return updateInstance(copy.id, { installed: src.installed, modCount: src.modCount });
}

/* ------------------------------------------------------------------ */
/* Rozwiązywanie wersji                                                */
/* ------------------------------------------------------------------ */

/** Zwraca pełne (scalone) metadane wersji dla instancji. */
export async function resolveInstanceVersion(instance: Instance): Promise<VersionJson> {
  const loadParent = async (id: string): Promise<VersionJson> => {
    const local = await loadVersionProfile(id);
    if (local) return local;
    return getVersionJson(id);
  };

  let base: VersionJson | null = null;
  if (instance.loader === 'vanilla') {
    base = await getVersionJson(instance.mcVersion);
  } else {
    base = await loadVersionProfile(instance.versionId);
    if (!base) return installLoaderProfile(instance);
  }
  return resolveVersionChain(base, loadParent);
}

/** Instaluje profil modloadera, jeżeli jeszcze go nie ma. */
async function installLoaderProfile(instance: Instance, onProgress?: (p: DownloadProgress) => void): Promise<VersionJson> {
  if (!instance.loaderVersion) throw new Error(`Instancja "${instance.name}" nie ma wybranej wersji loadera`);

  if (instance.loader === 'fabric') {
    return installFabric(instance.mcVersion, instance.loaderVersion);
  }

  // Forge/NeoForge potrzebują vanilla client.jar oraz Javy do procesorów.
  const vanilla = await getVersionJson(instance.mcVersion);
  const clientJar = clientJarPath(instance.mcVersion);
  if (!fs.existsSync(clientJar)) {
    await downloadClientJar(vanilla, onProgress);
  }
  const installs = await detectJava();
  const java = pickJavaFor(javaRequirementFor(vanilla), installs);
  if (!java) {
    throw new Error(
      `Do instalacji ${instance.loader} potrzebna jest Java ${javaRequirementFor(vanilla)}. ` +
        'Pobierz ją w zakładce "Java i RAM".',
    );
  }

  return installForgeLike({
    mcVersion: instance.mcVersion,
    loader: instance.loader as 'forge' | 'neoforge',
    loaderVersion: instance.loaderVersion,
    javaPath: java.path,
    clientJar,
    onProgress,
  });
}

export function clientJarPath(mcVersion: string): string {
  return path.join(versionsDir(), mcVersion, `${mcVersion}.jar`);
}

async function downloadClientJar(version: VersionJson, onProgress?: (p: DownloadProgress) => void): Promise<void> {
  const client = version.downloads?.['client'];
  if (!client) throw new Error(`Wersja ${version.id} nie zawiera pliku klienta`);
  const dest = clientJarPath(version.id);
  const q = new DownloadQueue({ concurrency: 1, onProgress, phase: 'Pobieranie klienta gry' });
  q.add({ id: 'client', url: client.url, dest, sha1: client.sha1, size: client.size, label: `${version.id}.jar` });
  const res = await q.run();
  if (!res.ok) throw new Error(`Nie udało się pobrać klienta ${version.id}: ${res.failed[0]?.error ?? 'anulowano'}`);
}

/* ------------------------------------------------------------------ */
/* Instalacja / naprawa                                                */
/* ------------------------------------------------------------------ */

export interface InstallOptions {
  onProgress?: (p: DownloadProgress) => void;
  concurrency?: number;
  /** Wymuś ponowną weryfikację wszystkich plików (naprawa). */
  repair?: boolean;
  signal?: { cancel: () => void; queue?: DownloadQueue };
}

/**
 * Pełna instalacja instancji. Zwraca dopiero, gdy KAŻDY plik przeszedł weryfikację.
 */
export async function installInstance(instanceId: string, opts: InstallOptions = {}): Promise<VersionJson> {
  const instance = getInstance(instanceId);
  const ctx = currentOsContext();
  const progress = opts.onProgress;

  // 1. Profil loadera (jeśli trzeba).
  if (instance.loader !== 'vanilla' && !(await loadVersionProfile(instance.versionId))) {
    await installLoaderProfile(instance, progress);
  }

  // 2. Pełne metadane wersji.
  const version = await resolveInstanceVersion(instance);

  // 3. Klient gry (zawsze wersja bazowa vanilla).
  const baseVersionId = instance.mcVersion;
  const clientJar = clientJarPath(baseVersionId);
  const vanilla = await getVersionJson(baseVersionId);
  const clientArtifact = vanilla.downloads?.['client'];

  const queue = new DownloadQueue({
    concurrency: opts.concurrency ?? LIMITS.defaultConcurrency,
    onProgress: progress,
    phase: 'Pobieranie plików gry',
  });
  if (opts.signal) opts.signal.queue = queue;

  if (clientArtifact) {
    queue.add({
      id: 'client',
      url: clientArtifact.url,
      dest: clientJar,
      sha1: clientArtifact.sha1,
      size: clientArtifact.size,
      label: `${baseVersionId}.jar`,
    });
  }

  // 4. Biblioteki i natives.
  const libs = resolveLibraries(version, ctx);
  for (const lib of libs) {
    if (!lib.url) continue;
    queue.add({
      id: lib.relPath,
      url: lib.url,
      dest: path.join(librariesDir(), ...lib.relPath.split('/')),
      sha1: lib.sha1,
      size: lib.size,
      label: lib.library.name,
    });
  }

  // 5. Konfiguracja logowania (log4j).
  const logging = version.logging?.client?.file;
  if (logging) {
    queue.add({
      id: `log-${logging.id}`,
      url: logging.url,
      dest: path.join(assetsDir(), 'log_configs', logging.id),
      sha1: logging.sha1,
      size: logging.size,
      label: logging.id,
    });
  }

  // 6. Indeks assetów.
  let assetIndex: AssetIndex | null = null;
  if (version.assetIndex) {
    const indexPath = path.join(assetsDir(), 'indexes', `${version.assetIndex.id}.json`);
    const indexQueue = new DownloadQueue({ concurrency: 1, onProgress: progress, phase: 'Pobieranie indeksu assetów' });
    indexQueue.add({
      id: 'asset-index',
      url: version.assetIndex.url,
      dest: indexPath,
      sha1: version.assetIndex.sha1,
      size: version.assetIndex.size,
      label: `${version.assetIndex.id}.json`,
    });
    const r = await indexQueue.run();
    if (!r.ok) throw new Error(`Nie udało się pobrać indeksu assetów: ${r.failed[0]?.error ?? 'anulowano'}`);
    assetIndex = parseAssetIndex(JSON.parse(await fsp.readFile(indexPath, 'utf8')));

    for (const [name, obj] of Object.entries(assetIndex.objects)) {
      queue.add({
        id: `asset-${obj.hash}`,
        url: assetUrl(obj.hash),
        dest: path.join(assetsDir(), 'objects', ...assetObjectPath(obj.hash).split('/')),
        sha1: obj.hash,
        size: obj.size,
        label: name,
      });
    }
  }

  const result = await queue.run();
  if (result.cancelled) throw new Error('Instalacja anulowana');
  if (!result.ok) {
    const first = result.failed[0];
    throw new Error(
      `Instalacja nieukończona: ${result.failed.length} plików nie przeszło weryfikacji. Pierwszy błąd: ${first?.error ?? '-'}`,
    );
  }

  // 7. Rozpakowanie natives.
  const nativesDir = path.join(instance.dir, 'natives');
  await fsp.rm(nativesDir, { recursive: true, force: true });
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const lib of libs.filter((l) => l.isNative)) {
    const jar = path.join(librariesDir(), ...lib.relPath.split('/'));
    if (!fs.existsSync(jar)) continue;
    await extractNatives(jar, nativesDir, lib.excludes);
  }

  // 8. Assety "legacy"/"virtual" trzeba skopiować do resources.
  if (assetIndex && (assetIndex.virtual || assetIndex.map_to_resources) && version.assets) {
    await materializeVirtualAssets(assetIndex, version.assets, instance);
  }

  updateInstance(instanceId, { installed: true, lastError: undefined });
  db().prepare(`UPDATE instances SET last_verified_at = ? WHERE id = ?`).run(Date.now(), instanceId);
  log.info(`Instancja "${instance.name}" zainstalowana i zweryfikowana`, instanceId);
  return version;
}

/** Stare wersje (<=1.7) czytają assety jako zwykłe pliki. */
async function materializeVirtualAssets(index: AssetIndex, assetsId: string, instance: Instance): Promise<void> {
  const virtualRoot =
    assetsId === 'pre-1.6'
      ? path.join(instanceGameDir(instance.id), 'resources')
      : path.join(assetsDir(), 'virtual', assetsId);
  for (const [name, obj] of Object.entries(index.objects)) {
    const src = path.join(assetsDir(), 'objects', ...assetObjectPath(obj.hash).split('/'));
    const dest = path.join(virtualRoot, ...name.split('/'));
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

/** Naprawa: weryfikuje wszystkie pliki i pobiera brakujące/uszkodzone. */
export async function repairInstance(instanceId: string, opts: InstallOptions = {}): Promise<{ repaired: number }> {
  const instance = getInstance(instanceId);
  const version = await resolveInstanceVersion(instance);
  const ctx = currentOsContext();
  const libs = resolveLibraries(version, ctx);

  let broken = 0;
  for (const lib of libs) {
    const file = path.join(librariesDir(), ...lib.relPath.split('/'));
    if (!(await verifyFile(file, { sha1: lib.sha1, size: lib.size }))) {
      await fsp.rm(file, { force: true });
      broken++;
    }
  }
  const clientJar = clientJarPath(instance.mcVersion);
  const vanilla = await getVersionJson(instance.mcVersion);
  const client = vanilla.downloads?.['client'];
  if (client && !(await verifyFile(clientJar, { sha1: client.sha1, size: client.size }))) {
    await fsp.rm(clientJar, { force: true });
    broken++;
  }

  log.info(`Naprawa instancji "${instance.name}": ${broken} plików do ponownego pobrania`, instanceId);
  await installInstance(instanceId, opts);
  return { repaired: broken };
}

/* ------------------------------------------------------------------ */
/* Eksport / import / backup                                           */
/* ------------------------------------------------------------------ */

/** Eksportuje instancję do ZIP-a NightMC (mody, configi, świat, ustawienia). */
export async function exportInstance(instanceId: string, destFile: string): Promise<string> {
  const instance = getInstance(instanceId);
  const zip = new AdmZip();
  const meta = {
    format: 'nightmc-instance',
    formatVersion: 1,
    name: instance.name,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    memoryMin: instance.memoryMin,
    memoryMax: instance.memoryMax,
    jvmArgs: instance.jvmArgs,
    icon: instance.icon,
  };
  zip.addFile('nightmc-instance.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
  const gameDir = path.join(instance.dir, 'minecraft');
  if (fs.existsSync(gameDir)) zip.addLocalFolder(gameDir, 'minecraft');
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  zip.writeZip(destFile);
  log.info(`Wyeksportowano instancję "${instance.name}" do ${destFile}`);
  return destFile;
}

/** Importuje instancję z ZIP-a NightMC. */
export async function importInstance(
  zipFile: string,
  defaults: { memoryMin: number; memoryMax: number; jvmArgs: string },
): Promise<Instance> {
  const zip = new AdmZip(zipFile);
  const metaEntry = zip.getEntry('nightmc-instance.json');
  if (!metaEntry) throw new Error('To nie jest archiwum instancji NightMC (brak nightmc-instance.json)');
  const meta = JSON.parse(metaEntry.getData().toString('utf8'));

  const instance = createInstance(
    {
      name: String(meta.name ?? 'Zaimportowana instancja').slice(0, 64),
      mcVersion: String(meta.mcVersion),
      loader: (meta.loader ?? 'vanilla') as LoaderId,
      loaderVersion: meta.loaderVersion ?? undefined,
      icon: meta.icon ?? 'moon',
      memoryMin: Number(meta.memoryMin) || defaults.memoryMin,
      memoryMax: Number(meta.memoryMax) || defaults.memoryMax,
    },
    defaults,
  );

  // Wypakowujemy wyłącznie zawartość podkatalogu "minecraft" i tylko do niego.
  await extractArchive(zipFile, path.join(instance.dir, 'minecraft'), {
    stripPrefix: 'minecraft',
    overwrite: true,
  });
  return refreshModCount(instance.id);
}

/** Kopia zapasowa katalogu instancji. */
export async function backupInstance(instanceId: string, destDir: string): Promise<string> {
  const instance = getInstance(instanceId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(destDir, `${sanitizeFileName(instance.name)}-${stamp}.zip`);
  return exportInstance(instanceId, dest);
}

/** Odświeża licznik modów w bazie. */
export function refreshModCount(instanceId: string): Instance {
  const instance = getInstance(instanceId);
  const modsDir = path.join(instance.dir, 'minecraft', 'mods');
  let count = 0;
  try {
    count = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')).length;
  } catch {
    count = 0;
  }
  return updateInstance(instanceId, { modCount: count });
}

/** Rejestruje zakończoną sesję gry. */
export function recordPlaySession(instanceId: string, seconds: number, exitCode: number | null, error?: string): void {
  db()
    .prepare(`UPDATE instances SET play_time = play_time + ?, last_played_at = ?, last_error = ? WHERE id = ?`)
    .run(Math.max(0, Math.round(seconds)), Date.now(), error ?? null, instanceId);
  db()
    .prepare(`INSERT INTO launch_history (instance_id, started_at, ended_at, exit_code, error) VALUES (?, ?, ?, ?, ?)`)
    .run(instanceId, Date.now() - seconds * 1000, Date.now(), exitCode, error ?? null);
}

/** Suma rozmiaru katalogu instancji (do UI). */
export async function instanceSize(instanceId: string): Promise<number> {
  const root = getInstance(instanceId).dir;
  let total = 0;
  const walk = async (dir: string, depth = 0): Promise<void> => {
    if (depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) total += (await fsp.stat(full)).size.valueOf();
    }
  };
  await walk(root);
  return total;
}

/** Sprawdza integralność pojedynczego pliku instancji (używane w testach naprawy). */
export async function fileChecksum(file: string): Promise<string | null> {
  try {
    return await hashFile(file, 'sha1');
  } catch {
    return null;
  }
}

export function instancesRoot(): string {
  return instancesDir();
}
