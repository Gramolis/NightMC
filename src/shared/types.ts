/** Typy współdzielone między procesem głównym a rendererem. */

import type { LOADERS } from './constants.js';

export type LoaderId = (typeof LOADERS)[number];

/* ------------------------------------------------------------------ */
/* Manifest i metadane Mojang                                          */
/* ------------------------------------------------------------------ */

export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha';

export interface ManifestVersion {
  id: string;
  type: VersionType;
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel?: number;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: ManifestVersion[];
}

export interface Artifact {
  path?: string;
  sha1?: string;
  size?: number;
  url: string;
}

export interface LibraryDownloads {
  artifact?: Artifact;
  classifiers?: Record<string, Artifact>;
}

export interface RuleOs {
  name?: string;
  version?: string;
  arch?: string;
}

export interface Rule {
  action: 'allow' | 'disallow';
  os?: RuleOs;
  features?: Record<string, boolean>;
}

export interface Library {
  name: string;
  downloads?: LibraryDownloads;
  url?: string;
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
}

export type ArgumentValue = string | { rules?: Rule[]; value: string | string[] };

export interface VersionJson {
  id: string;
  inheritsFrom?: string;
  type?: VersionType;
  mainClass: string;
  minecraftArguments?: string;
  arguments?: { game?: ArgumentValue[]; jvm?: ArgumentValue[] };
  libraries?: Library[];
  assets?: string;
  assetIndex?: { id: string; sha1: string; size: number; totalSize: number; url: string };
  downloads?: Record<string, Artifact>;
  javaVersion?: { component: string; majorVersion: number };
  logging?: {
    client?: { argument: string; type: string; file: { id: string; sha1: string; size: number; url: string } };
  };
  complianceLevel?: number;
  releaseTime?: string;
  time?: string;
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

/* ------------------------------------------------------------------ */
/* Środowisko / reguły                                                 */
/* ------------------------------------------------------------------ */

export interface OsContext {
  /** Nazwa w konwencji Mojang: windows / linux / osx */
  name: 'windows' | 'linux' | 'osx';
  /** Wersja systemu w postaci akceptowanej przez regexy Mojang, np. "10.0". */
  version: string;
  /** x86 | x86_64 | arm64 */
  arch: string;
  features?: Record<string, boolean>;
}

/* ------------------------------------------------------------------ */
/* Pobieranie                                                          */
/* ------------------------------------------------------------------ */

export interface DownloadTask {
  id: string;
  url: string;
  dest: string;
  size?: number;
  sha1?: string;
  sha256?: string;
  /** Etykieta pokazywana w UI. */
  label?: string;
  /** Nie pobieraj ponownie jeśli plik istnieje i zgadza się suma. */
  verifyOnly?: boolean;
  /** Nagłówki wymagane przez konkretne API (np. klucz CurseForge). */
  headers?: Record<string, string>;
}

export interface DownloadProgress {
  /** 0..1 */
  progress: number;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** bajty/s (średnia krocząca) */
  speed: number;
  /** sekundy, -1 gdy nieznane */
  etaSeconds: number;
  currentFile: string;
  phase: string;
}

export interface DownloadResult {
  ok: boolean;
  cancelled: boolean;
  failed: { url: string; dest: string; error: string }[];
}

/* ------------------------------------------------------------------ */
/* Konta                                                               */
/* ------------------------------------------------------------------ */

export type AccountType = 'microsoft' | 'offline';

export interface Account {
  id: string;
  type: AccountType;
  username: string;
  uuid: string;
  /** Tylko dla kont Microsoft - czy potwierdzono posiadanie Minecraft Java Edition. */
  ownsGame?: boolean;
  /** URL skórki (Premium) albo ścieżka lokalna (Offline). */
  skinUrl?: string;
  /** Ikona profilu offline (data URL albo ścieżka lokalna). */
  avatar?: string;
  active: boolean;
  addedAt: number;
  lastUsedAt?: number;
  /** Czas wygaśnięcia sesji Minecraft (ms epoch). Tylko konta Microsoft. */
  expiresAt?: number;
}

/** Dane sesji przekazywane do procesu gry. Nigdy nie trafiają do bazy ani do logów. */
export interface GameSession {
  username: string;
  uuid: string;
  accessToken: string;
  userType: 'msa' | 'legacy';
  xuid?: string;
  clientId?: string;
}

/* ------------------------------------------------------------------ */
/* Instancje                                                           */
/* ------------------------------------------------------------------ */

export interface Instance {
  id: string;
  name: string;
  icon?: string;
  mcVersion: string;
  loader: LoaderId;
  loaderVersion?: string;
  /** Identyfikator wersji uruchamianej (np. "fabric-loader-0.16.9-1.21.4"). */
  versionId: string;
  javaPath?: string;
  memoryMin: number;
  memoryMax: number;
  jvmArgs: string;
  width?: number;
  height?: number;
  fullscreen: boolean;
  playTimeSeconds: number;
  lastPlayedAt?: number;
  createdAt: number;
  /** Katalog instancji (bezwzględny). */
  dir: string;
  notes?: string;
  /** Ustawiona ręcznie liczba modów - cache do UI. */
  modCount?: number;
  /** Ostatni błąd zakończenia gry. */
  lastError?: string;
  /** Czy instalacja została w pełni zweryfikowana. */
  installed: boolean;
}

export interface InstanceCreateOptions {
  name: string;
  mcVersion: string;
  loader: LoaderId;
  loaderVersion?: string;
  icon?: string;
  memoryMin?: number;
  memoryMax?: number;
}

/* ------------------------------------------------------------------ */
/* Mody                                                               */
/* ------------------------------------------------------------------ */

export interface ModFile {
  fileName: string;
  path: string;
  enabled: boolean;
  size: number;
  sha1?: string;
  projectId?: string;
  versionId?: string;
  displayName?: string;
  loaders?: string[];
  gameVersions?: string[];
}

export interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  client_side: string;
  server_side: string;
  project_type: string;
  downloads: number;
  icon_url?: string;
  author: string;
  versions: string[];
  latest_version?: string;
  follows?: number;
  date_modified?: string;
}

