/** Kreator paczek łączący katalog Modrinth i CurseForge. */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ENDPOINTS } from '../shared/constants.js';
import type {
  DownloadProgress,
  LoaderId,
  PackBuilderItem,
  PackCatalogProject,
  PackCatalogVersion,
} from '../shared/types.js';
import { db } from './db.js';
import { DownloadQueue, hashFile } from './downloader.js';
import { getInstance, refreshModCount } from './instances.js';
import { installMod, modsDir, projectVersions, searchMods } from './mods.js';
import { fetchJson } from './net.js';
import { getSecret, SECRET_KEYS } from './secrets.js';
import { log } from './logging.js';

interface CurseForgeAuthor { name: string }
interface CurseForgeLogo { thumbnailUrl?: string }
interface CurseForgeProject {
  id: number;
  name: string;
  summary: string;
  downloadCount: number;
  authors?: CurseForgeAuthor[];
  logo?: CurseForgeLogo;
  allowModDistribution?: boolean | null;
  isAvailable?: boolean;
}
interface CurseForgeHash { value: string; algo: number }
interface CurseForgeDependency { modId: number; relationType: number }
interface CurseForgeFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  releaseType: number;
  fileDate: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions?: string[];
  hashes?: CurseForgeHash[];
  dependencies?: CurseForgeDependency[];
  isAvailable?: boolean;
}

const CF_GAME_ID = 432;
const CF_CLASS_MODS = 6;

export function curseForgeLoaderType(loader: LoaderId): number {
  if (loader === 'forge') return 1;
  if (loader === 'fabric') return 4;
  if (loader === 'neoforge') return 6;
  return 0;
}

function cfReleaseType(value: number): 'release' | 'beta' | 'alpha' {
  return value === 1 ? 'release' : value === 2 ? 'beta' : 'alpha';
}

async function curseForgeKey(): Promise<string> {
  const key = await getSecret(SECRET_KEYS.curseforgeApiKey());
  if (!key) throw new Error('Dodaj własny klucz API CurseForge w Ustawieniach, aby włączyć ten katalog.');
  return key;
}

function cfHeaders(key: string): Record<string, string> {
  return { 'x-api-key': key, Accept: 'application/json' };
}

export async function searchPackCatalog(input: {
  query: string;
  mcVersion: string;
  loader: Exclude<LoaderId, 'vanilla'>;
  sources: ('modrinth' | 'curseforge')[];
}): Promise<{ projects: PackCatalogProject[]; warnings: string[] }> {
  const projects: PackCatalogProject[] = [];
  const warnings: string[] = [];

  if (input.sources.includes('modrinth')) {
    const result = await searchMods({
      query: input.query,
      mcVersion: input.mcVersion,
      loader: input.loader,
      limit: 30,
    });
    projects.push(...result.hits.map((p) => ({
      source: 'modrinth' as const,
      projectId: p.project_id,
      title: p.title,
      description: p.description,
      author: p.author,
      iconUrl: p.icon_url,
      downloads: p.downloads,
      distributable: true,
    })));
  }

  if (input.sources.includes('curseforge')) {
    try {
      const key = await curseForgeKey();
      const url = new URL(`${ENDPOINTS.curseforgeApi}/mods/search`);
      url.searchParams.set('gameId', String(CF_GAME_ID));
      url.searchParams.set('classId', String(CF_CLASS_MODS));
      url.searchParams.set('gameVersion', input.mcVersion);
      url.searchParams.set('modLoaderType', String(curseForgeLoaderType(input.loader)));
      url.searchParams.set('pageSize', '30');
      url.searchParams.set('sortField', '2');
      url.searchParams.set('sortOrder', 'desc');
      if (input.query.trim()) url.searchParams.set('searchFilter', input.query.trim());
      const result = await fetchJson<{ data?: CurseForgeProject[] }>(url.toString(), { headers: cfHeaders(key) });
      projects.push(...(result.data ?? []).map((p) => ({
        source: 'curseforge' as const,
        projectId: String(p.id),
        title: p.name,
        description: p.summary,
        author: p.authors?.map((a) => a.name).join(', '),
        iconUrl: p.logo?.thumbnailUrl,
        downloads: p.downloadCount,
        distributable: p.isAvailable !== false && p.allowModDistribution !== false,
      })));
    } catch (e) {
      warnings.push((e as Error).message);
    }
  }

  projects.sort((a, b) => b.downloads - a.downloads);
  return { projects, warnings };
}

