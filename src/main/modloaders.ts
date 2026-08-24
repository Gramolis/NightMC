/**
 * Modloadery: Fabric, Forge, NeoForge.
 *
 * Każdy loader instaluje się inaczej i NightMC tego nie spłaszcza:
 *  - Fabric udostępnia gotowy profil JSON przez swoje meta API,
 *  - Forge/NeoForge dostarczają instalator JAR z `install_profile.json`,
 *    który dla 1.13+ wymaga uruchomienia procesorów (binary patching),
 *    a dla starszych wersji zawiera po prostu `versionInfo`.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { XMLParser } from 'fast-xml-parser';
import { ENDPOINTS } from '../shared/constants.js';
import { fetchJson, fetchText, MemoryCache } from './net.js';
import { DownloadQueue } from './downloader.js';
import { extractArchive, readArchiveEntry } from './zipsafe.js';
import { librariesDir, tempDir, versionsDir } from './paths.js';
import { mavenToPath, mavenUrl } from './minecraft.js';
import { log } from './logging.js';
import type { DownloadProgress, Library, LoaderId, LoaderVersion, VersionJson } from '../shared/types.js';

const execFileAsync = promisify(execFile);
const loaderCache = new MemoryCache<LoaderVersion[]>(15 * 60 * 1000);

export class LoaderError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'LoaderError';
  }
}

/* ================================================================== */
/* FABRIC                                                             */
/* ================================================================== */

interface FabricLoaderEntry {
  loader: { version: string; stable: boolean; build: number };
  intermediary: { version: string; stable: boolean };
}

export async function fabricVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const key = `fabric:${mcVersion}`;
  const hit = loaderCache.get(key);
  if (hit) return hit;

  const data = await fetchJson<FabricLoaderEntry[]>(`${ENDPOINTS.fabricMeta}/loader/${encodeURIComponent(mcVersion)}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new LoaderError(
      `Fabric nie obsługuje wersji Minecraft ${mcVersion}.`,
      'Wybierz inną wersję gry albo inny modloader.',
    );
  }
  const out = data.map((d, i) => ({
    version: d.loader.version,
    stable: d.loader.stable,
    mcVersion,
    latest: i === 0,
    recommended: d.loader.stable,
  }));
  loaderCache.set(key, out);
  return out;
}

/** Fabric udostępnia gotowy profil - wystarczy go zapisać. */
export async function installFabric(mcVersion: string, loaderVersion: string): Promise<VersionJson> {
  const url = `${ENDPOINTS.fabricMeta}/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile = await fetchJson<VersionJson>(url);
  if (!profile.id || !profile.mainClass) {
    throw new LoaderError('Fabric zwrócił niekompletny profil wersji.');
  }
  await saveVersionProfile(profile);
  log.info(`Zainstalowano profil Fabric ${loaderVersion} dla Minecraft ${mcVersion}`);
  return profile;
}

/* ================================================================== */
/* FORGE / NEOFORGE - wspólna logika instalatora                       */
/* ================================================================== */

export function parseMavenMetadata(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml) as any;
  const versions = doc?.metadata?.versioning?.versions?.version;
  if (!versions) return [];
  return (Array.isArray(versions) ? versions : [versions]).map(String);
}

/** Wersje Forge dla danej wersji gry (metadata ma format "1.20.1-47.2.0"). */
export async function forgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const key = `forge:${mcVersion}`;
  const hit = loaderCache.get(key);
  if (hit) return hit;

  const xml = await fetchText(ENDPOINTS.forgeMetadata, { maxBytes: 8 * 1024 * 1024 });
  const all = parseMavenMetadata(xml);
  const prefix = `${mcVersion}-`;
  const matching = all.filter((v) => v.startsWith(prefix)).reverse();

  if (matching.length === 0) {
    throw new LoaderError(
      `Forge nie ma wydania dla Minecraft ${mcVersion}.`,
      'Sprawdź inną wersję gry albo wybierz Fabric/NeoForge.',
    );
  }
  const out: LoaderVersion[] = matching.map((full, i) => ({
    version: full,
    stable: true,
    mcVersion,
    latest: i === 0,
    recommended: i === 0,
  }));
  loaderCache.set(key, out);
  return out;
}

