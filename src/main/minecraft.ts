/**
 * Obsługa oficjalnych metadanych Minecrafta.
 *
 * Cały moduł to czyste funkcje operujące na danych - dzięki temu jest w pełni
 * testowalny bez Electrona i bez sieci. Nic tutaj nie zakłada jednej stałej
 * komendy startowej: reguły, natives, classpath i argumenty są wyliczane
 * z metadanych KONKRETNEJ wersji.
 */

import path from 'node:path';
import { ENDPOINTS, LIMITS } from '../shared/constants.js';
import { fetchJson, MemoryCache } from './net.js';
import type {
  ArgumentValue,
  AssetIndex,
  Library,
  ManifestVersion,
  OsContext,
  Rule,
  VersionJson,
  VersionManifest,
  VersionType,
} from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Kontekst systemu                                                    */
/* ------------------------------------------------------------------ */

/** Buduje kontekst reguł dla bieżącego systemu. */
export function currentOsContext(features: Record<string, boolean> = {}): OsContext {
  const platform = process.platform;
  const name = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
  const arch =
    process.arch === 'x64' ? 'x86_64' : process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : process.arch;
  // os.release() na Windows zwraca np. "10.0.22631" - Mojang dopasowuje regexem.
  // getSystemVersion istnieje tylko w Electronie; w testach wystarczy dowolna wartość.
  const proc = process as NodeJS.Process & { getSystemVersion?: () => string };
  const version = proc.getSystemVersion?.() ?? String(process.versions.node);
  return { name, version, arch, features };
}

/* ------------------------------------------------------------------ */
/* Reguły                                                              */
/* ------------------------------------------------------------------ */

function osMatches(os: NonNullable<Rule['os']>, ctx: OsContext): boolean {
  if (os.name && os.name !== ctx.name) return false;
  if (os.arch && os.arch !== ctx.arch) return false;
  if (os.version) {
    try {
      if (!new RegExp(os.version).test(ctx.version)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function featuresMatch(features: Record<string, boolean>, ctx: OsContext): boolean {
  const active = ctx.features ?? {};
  for (const [key, expected] of Object.entries(features)) {
    if ((active[key] ?? false) !== expected) return false;
  }
  return true;
}

/**
 * Interpretuje listę reguł Mojang.
 *
 * Semantyka: startujemy od "niedozwolone" jeśli są jakiekolwiek reguły;
 * każda pasująca reguła nadpisuje wynik swoją akcją, w kolejności występowania.
 * Brak reguł = dozwolone.
 */
export function ruleAllows(rules: Rule[] | undefined, ctx: OsContext): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) matches = matches && osMatches(rule.os, ctx);
    if (rule.features) matches = matches && featuresMatch(rule.features, ctx);
    if (matches) allowed = rule.action === 'allow';
  }
  return allowed;
}

/* ------------------------------------------------------------------ */
/* Maven                                                               */
/* ------------------------------------------------------------------ */

/**
 * Zamienia współrzędne Maven na ścieżkę względną.
 * `group:artifact:version[:classifier][@ext]` -> `group/path/artifact/version/artifact-version[-classifier].ext`
 */
export function mavenToPath(name: string): string {
  const [coords, extRaw] = name.split('@');
  const ext = extRaw || 'jar';
  const parts = coords!.split(':');
  if (parts.length < 3) throw new Error(`Nieprawidłowe współrzędne Maven: ${name}`);
  const [group, artifact, version, classifier] = parts;
  const file = classifier
    ? `${artifact}-${version}-${classifier}.${ext}`
    : `${artifact}-${version}.${ext}`;
  return [...group!.split('.'), artifact!, version!, file].join('/');
}

/** Buduje pełny URL biblioteki na podstawie bazowego repozytorium. */
export function mavenUrl(baseUrl: string, name: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/${mavenToPath(name)}`;
}

/* ------------------------------------------------------------------ */
/* Biblioteki i natives                                                */
/* ------------------------------------------------------------------ */

/** Zwraca klasyfikator natives dla bieżącego systemu, albo undefined. */
export function nativeClassifier(lib: Library, ctx: OsContext): string | undefined {
  if (!lib.natives) return undefined;
  const template = lib.natives[ctx.name];
  if (!template) return undefined;
  const archBits = ctx.arch === 'x86' ? '32' : '64';
  return template.replace('${arch}', archBits);
}

export interface ResolvedLibrary {
  library: Library;
  /** Ścieżka względna wewnątrz katalogu libraries. */
  relPath: string;
  url?: string;
  sha1?: string;
  size?: number;
  /** true = archiwum natives do rozpakowania, nie element classpath. */
  isNative: boolean;
  excludes: string[];
}

/**
 * Wybiera biblioteki właściwe dla systemu i rozdziela je na classpath i natives.
 * Obsługuje zarówno stary format (`natives` + `classifiers`), jak i nowy
 * (osobne wpisy `*:natives-windows` z regułami OS).
 */
export function resolveLibraries(version: VersionJson, ctx: OsContext): ResolvedLibrary[] {
  const out: ResolvedLibrary[] = [];
  const seen = new Set<string>();

  for (const lib of version.libraries ?? []) {
    if (!ruleAllows(lib.rules, ctx)) continue;

    const classifier = nativeClassifier(lib, ctx);

    // 1. Zwykły artefakt (classpath). Występuje także dla bibliotek z natives.
    const artifact = lib.downloads?.artifact;
    if (artifact) {
      const rel = artifact.path ?? mavenToPath(lib.name);
      const key = `cp:${rel}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          library: lib,
          relPath: rel,
          url: artifact.url,
          sha1: artifact.sha1,
          size: artifact.size,
          // Nowy format: biblioteka o nazwie zawierającej "natives-" jest natywna.
          isNative: /:natives-/.test(lib.name),
          excludes: lib.extract?.exclude ?? [],
        });
      }
    } else if (!classifier) {
      // Biblioteka bez sekcji downloads (typowe dla Forge/Fabric) - budujemy z Maven.
      const rel = mavenToPath(lib.name);
      const key = `cp:${rel}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          library: lib,
          relPath: rel,
          url: lib.url ? mavenUrl(lib.url, lib.name) : undefined,
          isNative: false,
          excludes: [],
        });
      }
    }

    // 2. Stary format natives przez classifiers.
    if (classifier) {
      const nat = lib.downloads?.classifiers?.[classifier];
      const rel = nat?.path ?? mavenToPath(`${lib.name}:${classifier}`);
      const key = `nat:${rel}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          library: lib,
          relPath: rel,
          url: nat?.url ?? (lib.url ? mavenUrl(lib.url, `${lib.name}:${classifier}`) : undefined),
          sha1: nat?.sha1,
          size: nat?.size,
          isNative: true,
          excludes: lib.extract?.exclude ?? ['META-INF/'],
        });
      }
    }
  }

  return out;
}

