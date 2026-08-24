/**
 * Mody z Modrinth + zarządzanie modami instancji.
 *
 * Dokumentacja API: https://docs.modrinth.com/api/
 *
 * Dostęp do modów NIE zależy od typu profilu - profil Offline / Non-Premium
 * korzysta z Modrinth dokładnie tak samo jak konto Premium.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ENDPOINTS } from '../shared/constants.js';
import { fetchJson } from './net.js';
import { DownloadQueue, hashFile } from './downloader.js';
import { db } from './db.js';
import { getInstance, refreshModCount } from './instances.js';
import { log } from './logging.js';
import type {
  DownloadProgress,
  Instance,
  LoaderId,
  ModFile,
  ModrinthSearchResult,
  ModrinthVersion,
} from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Zgodność                                                            */
/* ------------------------------------------------------------------ */

export class ModCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModCompatibilityError';
  }
}

/** Nazwa loadera używana przez Modrinth. */
export function modrinthLoader(loader: LoaderId): string | null {
  return loader === 'vanilla' ? null : loader;
}

/**
 * Sprawdza, czy wersja moda pasuje do instancji.
 *
 * Blokujemy:
 *  - mod Forge w instancji Fabric,
 *  - mod Fabric w instancji NeoForge,
 *  - mod dla innej wersji Minecrafta.
 *
 * NeoForge celowo akceptuje mody oznaczone jako `neoforge`; część modów Forge
 * działa też na NeoForge, ale Modrinth oznacza je wtedy oboma tagami, więc
 * poleganie na tagach jest poprawne.
 */
export function checkModCompatibility(
  version: { loaders: string[]; game_versions: string[]; name?: string },
  instance: { loader: LoaderId; mcVersion: string },
): { ok: true } | { ok: false; reason: string } {
  const label = version.name ?? 'Ten mod';

  if (!version.game_versions.includes(instance.mcVersion)) {
    return {
      ok: false,
      reason: `${label} nie obsługuje Minecraft ${instance.mcVersion} (obsługiwane: ${version.game_versions.slice(-6).join(', ')}).`,
    };
  }

  if (instance.loader === 'vanilla') {
    return { ok: false, reason: 'Instancja Vanilla nie obsługuje modów. Dodaj Fabric, Forge albo NeoForge.' };
  }

  const wanted = modrinthLoader(instance.loader)!;
  const normalized = version.loaders.map((l) => l.toLowerCase());
  if (!normalized.includes(wanted)) {
    return {
      ok: false,
      reason: `${label} jest przeznaczony dla: ${version.loaders.join(', ')}, a instancja używa ${instance.loader}.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Modrinth API                                                        */
/* ------------------------------------------------------------------ */

export interface SearchOptions {
  query: string;
  mcVersion?: string;
  loader?: string;
  categories?: string[];
  offset?: number;
  limit?: number;
  projectType?: 'mod' | 'modpack' | 'resourcepack' | 'shader';
}

export async function searchMods(opts: SearchOptions): Promise<ModrinthSearchResult> {
  const facets: string[][] = [[`project_type:${opts.projectType ?? 'mod'}`]];
  if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`]);
  if (opts.loader) facets.push([`categories:${opts.loader}`]);
  for (const cat of opts.categories ?? []) facets.push([`categories:${cat}`]);

  const url = new URL(`${ENDPOINTS.modrinthApi}/search`);
  url.searchParams.set('query', opts.query);
  url.searchParams.set('facets', JSON.stringify(facets));
  url.searchParams.set('offset', String(opts.offset ?? 0));
  url.searchParams.set('limit', String(Math.min(opts.limit ?? 20, 100)));
  url.searchParams.set('index', opts.query ? 'relevance' : 'downloads');

  return fetchJson<ModrinthSearchResult>(url.toString());
}

export async function projectVersions(
  projectId: string,
  filters: { mcVersion?: string; loader?: string } = {},
): Promise<ModrinthVersion[]> {
  const url = new URL(`${ENDPOINTS.modrinthApi}/project/${encodeURIComponent(projectId)}/version`);
  if (filters.mcVersion) url.searchParams.set('game_versions', JSON.stringify([filters.mcVersion]));
  if (filters.loader) url.searchParams.set('loaders', JSON.stringify([filters.loader]));
  const versions = await fetchJson<ModrinthVersion[]>(url.toString());
  return Array.isArray(versions) ? versions : [];
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  return fetchJson<ModrinthVersion>(`${ENDPOINTS.modrinthApi}/version/${encodeURIComponent(versionId)}`);
}