/** Wersje NeoForge. Format: "20.4.190" gdzie 20.4 odpowiada Minecraft 1.20.4. */
export async function neoforgeVersions(mcVersion: string): Promise<LoaderVersion[]> {
  const key = `neoforge:${mcVersion}`;
  const hit = loaderCache.get(key);
  if (hit) return hit;

  const xml = await fetchText(ENDPOINTS.neoforgeMetadata, { maxBytes: 8 * 1024 * 1024 });
  const all = parseMavenMetadata(xml);
  const prefix = neoforgePrefix(mcVersion);
  const matching = all.filter((v) => v.startsWith(prefix)).reverse();

  if (matching.length === 0) {
    throw new LoaderError(
      `NeoForge nie ma wydania dla Minecraft ${mcVersion}.`,
      'NeoForge istnieje od Minecraft 1.20.1. Dla starszych wersji użyj Forge.',
    );
  }
  const out: LoaderVersion[] = matching.map((full, i) => ({
    version: full,
    stable: !full.includes('beta'),
    mcVersion,
    latest: i === 0,
    recommended: i === 0 && !full.includes('beta'),
  }));
  loaderCache.set(key, out);
  return out;
}

/** "1.20.4" -> "20.4."; "1.21" -> "21.0." */
export function neoforgePrefix(mcVersion: string): string {
  const parts = mcVersion.split('.');
  if (parts[0] !== '1' || parts.length < 2) return mcVersion;
  const minor = parts[1]!;
  const patch = parts[2] ?? '0';
  return `${minor}.${patch}.`;
}

function installerCoords(loader: 'forge' | 'neoforge', version: string): { name: string; base: string } {
  return loader === 'forge'
    ? { name: `net.minecraftforge:forge:${version}:installer`, base: ENDPOINTS.forgeMaven }
    : { name: `net.neoforged:neoforge:${version}:installer`, base: ENDPOINTS.neoforgeMaven };
}

/* ------------------------------------------------------------------ */
/* Profil instalacyjny                                                 */
/* ------------------------------------------------------------------ */

export interface InstallProfile {
  spec?: number;
  version?: string;
  minecraft?: string;
  json?: string;
  path?: string;
  libraries?: Library[];
  processors?: {
    sides?: string[];
    jar: string;
    classpath: string[];
    args: string[];
    outputs?: Record<string, string>;
  }[];
  data?: Record<string, { client: string; server: string }>;
  /** Format < 1.13 */
  install?: { path?: string; filePath?: string; version?: string; minecraft?: string };
  versionInfo?: VersionJson;
}

/**
 * Rozwiązuje wartość z sekcji `data` profilu instalacyjnego.
 *  - `[maven:coords]` -> ścieżka w katalogu bibliotek,
 *  - `'literal'`      -> tekst dosłowny,
 *  - `/sciezka`       -> plik wypakowany z instalatora.
 */
export function resolveDataValue(
  raw: string,
  ctx: { librariesRoot: string; installerRoot: string },
): string {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return path.join(ctx.librariesRoot, ...mavenToPath(raw.slice(1, -1)).split('/'));
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith('/')) return path.join(ctx.installerRoot, ...raw.slice(1).split('/'));
  return raw;
}