/**
 * Buduje classpath w kolejności: biblioteki (bez natives) + główny JAR klienta.
 * Duplikaty group:artifact są usuwane - wygrywa pierwsze wystąpienie
 * (tak działa Forge, który celowo nadpisuje biblioteki vanilla).
 */
export function buildClasspath(
  libs: ResolvedLibrary[],
  librariesRoot: string,
  clientJar: string,
): string[] {
  const byModule = new Map<string, string>();
  for (const lib of libs) {
    if (lib.isNative) continue;
    const coords = lib.library.name.split(':');
    const moduleKey = `${coords[0]}:${coords[1]}`;
    if (byModule.has(moduleKey)) continue;
    byModule.set(moduleKey, path.join(librariesRoot, ...lib.relPath.split('/')));
  }
  return [...byModule.values(), clientJar];
}

/** Separator classpath: ';' na Windows, ':' gdzie indziej. */
export function classpathSeparator(ctx: OsContext): string {
  return ctx.name === 'windows' ? ';' : ':';
}

/* ------------------------------------------------------------------ */
/* Dziedziczenie wersji                                                */
/* ------------------------------------------------------------------ */

/**
 * Scala wersję potomną (np. profil Fabric/Forge) z wersją bazową.
 * Biblioteki potomka mają PIERWSZEŃSTWO, argumenty są doklejane.
 */