/** Wyszukuje wersje modów po sumie SHA-1 pliku (do wykrywania aktualizacji). */
export async function versionsFromHashes(hashes: string[]): Promise<Record<string, ModrinthVersion>> {
  if (hashes.length === 0) return {};
  const res = await fetchJson<Record<string, ModrinthVersion>>(`${ENDPOINTS.modrinthApi}/version_files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  return res ?? {};
}

/* ------------------------------------------------------------------ */
/* Mody instancji                                                      */
/* ------------------------------------------------------------------ */

export function modsDir(instance: Instance): string {
  return path.join(instance.dir, 'minecraft', 'mods');
}

export async function listMods(instanceId: string): Promise<ModFile[]> {
  const instance = getInstance(instanceId);
  const dir = modsDir(instance);
  await fsp.mkdir(dir, { recursive: true });

  const rows = db().prepare(`SELECT * FROM instance_mods WHERE instance_id = ?`).all(instanceId);
  const meta = new Map<string, any>(rows.map((r: any) => [String(r.file_name), r]));

  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out: ModFile[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.jar(\.disabled)?$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    const stat = await fsp.stat(full);
    const enabled = !e.name.endsWith('.disabled');
    const baseName = enabled ? e.name : e.name.slice(0, -'.disabled'.length);
    const m = meta.get(baseName) ?? meta.get(e.name);
    out.push({
      fileName: e.name,
      path: full,
      enabled,
      size: stat.size,
      projectId: m?.project_id ?? undefined,
      versionId: m?.version_id ?? undefined,
      displayName: m?.display_name ?? baseName.replace(/\.jar$/i, ''),
      loaders: m?.loaders ? String(m.loaders).split(',') : undefined,
      gameVersions: m?.game_versions ? String(m.game_versions).split(',') : undefined,
      sha1: m?.sha1 ?? undefined,
    });
  }
  out.sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'pl'));
  return out;
}

/** Włącza/wyłącza mod przez sufiks `.disabled`. */
export async function toggleMod(instanceId: string, fileName: string): Promise<ModFile[]> {
  const instance = getInstance(instanceId);
  const dir = modsDir(instance);
  const src = path.join(dir, fileName);
  if (!fs.existsSync(src) || path.dirname(path.resolve(src)) !== path.resolve(dir)) {
    throw new Error(`Nie znaleziono moda "${fileName}" w tej instancji`);
  }
  const dest = fileName.endsWith('.disabled')
    ? path.join(dir, fileName.slice(0, -'.disabled'.length))
    : path.join(dir, `${fileName}.disabled`);
  await fsp.rename(src, dest);
  refreshModCount(instanceId);
  return listMods(instanceId);
}

export async function deleteMod(instanceId: string, fileName: string): Promise<ModFile[]> {
  const instance = getInstance(instanceId);
  const dir = modsDir(instance);
  const target = path.join(dir, fileName);
  if (path.dirname(path.resolve(target)) !== path.resolve(dir)) {
    throw new Error('Odrzucono ścieżkę spoza katalogu modów');
  }
  await fsp.rm(target, { force: true });
  db().prepare(`DELETE FROM instance_mods WHERE instance_id = ? AND file_name = ?`).run(instanceId, fileName.replace(/\.disabled$/, ''));
  refreshModCount(instanceId);
  return listMods(instanceId);
}

/* ------------------------------------------------------------------ */
/* Instalacja                                                          */
/* ------------------------------------------------------------------ */

export interface InstallModResult {
  installed: { name: string; fileName: string }[];
  skipped: { name: string; reason: string }[];
}

/**
 * Instaluje wersję moda wraz z zależnościami wymaganymi.
 * Zależności niezgodne z instancją są POMIJANE z czytelnym powodem,
 * a nie instalowane na siłę.
 */
export async function installMod(
  instanceId: string,
  versionId: string,
  opts: { withDependencies?: boolean; onProgress?: (p: DownloadProgress) => void } = {},
): Promise<InstallModResult> {
  const instance = getInstance(instanceId);
  const result: InstallModResult = { installed: [], skipped: [] };
  const queue = new DownloadQueue({ onProgress: opts.onProgress, phase: 'Pobieranie modów' });
  const pending: { version: ModrinthVersion; dest: string }[] = [];
  const visited = new Set<string>();

  const enqueue = async (vid: string, depth: number): Promise<void> => {
    if (visited.has(vid) || depth > 4) return;
    visited.add(vid);

    const version = await getVersion(vid);
    const compat = checkModCompatibility(version, instance);
    if (!compat.ok) {
      result.skipped.push({ name: version.name, reason: compat.reason });
      return;
    }
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) {
      result.skipped.push({ name: version.name, reason: 'Wersja nie zawiera pliku do pobrania.' });
      return;
    }
    const dest = path.join(modsDir(instance), file.filename);
    queue.add({
      id: vid,
      url: file.url,
      dest,
      sha1: file.hashes.sha1,
      size: file.size,
      label: version.name,
    });
    pending.push({ version, dest });

    if (opts.withDependencies !== false) {
      for (const dep of version.dependencies) {
        if (dep.dependency_type !== 'required') continue;
        if (dep.version_id) {
          await enqueue(dep.version_id, depth + 1);
        } else if (dep.project_id) {
          const candidates = await projectVersions(dep.project_id, {
            mcVersion: instance.mcVersion,
            loader: modrinthLoader(instance.loader) ?? undefined,
          });
          const best = candidates.find((c) => c.version_type === 'release') ?? candidates[0];
          if (best) await enqueue(best.id, depth + 1);
          else result.skipped.push({ name: dep.project_id, reason: 'Brak zgodnej wersji zależności.' });
        }
      }
    }
  };

  await enqueue(versionId, 0);

  if (queue.size > 0) {
    await fsp.mkdir(modsDir(instance), { recursive: true });
    const dl = await queue.run();
    if (!dl.ok && !dl.cancelled) {
      throw new Error(`Nie udało się pobrać ${dl.failed.length} plików: ${dl.failed[0]?.error ?? ''}`);
    }
  }

  const stmt = db().prepare(
    `INSERT INTO instance_mods (instance_id, file_name, project_id, version_id, display_name, loaders, game_versions, sha1)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, file_name) DO UPDATE SET
       project_id = excluded.project_id, version_id = excluded.version_id,
       display_name = excluded.display_name, loaders = excluded.loaders,
       game_versions = excluded.game_versions, sha1 = excluded.sha1`,
  );
  for (const { version, dest } of pending) {
    if (!fs.existsSync(dest)) continue;
    stmt.run(
      instanceId,
      path.basename(dest),
      version.project_id,
      version.id,
      version.name,
      version.loaders.join(','),
      version.game_versions.join(','),
      await hashFile(dest, 'sha1'),
    );
    result.installed.push({ name: version.name, fileName: path.basename(dest) });
  }

  refreshModCount(instanceId);
  log.info(`Zainstalowano ${result.installed.length} modów (pominięto ${result.skipped.length})`, instanceId);
  return result;
}

/* ------------------------------------------------------------------ */
/* Aktualizacje modów                                                  */
/* ------------------------------------------------------------------ */

export interface ModUpdate {
  fileName: string;
  currentName: string;
  newVersionId: string;
  newVersionNumber: string;
  newFileName: string;
}

/** Sprawdza dostępne aktualizacje modów przez API Modrinth (po sumach SHA-1). */
export async function checkModUpdates(instanceId: string): Promise<ModUpdate[]> {
  const instance = getInstance(instanceId);
  const mods = await listMods(instanceId);
  const loader = modrinthLoader(instance.loader);
  if (!loader) return [];

  const hashes: string[] = [];
  const byHash = new Map<string, ModFile>();
  for (const mod of mods) {
    if (!mod.enabled) continue;
    const sha1 = mod.sha1 ?? (await hashFile(mod.path, 'sha1'));
    hashes.push(sha1);
    byHash.set(sha1, mod);
  }
  if (hashes.length === 0) return [];

  const updates: ModUpdate[] = [];
  const res = await fetchJson<Record<string, ModrinthVersion>>(
    `${ENDPOINTS.modrinthApi}/version_files/update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hashes,
        algorithm: 'sha1',
        loaders: [loader],
        game_versions: [instance.mcVersion],
      }),
    },
  );

  for (const [hash, version] of Object.entries(res ?? {})) {
    const current = byHash.get(hash);
    if (!current) continue;
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file || file.filename === current.fileName) continue;
    updates.push({
      fileName: current.fileName,
      currentName: current.displayName ?? current.fileName,
      newVersionId: version.id,
      newVersionNumber: version.version_number,
      newFileName: file.filename,
    });
  }
  return updates;
}

/** Wykrywa duplikaty tego samego projektu w katalogu modów. */
export function detectConflicts(mods: ModFile[]): { projectId: string; files: string[] }[] {
  const byProject = new Map<string, string[]>();
  for (const mod of mods) {
    if (!mod.projectId) continue;
    const list = byProject.get(mod.projectId) ?? [];
    list.push(mod.fileName);
    byProject.set(mod.projectId, list);
  }
  return [...byProject.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([projectId, files]) => ({ projectId, files }));
}