export async function packCatalogVersions(input: {
  source: 'modrinth' | 'curseforge';
  projectId: string;
  mcVersion: string;
  loader: Exclude<LoaderId, 'vanilla'>;
}): Promise<PackCatalogVersion[]> {
  if (input.source === 'modrinth') {
    const versions = await projectVersions(input.projectId, { mcVersion: input.mcVersion, loader: input.loader });
    return versions.map((v) => {
      const file = v.files.find((f) => f.primary) ?? v.files[0];
      return {
        source: 'modrinth', projectId: input.projectId, versionId: v.id,
        name: v.name, versionNumber: v.version_number, fileName: file?.filename ?? '',
        gameVersions: v.game_versions, loaders: v.loaders, releaseType: v.version_type,
        size: file?.size ?? 0, publishedAt: v.date_published, downloadable: Boolean(file),
      };
    });
  }

  const key = await curseForgeKey();
  const url = new URL(`${ENDPOINTS.curseforgeApi}/mods/${encodeURIComponent(input.projectId)}/files`);
  url.searchParams.set('gameVersion', input.mcVersion);
  url.searchParams.set('modLoaderType', String(curseForgeLoaderType(input.loader)));
  url.searchParams.set('pageSize', '50');
  const result = await fetchJson<{ data?: CurseForgeFile[] }>(url.toString(), { headers: cfHeaders(key) });
  return (result.data ?? []).map((f) => ({
    source: 'curseforge', projectId: input.projectId, versionId: String(f.id),
    name: f.displayName, versionNumber: f.displayName, fileName: f.fileName,
    gameVersions: f.gameVersions ?? [input.mcVersion], loaders: [input.loader], releaseType: cfReleaseType(f.releaseType),
    size: f.fileLength, publishedAt: f.fileDate, downloadable: f.isAvailable !== false && Boolean(f.downloadUrl),
  }));
}

async function cfProject(projectId: string, key: string): Promise<CurseForgeProject> {
  const result = await fetchJson<{ data: CurseForgeProject }>(
    `${ENDPOINTS.curseforgeApi}/mods/${encodeURIComponent(projectId)}`,
    { headers: cfHeaders(key) },
  );
  return result.data;
}

