/**
 * Wykrywanie i pobieranie środowiska Java.
 *
 * NightMC dobiera Javę do KONKRETNEJ wersji gry (pole `javaVersion` z metadanych),
 * a nie jedną na wszystko. Pobieranie: oficjalne API Eclipse Temurin (Adoptium).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ENDPOINTS, LIMITS } from '../shared/constants.js';
import { DownloadQueue } from './downloader.js';
import { extractArchive } from './zipsafe.js';
import { runtimesDir, tempDir } from './paths.js';
import { log } from './logging.js';
import type { JavaInstall, VersionJson } from '../shared/types.js';
import { requiredJavaMajor } from './minecraft.js';

const execFileAsync = promisify(execFile);

const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java';
/** javaw.exe nie otwiera okna konsoli - preferowany do uruchamiania gry na Windows. */
const JAVAW_BIN = process.platform === 'win32' ? 'javaw.exe' : 'java';

/* ------------------------------------------------------------------ */
/* Parsowanie `java -version`                                          */
/* ------------------------------------------------------------------ */

export interface ParsedJavaVersion {
  version: string;
  majorVersion: number;
  arch: string;
  vendor?: string;
}

/**
 * Parsuje wyjście `java -version` (idzie na stderr).
 * Obsługuje format 1.8.0_402 i 17.0.10 / 21.0.2+13.
 */
export function parseJavaVersionOutput(output: string): ParsedJavaVersion | null {
  const versionMatch = output.match(/version\s+"([^"]+)"/);
  if (!versionMatch) return null;
  const version = versionMatch[1]!;

  let majorVersion: number;
  if (version.startsWith('1.')) {
    majorVersion = Number.parseInt(version.split('.')[1] ?? '0', 10);
  } else {
    majorVersion = Number.parseInt(version.split(/[.\-+]/)[0] ?? '0', 10);
  }
  if (!Number.isFinite(majorVersion) || majorVersion <= 0) return null;

  const arch = /64-Bit/i.test(output) ? 'x64' : /aarch64|arm64/i.test(output) ? 'arm64' : 'x86';

  let vendor: string | undefined;
  if (/Temurin|Adoptium/i.test(output)) vendor = 'Eclipse Temurin';
  else if (/OpenJDK/i.test(output)) vendor = 'OpenJDK';
  else if (/Java\(TM\)|Oracle/i.test(output)) vendor = 'Oracle';
  else if (/Zulu/i.test(output)) vendor = 'Azul Zulu';
  else if (/GraalVM/i.test(output)) vendor = 'GraalVM';

  return { version, majorVersion, arch, vendor };
}

/** Uruchamia `java -version` i zwraca informacje o instalacji. */
export async function probeJava(javaPath: string): Promise<JavaInstall | null> {
  try {
    const { stdout, stderr } = await execFileAsync(javaPath, ['-version'], { timeout: 10_000, windowsHide: true });
    const parsed = parseJavaVersionOutput(`${stderr}\n${stdout}`);
    if (!parsed) return null;
    return {
      path: javaPath,
      version: parsed.version,
      majorVersion: parsed.majorVersion,
      arch: parsed.arch,
      vendor: parsed.vendor,
      managed: isManagedPath(javaPath),
    };
  } catch {
    return null;
  }
}

function isManagedPath(p: string): boolean {
  try {
    return path.resolve(p).toLowerCase().startsWith(path.resolve(runtimesDir()).toLowerCase());
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Wykrywanie                                                          */
/* ------------------------------------------------------------------ */

/** Typowe lokalizacje instalacji Javy. */
export function candidateJavaRoots(): string[] {
  const roots: string[] = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    roots.push(
      path.join(pf, 'Java'),
      path.join(pf, 'Eclipse Adoptium'),
      path.join(pf, 'Microsoft'),
      path.join(pf, 'Zulu'),
      path.join(pf, 'BellSoft'),
      path.join(pf, 'Amazon Corretto'),
      path.join(pf86, 'Java'),
      path.join(local, 'Programs', 'Eclipse Adoptium'),
      path.join(pf, 'Minecraft Launcher', 'runtime'),
      path.join(local, 'Packages'),
    );
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', path.join(home, 'Library/Java/JavaVirtualMachines'));
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', path.join(home, '.sdkman/candidates/java'));
  }

  roots.push(runtimesDir());
  return roots;
}

/** Szuka pliku wykonywalnego java w katalogu (do 4 poziomów w głąb). */
async function findJavaExecutables(root: string, depth = 0, acc: string[] = []): Promise<string[]> {
  if (depth > 4 || acc.length > 64) return acc;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isFile() && e.name.toLowerCase() === JAVA_BIN.toLowerCase() && path.basename(root).toLowerCase() === 'bin') {
      acc.push(full);
    } else if (e.isDirectory() && !e.isSymbolicLink()) {
      await findJavaExecutables(full, depth + 1, acc);
    }
  }
  return acc;
}