export interface ModrinthSearchResult {
  hits: ModrinthProject[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
  downloads: number;
  date_published: string;
  dependencies: {
    version_id?: string | null;
    project_id?: string | null;
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
  }[];
  files: {
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes: { sha1?: string; sha512?: string };
  }[];
}

export type ModSource = 'modrinth' | 'curseforge';

/** Wspólny wynik wyszukiwania używany przez kreator mieszanych paczek. */
export interface PackCatalogProject {
  source: ModSource;
  projectId: string;
  title: string;
  description: string;
  author?: string;
  iconUrl?: string;
  downloads: number;
  /** CurseForge może zabronić instalacji przez klienta zewnętrznego. */
  distributable: boolean;
}

export interface PackCatalogVersion {
  source: ModSource;
  projectId: string;
  versionId: string;
  name: string;
  versionNumber: string;
  fileName: string;
  gameVersions: string[];
  loaders: string[];
  releaseType: 'release' | 'beta' | 'alpha';
  size: number;
  publishedAt: string;
  downloadable: boolean;
}

export interface PackBuilderItem {
  source: ModSource;
  projectId: string;
  versionId: string;
  title: string;
  versionNumber: string;
}

/* ------------------------------------------------------------------ */
/* Paczki                                                              */
/* ------------------------------------------------------------------ */

export interface MrPackIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  summary?: string;
  files: {
    path: string;
    hashes: { sha1?: string; sha512?: string };
    env?: { client?: string; server?: string };
    downloads: string[];
    fileSize?: number;
  }[];
  dependencies: Record<string, string>;
}