export function mergeVersions(child: VersionJson, parent: VersionJson): VersionJson {
  const merged: VersionJson = {
    ...parent,
    ...child,
    id: child.id,
    inheritsFrom: undefined,
    mainClass: child.mainClass || parent.mainClass,
    assets: child.assets ?? parent.assets,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    downloads: { ...(parent.downloads ?? {}), ...(child.downloads ?? {}) },
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging,
    libraries: [...(child.libraries ?? []), ...(parent.libraries ?? [])],
  };

  const parentGame = parent.arguments?.game ?? [];
  const parentJvm = parent.arguments?.jvm ?? [];
  const childGame = child.arguments?.game ?? [];
  const childJvm = child.arguments?.jvm ?? [];

  if (parent.arguments || child.arguments) {
    merged.arguments = { game: [...parentGame, ...childGame], jvm: [...parentJvm, ...childJvm] };
  }
  // Stary format: potomek może dopisać własne argumenty gry.
  if (parent.minecraftArguments || child.minecraftArguments) {
    merged.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Argumenty                                                           */
/* ------------------------------------------------------------------ */

export type Placeholders = Record<string, string>;

/** Podstawia ${placeholder} w pojedynczym argumencie. */
export function substitute(arg: string, values: Placeholders): string {
  return arg.replace(/\$\{([A-Za-z0-9_]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : whole,
  );
}

/** Rozwija listę argumentów w nowym formacie, uwzględniając reguły. */
export function expandArguments(args: ArgumentValue[] | undefined, ctx: OsContext, values: Placeholders): string[] {
  const out: string[] = [];
  for (const entry of args ?? []) {
    if (typeof entry === 'string') {
      out.push(substitute(entry, values));
      continue;
    }
    if (!ruleAllows(entry.rules, ctx)) continue;
    const vals = Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const val of vals) out.push(substitute(val, values));
  }
  return out;
}

/**
 * Domyślne argumenty JVM dla wersji, które ich nie deklarują (format < 1.13).
 * Bez tego stare wersje nie znajdą natives ani classpath.
 */
export function legacyJvmArguments(ctx: OsContext): string[] {
  const args = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  if (ctx.name === 'windows') {
    args.unshift('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
  }
  if (ctx.name === 'osx') args.unshift('-XstartOnFirstThread');
  return args;
}

export interface BuildArgsInput {
  version: VersionJson;
  ctx: OsContext;
  placeholders: Placeholders;
  /** -Xms/-Xmx i argumenty użytkownika. */
  memoryMin: number;
  memoryMax: number;
  extraJvmArgs: string[];
  /** Argumenty doklejane na końcu (np. --server / --port). */
  extraGameArgs?: string[];
}

/** Buduje kompletną listę argumentów procesu Javy. */
export function buildLaunchArguments(input: BuildArgsInput): string[] {
  const { version, ctx, placeholders, memoryMin, memoryMax, extraJvmArgs, extraGameArgs } = input;

  const jvm = version.arguments?.jvm
    ? expandArguments(version.arguments.jvm, ctx, placeholders)
    : legacyJvmArguments(ctx).map((a) => substitute(a, placeholders));

  const memory = [`-Xms${memoryMin}M`, `-Xmx${memoryMax}M`];

  // Konfiguracja log4j z metadanych wersji (jeśli została pobrana).
  const loggingArg =
    version.logging?.client && placeholders['path']
      ? [substitute(version.logging.client.argument, placeholders)]
      : [];

  let game: string[];
  if (version.arguments?.game) {
    game = expandArguments(version.arguments.game, ctx, placeholders);
  } else if (version.minecraftArguments) {
    game = version.minecraftArguments.split(/\s+/).filter(Boolean).map((a) => substitute(a, placeholders));
  } else {
    game = [];
  }

  return [...memory, ...extraJvmArgs, ...jvm, ...loggingArg, version.mainClass, ...game, ...(extraGameArgs ?? [])];
}

/* ------------------------------------------------------------------ */
/* Java wymagana przez wersję                                          */
/* ------------------------------------------------------------------ */

/**
 * Zwraca wymaganą główną wersję Javy.
 * Priorytet: pole `javaVersion` z metadanych; w razie braku - heurystyka po dacie
 * wydania, bo starsze wersje nie deklarują tego pola.
 */
export function requiredJavaMajor(version: VersionJson): number {
  if (version.javaVersion?.majorVersion) return version.javaVersion.majorVersion;
  const released = version.releaseTime ? Date.parse(version.releaseTime) : NaN;
  if (Number.isNaN(released)) return 8;
  // 1.17 (2021-06-08) -> Java 16; 1.18 (2021-11-30) -> Java 17; 1.20.5 (2024-04-23) -> Java 21
  if (released >= Date.parse('2024-04-23')) return 21;
  if (released >= Date.parse('2021-11-30')) return 17;
  if (released >= Date.parse('2021-06-08')) return 16;
  return 8;
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

const manifestCache = new MemoryCache<VersionManifest>(10 * 60 * 1000);
const versionCache = new MemoryCache<VersionJson>(60 * 60 * 1000);

export function parseVersionManifest(raw: unknown): VersionManifest {
  const m = raw as VersionManifest;
  if (!m || typeof m !== 'object' || !Array.isArray(m.versions)) {
    throw new Error('Manifest Mojang ma nieoczekiwaną strukturę');
  }
  const valid: VersionType[] = ['release', 'snapshot', 'old_beta', 'old_alpha'];
  return {
    latest: { release: m.latest?.release ?? '', snapshot: m.latest?.snapshot ?? '' },
    versions: m.versions
      .filter((v) => v && typeof v.id === 'string' && typeof v.url === 'string' && valid.includes(v.type))
      .map((v) => ({
        id: v.id,
        type: v.type,
        url: v.url,
        time: v.time ?? '',
        releaseTime: v.releaseTime ?? '',
        sha1: v.sha1 ?? '',
        complianceLevel: v.complianceLevel,
      })),
  };
}

/** Filtruje listę wersji zgodnie z przełącznikami UI. */
export function filterVersions(
  versions: ManifestVersion[],
  opts: { snapshots?: boolean; old?: boolean; query?: string } = {},
): ManifestVersion[] {
  const q = opts.query?.trim().toLowerCase();
  return versions.filter((v) => {
    if (v.type === 'snapshot' && !opts.snapshots) return false;
    if ((v.type === 'old_beta' || v.type === 'old_alpha') && !opts.old) return false;
    if (q && !v.id.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function getVersionManifest(refresh = false): Promise<VersionManifest> {
  if (!refresh) {
    const hit = manifestCache.get('manifest');
    if (hit) return hit;
  }
  const raw = await fetchJson(ENDPOINTS.mojangVersionManifest, { timeoutMs: LIMITS.metaTimeoutMs });
  const parsed = parseVersionManifest(raw);
  manifestCache.set('manifest', parsed);
  return parsed;
}

/** Pobiera metadane wersji z manifestu (z cache). */
export async function getVersionJson(versionId: string): Promise<VersionJson> {
  const hit = versionCache.get(versionId);
  if (hit) return hit;
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Wersja "${versionId}" nie występuje w oficjalnym manifeście Mojang`);
  const json = await fetchJson<VersionJson>(entry.url, { timeoutMs: LIMITS.metaTimeoutMs });
  if (!json.mainClass) throw new Error(`Metadane wersji "${versionId}" nie zawierają mainClass`);
  json.releaseTime ??= entry.releaseTime;
  json.type ??= entry.type;
  versionCache.set(versionId, json);
  return json;
}

/** Rozwiązuje łańcuch `inheritsFrom` (Fabric/Forge dziedziczą po vanilla). */
export async function resolveVersionChain(
  version: VersionJson,
  loadParent: (id: string) => Promise<VersionJson>,
  depth = 0,
): Promise<VersionJson> {
  if (!version.inheritsFrom) return version;
  if (depth > 8) throw new Error('Zbyt głęboki łańcuch dziedziczenia wersji');
  const parent = await resolveVersionChain(await loadParent(version.inheritsFrom), loadParent, depth + 1);
  return mergeVersions(version, parent);
}

/* ------------------------------------------------------------------ */
/* Assety                                                              */
/* ------------------------------------------------------------------ */

/** Ścieżka obiektu assetu: objects/<2 pierwsze znaki hasha>/<hash>. */
export function assetObjectPath(hash: string): string {
  if (!/^[0-9a-f]{40}$/i.test(hash)) throw new Error(`Nieprawidłowy hash assetu: ${hash}`);
  return `${hash.slice(0, 2)}/${hash}`;
}

export function assetUrl(hash: string): string {
  return `${ENDPOINTS.mojangResources}/${assetObjectPath(hash)}`;
}

export function parseAssetIndex(raw: unknown): AssetIndex {
  const idx = raw as AssetIndex;
  if (!idx || typeof idx !== 'object' || typeof idx.objects !== 'object') {
    throw new Error('Indeks assetów ma nieoczekiwaną strukturę');
  }
  return idx;
}

/** Czyści cache metadanych (używane przy "Odśwież"). */
export function clearMetadataCache(): void {
  manifestCache.clear();
  versionCache.clear();
}