/** Wykrywa wszystkie instalacje Javy w systemie. */
export async function detectJava(): Promise<JavaInstall[]> {
  const candidates = new Set<string>();

  // 1. JAVA_HOME
  const javaHome = process.env['JAVA_HOME'];
  if (javaHome) candidates.add(path.join(javaHome, 'bin', JAVA_BIN));

  // 2. java z PATH
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, JAVA_BIN);
    if (fs.existsSync(p)) candidates.add(p);
  }

  // 3. Typowe katalogi instalacyjne
  for (const root of candidateJavaRoots()) {
    for (const p of await findJavaExecutables(root)) candidates.add(p);
  }

  const results: JavaInstall[] = [];
  const seenReal = new Set<string>();
  for (const c of candidates) {
    const real = path.resolve(c).toLowerCase();
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    const info = await probeJava(c);
    if (info) results.push(info);
  }

  results.sort((a, b) => (a.managed === b.managed ? b.majorVersion - a.majorVersion : a.managed ? -1 : 1));
  log.info(`Wykryto ${results.length} instalacji Javy`);
  return results;
}

/**
 * Wybiera najlepszą Javę dla wersji gry.
 * Preferuje dokładne dopasowanie major, następnie nowszą zgodną,
 * a instalacje zarządzane przez NightMC mają pierwszeństwo.
 */
export function pickJavaFor(required: number, installs: JavaInstall[]): JavaInstall | null {
  const arch64 = installs.filter((j) => j.arch !== 'x86');
  const pool = arch64.length > 0 ? arch64 : installs;

  const exact = pool.filter((j) => j.majorVersion === required);
  if (exact.length) return preferManaged(exact);

  // Minecraft 1.17+ nie działa na Javie starszej niż wymagana.
  const newer = pool.filter((j) => j.majorVersion > required).sort((a, b) => a.majorVersion - b.majorVersion);
  // Wyjątek: gra wymagająca Javy 8 zwykle działa na 8-11; nowsze bywają problematyczne.
  if (required === 8) {
    const compat = newer.filter((j) => j.majorVersion <= 11);
    if (compat.length) return preferManaged(compat);
  }
  if (newer.length) return preferManaged(newer);
  return null;
}

function preferManaged(list: JavaInstall[]): JavaInstall {
  return list.find((j) => j.managed) ?? list[0]!;
}

/** Wymagana wersja Javy dla metadanych gry. */
export function javaRequirementFor(version: VersionJson): number {
  return requiredJavaMajor(version);
}

/** Zamienia java.exe na javaw.exe (brak okna konsoli). */
export function toJavaw(javaPath: string): string {
  if (process.platform !== 'win32') return javaPath;
  const dir = path.dirname(javaPath);
  const javaw = path.join(dir, JAVAW_BIN);
  return fs.existsSync(javaw) ? javaw : javaPath;
}

/* ------------------------------------------------------------------ */
/* Pobieranie Temurin                                                  */
/* ------------------------------------------------------------------ */

export function adoptiumUrl(major: number): string {
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : 'x86';
  return `${ENDPOINTS.adoptiumApi}/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`;
}

/**
 * Pobiera i rozpakowuje JRE Temurin do %APPDATA%\NightMC\runtimes\temurin-<major>.
 * Zwraca ścieżkę do java(.exe).
 */