export interface CurseForgeManifest {
  minecraft: {
    version: string;
    modLoaders: { id: string; primary?: boolean }[];
  };
  manifestType: string;
  manifestVersion: number;
  name: string;
  version?: string;
  author?: string;
  files: { projectID: number; fileID: number; required?: boolean }[];
  overrides?: string;
}

export interface PackPreview {
  kind: 'mrpack' | 'curseforge';
  name: string;
  version?: string;
  author?: string;
  mcVersion: string;
  loader: LoaderId;
  loaderVersion?: string;
  /** Pliki do pobrania z sieci (mrpack) albo do ręcznego wskazania (CurseForge). */
  requiredFiles: { name: string; url?: string; size?: number; projectID?: number; fileID?: number }[];
  overrideCount: number;
  /** Szacowany rozmiar po rozpakowaniu. */
  estimatedBytes: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Java                                                                */
/* ------------------------------------------------------------------ */

export interface JavaInstall {
  path: string;
  version: string;
  majorVersion: number;
  arch: string;
  vendor?: string;
  /** Czy pobrane przez NightMC do %APPDATA%\NightMC\runtimes */
  managed: boolean;
}

/* ------------------------------------------------------------------ */
/* Serwery                                                             */
/* ------------------------------------------------------------------ */

export interface ServerEntry {
  id: string;
  name: string;
  address: string;
  port: number;
  icon?: string;
  description?: string;
  mcVersion?: string;
  instanceId?: string;
  /** Oznaczone RĘCZNIE przez użytkownika. NightMC tego nie wykrywa. */
  userMarkedOffline: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Modloadery                                                          */
/* ------------------------------------------------------------------ */

export interface LoaderVersion {
  version: string;
  stable: boolean;
  /** Wersja Minecrafta, dla której loader jest przeznaczony. */
  mcVersion?: string;
  recommended?: boolean;
  latest?: boolean;
}

/* ------------------------------------------------------------------ */
/* Uruchamianie                                                        */
/* ------------------------------------------------------------------ */

export interface LaunchPlan {
  javaPath: string;
  args: string[];
  cwd: string;
  mainClass: string;
  classpath: string[];
  nativesDir: string;
}

export interface LogLine {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'launcher' | 'game' | 'stderr';
  text: string;
}

export interface CrashDiagnosis {
  code: string;
  title: string;
  detail: string;
  hint: string;
}

export type GameState =
  | { status: 'idle' }
  | { status: 'preparing'; instanceId: string; progress: DownloadProgress }
  | { status: 'running'; instanceId: string; pid: number; startedAt: number }
  | { status: 'exited'; instanceId: string; code: number | null; diagnosis?: CrashDiagnosis };

/* ------------------------------------------------------------------ */
/* Aktualizacje i aktualności                                          */
/* ------------------------------------------------------------------ */

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  changelog?: string;
  exeUrl?: string;
  sha256?: string;
  size?: number;
  publishedAt?: string;
  htmlUrl?: string;
  /** Podpis Ed25519 (base64), jeśli release go zawiera. */
  signature?: string;
}

export interface ChangelogDocument {
  content: string;
  sourceUrl: string;
  fetchedAt: string;
  fromCache: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  image?: string;
  url?: string;
  publishedAt: string;
}

/* ------------------------------------------------------------------ */
/* Ustawienia                                                          */
/* ------------------------------------------------------------------ */

export interface Settings {
  instancesDir: string;
  concurrency: number;
  closeOnLaunch: 'minimize' | 'tray' | 'nothing' | 'close';
  showSnapshots: boolean;
  showOldVersions: boolean;
  defaultMemoryMin: number;
  defaultMemoryMax: number;
  defaultJvmArgs: string;
  checkUpdates: boolean;
  acceptedOfflineWarning: boolean;
  theme: 'night';
  language: 'pl';
  curseforgeKeySet: boolean;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  cpuCount: number;
  appVersion: string;
  electronVersion: string;
  dataDir: string;
  instancesDir: string;
  runtimesDir: string;
  cacheDir: string;
  isDev: boolean;
}

/* ------------------------------------------------------------------ */
/* Analiza lokalnych modów                                             */
/* ------------------------------------------------------------------ */

/** Loader zadeklarowany w metadanych pliku JAR. */
export type ModMetadataLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown';

/** Źródło, z którego odczytano metadane moda. */
export type ModMetadataSource =
  | 'fabric.mod.json'
  | 'quilt.mod.json'
  | 'META-INF/mods.toml'
  | 'META-INF/neoforge.mods.toml'
  | 'mcmod.info'
  | 'none';

/** Pojedyncza zależność zadeklarowana przez moda. */
export interface ModDependency {
  modId: string;
  /** Zakres wersji w zapisie Maven ("[1.20,1.21)") albo semver (">=0.15.0"). */
  versionRange?: string;
  /** Rodzaj relacji zadeklarowany przez moda. */
  kind: 'required' | 'optional' | 'incompatible' | 'discouraged' | 'embedded';
}

/** Metadane jednego pliku moda odczytane bez uruchamiania jego kodu. */
export interface LocalModMetadata {
  fileName: string;
  filePath: string;
  size: number;
  sha1: string;
  enabled: boolean;
  modId?: string;
  /** Dodatkowe identyfikatory dostarczane przez ten sam plik JAR. */
  providedModIds: string[];
  name?: string;
  version?: string;
  description?: string;
  authors?: string[];
  loader: ModMetadataLoader;
  metadataSource: ModMetadataSource;
  dependencies: ModDependency[];
  /** Zakresy wersji Minecrafta wyliczone z zależności "minecraft". */
  mcVersionRanges: string[];
  /** Ostrzeżenia napotkane przy odczycie tego konkretnego pliku. */
  readWarnings: string[];
}

/** Plik, którego nie udało się przeanalizować. Analiza pozostałych trwa dalej. */
export interface UnreadableModFile {
  fileName: string;
  filePath: string;
  size: number;
  reason: string;
  /** true = archiwum wygląda na złośliwe, a nie tylko uszkodzone. */
  suspicious: boolean;
}

export type ModIssueSeverity = 'info' | 'warning' | 'error';

/** Stabilne identyfikatory rodzajów problemów - bezpieczne do użycia w UI. */
export type ModIssueCode =
  | 'DUPLICATE_MOD_ID'
  | 'MULTIPLE_VERSIONS'
  | 'WRONG_LOADER'
  | 'MISSING_DEPENDENCY'
  | 'OPTIONAL_DEPENDENCY_MISSING'
  | 'DEPENDENCY_VERSION_MISMATCH'
  | 'DECLARED_CONFLICT'
  | 'MC_VERSION_MISMATCH'
  | 'CORRUPTED_JAR'
  | 'NO_METADATA'
  | 'SUSPICIOUS_ARCHIVE'
  | 'DISABLED_MOD';

export interface ModIssue {
  severity: ModIssueSeverity;
  code: ModIssueCode;
  title: string;
  description: string;
  /** Plik, którego problem dotyczy w pierwszej kolejności. */
  fileName: string;
  /** Pozostałe pliki biorące udział w problemie (duplikaty, konflikty). */
  relatedFiles: string[];
  suggestedAction: string;
}

/** Kontekst instancji, względem którego oceniamy mody. */
export interface ModAnalysisContext {
  loader: LoaderId;
  mcVersion: string;
}

export interface ModAnalysisReport {
  instanceId?: string;
  loader: LoaderId;
  mcVersion: string;
  scannedAt: number;
  mods: LocalModMetadata[];
  unreadable: UnreadableModFile[];
  issues: ModIssue[];
  summary: {
    total: number;
    enabled: number;
    disabled: number;
    withMetadata: number;
    errors: number;
    warnings: number;
    infos: number;
  };
}

/** Wynik operacji przekazywany przez IPC - nigdy nie rzucamy przez granicę IPC. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