/** Podstawia {KLUCZ} w argumentach procesora. */
export function substituteProcessorArg(
  arg: string,
  values: Record<string, string>,
  ctx: { librariesRoot: string },
): string {
  let out = arg.replace(/\{([A-Z0-9_]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : whole,
  );
  if (out.startsWith('[') && out.endsWith(']')) {
    out = path.join(ctx.librariesRoot, ...mavenToPath(out.slice(1, -1)).split('/'));
  }
  return out;
}

/** Odczytuje Main-Class z manifestu JAR-a procesora. */
export function readJarMainClass(jarPath: string): string {
  const manifest = readArchiveEntry(jarPath, 'META-INF/MANIFEST.MF', 512 * 1024);
  if (!manifest) throw new LoaderError(`JAR ${path.basename(jarPath)} nie ma manifestu`);
  // Manifest łamie długie linie - sklejamy kontynuacje zaczynające się spacją.
  const text = manifest.toString('utf8').replace(/\r\n/g, '\n').replace(/\n /g, '');
  const m = text.match(/^Main-Class:\s*(\S+)\s*$/m);
  if (!m) throw new LoaderError(`JAR ${path.basename(jarPath)} nie deklaruje Main-Class`);
  return m[1]!;
}

/* ------------------------------------------------------------------ */
/* Instalacja Forge / NeoForge                                         */
/* ------------------------------------------------------------------ */

export interface ForgeInstallContext {
  mcVersion: string;
  loader: 'forge' | 'neoforge';
  loaderVersion: string;
  /** Ścieżka do java.exe używana przez procesory instalatora. */
  javaPath: string;
  /** Ścieżka do vanilla client.jar - wymagana przez procesory. */
  clientJar: string;
  onProgress?: (p: DownloadProgress) => void;
}

export async function installForgeLike(ctx: ForgeInstallContext): Promise<VersionJson> {
  const { loader, loaderVersion } = ctx;
  const { name, base } = installerCoords(loader, loaderVersion);
  const installerJar = path.join(tempDir(), `${loader}-${loaderVersion}-installer.jar`);
  const workDir = path.join(tempDir(), `${loader}-${loaderVersion}-work`);

  await fsp.mkdir(tempDir(), { recursive: true });
  await fsp.rm(workDir, { recursive: true, force: true });

  // 1. Pobranie instalatora.
  const dl = new DownloadQueue({ concurrency: 1, onProgress: ctx.onProgress, phase: `Pobieranie instalatora ${loader}` });
  dl.add({ id: 'installer', url: mavenUrl(base, name), dest: installerJar, label: `${loader} ${loaderVersion} installer` });
  const dlRes = await dl.run();
  if (!dlRes.ok) {
    throw new LoaderError(
      `Nie udało się pobrać instalatora ${loader} ${loaderVersion}.`,
      dlRes.failed[0]?.error ?? 'Sprawdź połączenie i wybraną wersję loadera.',
    );
  }

  // 2. Rozpakowanie instalatora (bezpiecznie).
  await extractArchive(installerJar, workDir, { overwrite: true });

  const profilePath = path.join(workDir, 'install_profile.json');
  if (!fs.existsSync(profilePath)) {
    throw new LoaderError(`Instalator ${loader} ${loaderVersion} nie zawiera install_profile.json.`);
  }
  const profile = JSON.parse(await fsp.readFile(profilePath, 'utf8')) as InstallProfile;

  // 3a. Format < 1.13: cała wersja jest w `versionInfo`.
  if (profile.versionInfo && !profile.processors) {
    const versionJson = profile.versionInfo;
    // Uniwersalny JAR trzeba przenieść do katalogu bibliotek.
    const filePath = profile.install?.filePath;
    const targetCoords = profile.install?.path;
    if (filePath && targetCoords) {
      const src = path.join(workDir, ...filePath.split('/'));
      const dest = path.join(librariesDir(), ...mavenToPath(targetCoords).split('/'));
      if (fs.existsSync(src)) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(src, dest);
      }
    }
    await downloadLoaderLibraries(versionJson.libraries ?? [], ctx.onProgress);
    await saveVersionProfile(versionJson);
    await fsp.rm(workDir, { recursive: true, force: true });
    log.info(`Zainstalowano ${loader} ${loaderVersion} (format klasyczny)`);
    return versionJson;
  }

  // 3b. Format 1.13+: osobny version.json + procesory.
  const versionJsonPath = path.join(workDir, profile.json ? profile.json.replace(/^\//, '') : 'version.json');
  if (!fs.existsSync(versionJsonPath)) {
    throw new LoaderError(`Instalator ${loader} ${loaderVersion} nie zawiera pliku wersji (${profile.json ?? 'version.json'}).`);
  }
  const versionJson = JSON.parse(await fsp.readFile(versionJsonPath, 'utf8')) as VersionJson;

  // 4. Biblioteki instalatora + biblioteki wersji.
  await downloadLoaderLibraries([...(profile.libraries ?? []), ...(versionJson.libraries ?? [])], ctx.onProgress);

  // 5. Procesory (binary patching).
  if (profile.processors?.length) {
    await runProcessors(profile, {
      workDir,
      installerJar,
      clientJar: ctx.clientJar,
      javaPath: ctx.javaPath,
      minecraftVersion: ctx.mcVersion,
      onProgress: ctx.onProgress,
    });
  }

  await saveVersionProfile(versionJson);
  await fsp.rm(workDir, { recursive: true, force: true });
  log.info(`Zainstalowano ${loader} ${loaderVersion}`);
  return versionJson;
}

/** Pobiera biblioteki loadera do wspólnego katalogu bibliotek. */
async function downloadLoaderLibraries(libs: Library[], onProgress?: (p: DownloadProgress) => void): Promise<void> {
  const queue = new DownloadQueue({ onProgress, phase: 'Pobieranie bibliotek modloadera' });
  for (const lib of libs) {
    const art = lib.downloads?.artifact;
    const rel = art?.path ?? mavenToPath(lib.name);
    const dest = path.join(librariesDir(), ...rel.split('/'));
    const url = art?.url || (lib.url ? mavenUrl(lib.url, lib.name) : undefined);
    // Puste `url` w Forge oznacza artefakt generowany przez procesory - pomijamy.
    if (!url) continue;
    queue.add({ id: rel, url, dest, sha1: art?.sha1, size: art?.size, label: lib.name });
  }
  if (queue.size === 0) return;
  const res = await queue.run();
  if (!res.ok && !res.cancelled) {
    throw new LoaderError(
      `Nie udało się pobrać ${res.failed.length} bibliotek modloadera.`,
      res.failed[0]?.error,
    );
  }
}

interface ProcessorContext {
  workDir: string;
  installerJar: string;
  clientJar: string;
  javaPath: string;
  minecraftVersion: string;
  onProgress?: (p: DownloadProgress) => void;
}

/** Uruchamia procesory z install_profile.json (strona "client"). */
async function runProcessors(profile: InstallProfile, ctx: ProcessorContext): Promise<void> {
  const librariesRoot = librariesDir();
  const values: Record<string, string> = {
    MINECRAFT_JAR: ctx.clientJar,
    SIDE: 'client',
    ROOT: ctx.workDir,
    INSTALLER: ctx.installerJar,
    LIBRARY_DIR: librariesRoot,
    MINECRAFT_VERSION: ctx.minecraftVersion,
  };

  for (const [key, entry] of Object.entries(profile.data ?? {})) {
    values[key] = resolveDataValue(entry.client, { librariesRoot, installerRoot: ctx.workDir });
  }

  const processors = (profile.processors ?? []).filter((p) => !p.sides || p.sides.includes('client'));
  let index = 0;

  for (const proc of processors) {
    index++;
    ctx.onProgress?.({
      progress: index / processors.length,
      filesDone: index,
      filesTotal: processors.length,
      bytesDone: 0,
      bytesTotal: 0,
      speed: 0,
      etaSeconds: -1,
      currentFile: proc.jar,
      phase: 'Instalacja modloadera (procesory)',
    });

    const jarPath = path.join(librariesRoot, ...mavenToPath(proc.jar).split('/'));
    if (!fs.existsSync(jarPath)) {
      throw new LoaderError(`Brak biblioteki procesora: ${proc.jar}`, 'Spróbuj naprawić instancję.');
    }

    const classpath = [
      ...proc.classpath.map((c) => path.join(librariesRoot, ...mavenToPath(c).split('/'))),
      jarPath,
    ];
    const mainClass = readJarMainClass(jarPath);
    const args = proc.args.map((a) => substituteProcessorArg(a, values, { librariesRoot }));

    // Uruchamiamy przez spawn/execFile z TABLICĄ argumentów - nigdy przez cmd.exe.
    try {
      await execFileAsync(
        ctx.javaPath,
        ['-cp', classpath.join(path.delimiter), mainClass, ...args],
        { timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      );
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message: string };
      throw new LoaderError(
        `Procesor instalatora ${proc.jar} zakończył się błędem.`,
        (err.stderr || err.stdout || err.message).slice(0, 800),
      );
    }

    // Weryfikacja wyjść zadeklarowanych przez procesor.
    for (const [outPath] of Object.entries(proc.outputs ?? {})) {
      const resolved = substituteProcessorArg(outPath, values, { librariesRoot });
      if (!fs.existsSync(resolved)) {
        throw new LoaderError(`Procesor ${proc.jar} nie wygenerował pliku ${path.basename(resolved)}.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Wspólne                                                             */
/* ------------------------------------------------------------------ */

/** Zapisuje profil wersji do %APPDATA%\NightMC\shared\versions\<id>\<id>.json */
export async function saveVersionProfile(version: VersionJson): Promise<string> {
  const dir = path.join(versionsDir(), version.id);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${version.id}.json`);
  await fsp.writeFile(file, JSON.stringify(version, null, 2), 'utf8');
  return file;
}

/** Wczytuje zapisany profil wersji, jeśli istnieje. */
export async function loadVersionProfile(versionId: string): Promise<VersionJson | null> {
  const file = path.join(versionsDir(), versionId, `${versionId}.json`);
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as VersionJson;
  } catch {
    return null;
  }
}

/** Lista wersji loadera dla wskazanej wersji gry. */
export async function loaderVersions(loader: LoaderId, mcVersion: string): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'fabric':
      return fabricVersions(mcVersion);
    case 'forge':
      return forgeVersions(mcVersion);
    case 'neoforge':
      return neoforgeVersions(mcVersion);
    default:
      return [];
  }
}

/** Czy loader jest w ogóle dostępny dla tej wersji gry. */
export async function isLoaderCompatible(loader: LoaderId, mcVersion: string): Promise<boolean> {
  if (loader === 'vanilla') return true;
  try {
    const versions = await loaderVersions(loader, mcVersion);
    return versions.length > 0;
  } catch {
    return false;
  }
}