export async function downloadJava(
  major: number,
  onProgress?: (p: import('../shared/types.js').DownloadProgress) => void,
): Promise<JavaInstall> {
  const target = path.join(runtimesDir(), `temurin-${major}`);
  const archiveExt = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const archive = path.join(tempDir(), `temurin-${major}.${archiveExt}`);

  await fsp.mkdir(tempDir(), { recursive: true });
  await fsp.rm(target, { recursive: true, force: true });

  const queue = new DownloadQueue({
    concurrency: 1,
    onProgress,
    phase: `Pobieranie Java ${major} (Eclipse Temurin)`,
    timeoutMs: 15 * 60 * 1000,
  });
  queue.add({ id: `java-${major}`, url: adoptiumUrl(major), dest: archive, label: `Temurin JRE ${major}` });
  const result = await queue.run();
  if (!result.ok) {
    throw new Error(
      `Nie udało się pobrać Javy ${major}: ${result.failed[0]?.error ?? (result.cancelled ? 'anulowano' : 'nieznany błąd')}`,
    );
  }

  if (archiveExt === 'zip') {
    await extractArchive(archive, target, { overwrite: true });
  } else {
    const { execFile: ef } = await import('node:child_process');
    await fsp.mkdir(target, { recursive: true });
    await promisify(ef)('tar', ['-xzf', archive, '-C', target], { timeout: 300_000 });
  }
  await fsp.rm(archive, { force: true });

  // Temurin pakuje wszystko w jeden katalog nadrzędny.
  const found = await findJavaExecutables(target);
  const javaPath = found[0];
  if (!javaPath) throw new Error(`Rozpakowane archiwum Javy ${major} nie zawiera pliku ${JAVA_BIN}`);

  const info = await probeJava(javaPath);
  if (!info) throw new Error(`Pobrana Java ${major} nie odpowiada na "java -version"`);
  log.info(`Zainstalowano Java ${info.version} w ${target}`);
  return info;
}

/** Usuwa runtime zarządzany przez NightMC. */
export async function removeManagedJava(javaPath: string): Promise<void> {
  if (!isManagedPath(javaPath)) {
    throw new Error('Można usuwać tylko środowiska Java pobrane przez NightMC');
  }
  // Cofamy się z .../bin/java.exe do katalogu runtime.
  let dir = path.dirname(path.dirname(javaPath));
  const root = path.resolve(runtimesDir());
  while (path.dirname(dir) !== root && path.dirname(dir).length > root.length) dir = path.dirname(dir);
  await fsp.rm(dir, { recursive: true, force: true });
  log.info(`Usunięto środowisko Java: ${dir}`);
}

/* ------------------------------------------------------------------ */
/* RAM                                                                 */
/* ------------------------------------------------------------------ */

export interface MemoryAdvice {
  totalMB: number;
  freeMB: number;
  recommendedMaxMB: number;
  hardLimitMB: number;
  warning?: string;
}

/**
 * Proponuje rozsądny przydział pamięci.
 * Nigdy nie pozwalamy przydzielić całego RAM-u - system i sam launcher też go potrzebują.
 */
export function memoryAdvice(totalBytes: number, freeBytes: number, packSize: 'vanilla' | 'small' | 'large' = 'vanilla'): MemoryAdvice {
  const totalMB = Math.floor(totalBytes / 1024 / 1024);
  const freeMB = Math.floor(freeBytes / 1024 / 1024);
  // Zostawiamy 2 GB systemowi (albo 25% przy małej ilości RAM).
  const reserve = Math.max(2048, Math.floor(totalMB * 0.25));
  const hardLimitMB = Math.max(1024, totalMB - reserve);

  const base = packSize === 'large' ? 6144 : packSize === 'small' ? 4096 : 2048;
  const recommendedMaxMB = Math.max(1024, Math.min(base, hardLimitMB));

  let warning: string | undefined;
  if (totalMB < 4096) warning = 'Komputer ma mniej niż 4 GB RAM - modowane paczki mogą nie działać.';
  else if (recommendedMaxMB < base) warning = 'Zalecana ilość pamięci dla tej paczki przekracza możliwości komputera.';

  return { totalMB, freeMB, recommendedMaxMB, hardLimitMB, warning };
}

/** Waliduje ustawienia pamięci instancji. */
export function validateMemory(min: number, max: number, totalBytes: number): { ok: boolean; error?: string } {
  const advice = memoryAdvice(totalBytes, totalBytes);
  if (min < 256) return { ok: false, error: 'Minimalna pamięć nie może być mniejsza niż 256 MB.' };
  if (max < min) return { ok: false, error: 'Maksymalna pamięć nie może być mniejsza niż minimalna.' };
  if (max > advice.totalMB) {
    return { ok: false, error: `Nie można przydzielić ${max} MB - komputer ma tylko ${advice.totalMB} MB RAM.` };
  }
  if (max > advice.hardLimitMB) {
    return {
      ok: true,
      error: `Ostrzeżenie: ${max} MB to niemal cały RAM. Zalecane maksimum to ${advice.hardLimitMB} MB.`,
    };
  }
  return { ok: true };
}

export const JAVA_TIMEOUT_MS = LIMITS.metaTimeoutMs;