async function cfFile(projectId: string, fileId: string, key: string): Promise<CurseForgeFile> {
  const result = await fetchJson<{ data: CurseForgeFile }>(
    `${ENDPOINTS.curseforgeApi}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    { headers: cfHeaders(key) },
  );
  return result.data;
}

async function latestCfFile(projectId: number, mcVersion: string, loader: LoaderId, key: string): Promise<CurseForgeFile | undefined> {
  const url = new URL(`${ENDPOINTS.curseforgeApi}/mods/${projectId}/files`);
  url.searchParams.set('gameVersion', mcVersion);
  url.searchParams.set('modLoaderType', String(curseForgeLoaderType(loader)));
  url.searchParams.set('pageSize', '50');
  const result = await fetchJson<{ data?: CurseForgeFile[] }>(url.toString(), { headers: cfHeaders(key) });
  return (result.data ?? []).find((f) => f.releaseType === 1 && f.downloadUrl) ?? (result.data ?? []).find((f) => f.downloadUrl);
}

async function installCurseForge(
  instanceId: string,
  projectId: string,
  fileId: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ installed: string[]; skipped: string[] }> {
  const instance = getInstance(instanceId);
  const key = await curseForgeKey();
  const queue = new DownloadQueue({ onProgress, phase: 'Pobieranie modów z CurseForge' });
  const pending: { project: CurseForgeProject; file: CurseForgeFile; dest: string }[] = [];
  const skipped: string[] = [];
  const visited = new Set<number>();

  const enqueue = async (pid: string, fid: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const file = await cfFile(pid, fid, key);
    if (visited.has(file.id)) return;
    visited.add(file.id);
    const project = await cfProject(pid, key);
    if (project.allowModDistribution === false || project.isAvailable === false || !file.downloadUrl) {
      skipped.push(`${project.name}: autor wyłączył dystrybucję przez aplikacje zewnętrzne.`);
      return;
    }
    if (file.gameVersions?.length && !file.gameVersions.includes(instance.mcVersion)) {
      skipped.push(`${project.name}: plik nie obsługuje Minecraft ${instance.mcVersion}.`);
      return;
    }
    const dest = path.join(modsDir(instance), file.fileName);
    queue.add({
      id: `cf-${file.id}`, url: file.downloadUrl, dest, size: file.fileLength,
      sha1: file.hashes?.find((h) => h.algo === 1)?.value, label: project.name,
    });
    pending.push({ project, file, dest });

    for (const dep of file.dependencies ?? []) {
      if (dep.relationType !== 3) continue;
      const depFile = await latestCfFile(dep.modId, instance.mcVersion, instance.loader, key);
      if (depFile) await enqueue(String(dep.modId), String(depFile.id), depth + 1);
      else skipped.push(`Zależność CurseForge ${dep.modId}: brak zgodnego pliku.`);
    }
  };

  await enqueue(projectId, fileId, 0);
  await fsp.mkdir(modsDir(instance), { recursive: true });
  if (queue.size > 0) {
    const result = await queue.run();
    if (!result.ok && !result.cancelled) throw new Error(`Nie udało się pobrać ${result.failed.length} plików CurseForge.`);
  }

  const stmt = db().prepare(
    `INSERT INTO instance_mods (instance_id, file_name, project_id, version_id, display_name, loaders, game_versions, sha1)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id, file_name) DO UPDATE SET project_id=excluded.project_id, version_id=excluded.version_id,
       display_name=excluded.display_name, loaders=excluded.loaders, game_versions=excluded.game_versions, sha1=excluded.sha1`,
  );
  const installed: string[] = [];
  for (const item of pending) {
    if (!fs.existsSync(item.dest)) continue;
    stmt.run(instanceId, item.file.fileName, `curseforge:${item.project.id}`, `curseforge:${item.file.id}`,
      item.project.name, instance.loader, instance.mcVersion, await hashFile(item.dest, 'sha1'));
    installed.push(item.project.name);
  }
  refreshModCount(instanceId);
  return { installed, skipped };
}

export async function installPackBuilderItems(
  instanceId: string,
  items: PackBuilderItem[],
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ installed: string[]; skipped: string[] }> {
  const instance = getInstance(instanceId);
  if (instance.loader === 'vanilla') throw new Error('Wybierz instancję Fabric, Forge albo NeoForge.');
  const installed: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.source}:${item.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.source === 'modrinth') {
      const result = await installMod(instanceId, item.versionId, { withDependencies: true, onProgress });
      installed.push(...result.installed.map((x) => x.name));
      skipped.push(...result.skipped.map((x) => `${x.name}: ${x.reason}`));
    } else {
      const result = await installCurseForge(instanceId, item.projectId, item.versionId, onProgress);
      installed.push(...result.installed);
      skipped.push(...result.skipped);
    }
  }
  for (const warning of skipped) log.warn(`Kreator paczki: ${warning}`, instanceId);
  log.info(`Kreator paczki: zainstalowano ${installed.length}, pominięto ${skipped.length}`, instanceId);
  return { installed, skipped };
}
