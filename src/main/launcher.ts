/**
 * Uruchamianie gry.
 *
 * Proces startuje przez `spawn` z TABLICĄ argumentów - nigdy przez sklejone
 * polecenie w cmd.exe. To odcina całą klasę błędów typu command injection
 * (nazwa gracza, ścieżka z cudzysłowem, argumenty JVM od użytkownika).
 *
 * Token sesji premium istnieje wyłącznie w pamięci tego procesu i w argv
 * procesu potomnego. Nie trafia do bazy, do logów ani do plików.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { assetsDir, instanceGameDir, librariesDir } from './paths.js';
import {
  buildClasspath,
  buildLaunchArguments,
  classpathSeparator,
  currentOsContext,
  resolveLibraries,
} from './minecraft.js';
import { clientJarPath, getInstance, recordPlaySession, resolveInstanceVersion } from './instances.js';
import { detectJava, javaRequirementFor, pickJavaFor, toJavaw } from './java.js';
import { pushLog, log } from './logging.js';
import type {
  CrashDiagnosis,
  GameSession,
  Instance,
  LaunchPlan,
  ServerEntry,
  VersionJson,
} from '../shared/types.js';

/** Wersja launchera wstawiana w argumenty gry. Ustawiana z procesu głównego. */
let launcherVersion = '1.0.0';

export function setLauncherVersion(version: string): void {
  launcherVersion = version;
}

/* ------------------------------------------------------------------ */
/* Budowa planu uruchomienia                                           */
/* ------------------------------------------------------------------ */

export interface BuildPlanInput {
  instance: Instance;
  version: VersionJson;
  session: GameSession;
  javaPath: string;
  server?: { address: string; port: number };
  /** Podmiana katalogów - używane w testach. */
  roots?: { libraries: string; assets: string; gameDir: string; natives: string; clientJar: string };
}

/** Czy wersja obsługuje argumenty Quick Play (Minecraft 1.20+). */
export function supportsQuickPlay(version: VersionJson): boolean {
  const game = version.arguments?.game ?? [];
  return game.some(
    (a) => typeof a === 'object' && a.rules?.some((r) => r.features && 'is_quick_play_multiplayer' in r.features),
  );
}

/** Buduje kompletny plan: Java, classpath, natives, argumenty. */
export function buildLaunchPlan(input: BuildPlanInput): LaunchPlan {
  const { instance, version, session, javaPath, server } = input;

  const roots = input.roots ?? {
    libraries: librariesDir(),
    assets: assetsDir(),
    gameDir: instanceGameDir(instance.id),
    natives: path.join(instance.dir, 'natives'),
    clientJar: clientJarPath(instance.mcVersion),
  };

  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: Boolean(instance.width && instance.height),
    has_quick_plays_support: Boolean(server),
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: Boolean(server) && supportsQuickPlay(version),
    is_quick_play_realms: false,
  };
  const ctx = currentOsContext(features);

  const libs = resolveLibraries(version, ctx);
  const classpath = buildClasspath(libs, roots.libraries, roots.clientJar);
  const sep = classpathSeparator(ctx);

  const placeholders: Record<string, string> = {
    auth_player_name: session.username,
    version_name: version.id,
    game_directory: roots.gameDir,
    assets_root: roots.assets,
    game_assets: path.join(roots.assets, 'virtual', version.assets ?? 'legacy'),
    assets_index_name: version.assetIndex?.id ?? version.assets ?? 'legacy',
    auth_uuid: session.uuid,
    auth_access_token: session.accessToken,
    auth_session: `token:${session.accessToken}:${session.uuid}`,
    auth_xuid: session.xuid ?? '',
    clientid: session.clientId ?? '',
    user_type: session.userType,
    version_type: version.type ?? 'release',
    user_properties: '{}',
    natives_directory: roots.natives,
    launcher_name: 'NightMC',
    launcher_version: launcherVersion,
    classpath: classpath.join(sep),
    classpath_separator: sep,
    library_directory: roots.libraries,
    resolution_width: String(instance.width ?? 854),
    resolution_height: String(instance.height ?? 480),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: server ? `${server.address}:${server.port}` : '',
    quickPlayRealms: '',
  };

  // Konfiguracja log4j (jeśli została pobrana).
  const logConfig = version.logging?.client?.file
    ? path.join(roots.assets, 'log_configs', version.logging.client.file.id)
    : undefined;
  if (logConfig && fs.existsSync(logConfig)) placeholders['path'] = logConfig;

  const extraJvm = (instance.jvmArgs ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const extraGame: string[] = [];
  if (instance.fullscreen) extraGame.push('--fullscreen');
  if (server && !features['is_quick_play_multiplayer']) {
    // Starsze wersje: --server/--port. Nowsze obsługują Quick Play przez reguły.
    extraGame.push('--server', server.address, '--port', String(server.port));
  }

  const args = buildLaunchArguments({
    version,
    ctx,
    placeholders,
    memoryMin: instance.memoryMin,
    memoryMax: instance.memoryMax,
    extraJvmArgs: extraJvm,
    extraGameArgs: extraGame,
  });

  return {
    javaPath,
    args,
    cwd: roots.gameDir,
    mainClass: version.mainClass,
    classpath,
    nativesDir: roots.natives,
  };
}

/* ------------------------------------------------------------------ */
/* Diagnostyka                                                         */
/* ------------------------------------------------------------------ */

const CRASH_PATTERNS: { re: RegExp; code: string; title: string; hint: string }[] = [
  {
    re: /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/i,
    code: 'JAVA_TOO_OLD',
    title: 'Za stara wersja Javy',
    hint: 'Otwórz "Java i RAM" i pobierz nowszą Javę, albo pozwól NightMC wybrać ją automatycznie.',
  },
  {
    re: /class file version 5[2-9]|Unrecognized option|Unsupported major\.minor/i,
    code: 'JAVA_MISMATCH',
    title: 'Niezgodna wersja Javy',
    hint: 'Ta wersja gry wymaga innej Javy niż aktualnie wybrana.',
  },
  {
    re: /Could not reserve enough space for .* object heap|Error occurred during initialization of VM/i,
    code: 'NO_MEMORY',
    title: 'Za mało pamięci',
    hint: 'Zmniejsz -Xmx w ustawieniach instancji albo zamknij inne programy.',
  },
  {
    re: /java\.lang\.OutOfMemoryError/i,
    code: 'OUT_OF_MEMORY',
    title: 'Zabrakło pamięci w trakcie gry',
    hint: 'Zwiększ maksymalną pamięć instancji (zakładka "Java i RAM").',
  },
  {
    re: /NoClassDefFoundError|ClassNotFoundException/i,
    code: 'MISSING_LIBRARY',
    title: 'Brakuje biblioteki',
    hint: 'Użyj "Napraw pliki" w edycji instancji.',
  },
  {
    re: /Failed to load a library|UnsatisfiedLinkError|no lwjgl.* in java\.library\.path/i,
    code: 'NATIVES',
    title: 'Błąd bibliotek natywnych',
    hint: 'Napraw instancję - pliki natives zostaną rozpakowane ponownie.',
  },
  {
    re: /Mixin apply failed|MixinApplyError|Mixin prepare failed/i,
    code: 'MOD_CONFLICT',
    title: 'Konflikt modów',
    hint: 'Wyłącz ostatnio dodane mody i uruchom ponownie, aby znaleźć winowajcę.',
  },
  {
    re: /Incompatible mods found|requires .* which is missing|Missing or unsupported mandatory dependencies/i,
    code: 'MOD_DEPENDENCY',
    title: 'Brakująca zależność moda',
    hint: 'Doinstaluj wymagane mody - NightMC pobiera zależności automatycznie z Modrinth.',
  },
  {
    re: /Invalid session|Invalid session id|401 Unauthorized|Failed to verify username/i,
    code: 'SESSION',
    title: 'Sesja wygasła',
    hint: 'Zaloguj się ponownie na konto Microsoft w zakładce "Konta".',
  },
  {
    re: /No space left on device|There is not enough space on the disk/i,
    code: 'DISK_FULL',
    title: 'Brak miejsca na dysku',
    hint: 'Zwolnij miejsce i spróbuj ponownie.',
  },
  {
    re: /Cannot find or load main class|Could not find or load main class/i,
    code: 'BAD_LOADER',
    title: 'Nieprawidłowa instalacja modloadera',
    hint: 'Napraw instancję albo utwórz ją ponownie z inną wersją loadera.',
  },
];

/** Rozpoznaje typowe przyczyny awarii na podstawie logu. */
export function diagnoseCrash(logText: string, exitCode: number | null): CrashDiagnosis | undefined {
  for (const p of CRASH_PATTERNS) {
    if (p.re.test(logText)) {
      const line = logText.split('\n').find((l) => p.re.test(l)) ?? '';
      return { code: p.code, title: p.title, detail: line.trim().slice(0, 400), hint: p.hint };
    }
  }
  if (exitCode === null || exitCode === 0) return undefined;
  if (exitCode === 1) {
    return {
      code: 'EXIT_1',
      title: 'Gra zakończyła się błędem',
      detail: 'Kod wyjścia 1 - najczęściej oznacza błąd modów lub konfiguracji.',
      hint: 'Sprawdź zakładkę Logi, żeby zobaczyć pełny ślad błędu.',
    };
  }
  return {
    code: `EXIT_${exitCode}`,
    title: `Gra zakończyła się kodem ${exitCode}`,
    detail: 'Proces gry zamknął się nietypowo.',
    hint: 'Zajrzyj do logów. Jeśli problem się powtarza, spróbuj naprawić instancję.',
  };
}

/* ------------------------------------------------------------------ */
/* Zarządzanie procesem                                                */
/* ------------------------------------------------------------------ */

export interface RunningGame {
  instanceId: string;
  pid: number;
  startedAt: number;
  child: ChildProcess;
}

const running = new Map<string, RunningGame>();

export function isRunning(instanceId: string): boolean {
  return running.has(instanceId);
}

export function runningGames(): { instanceId: string; pid: number; startedAt: number }[] {
  return [...running.values()].map((g) => ({ instanceId: g.instanceId, pid: g.pid, startedAt: g.startedAt }));
}

export interface LaunchCallbacks {
  onExit?: (code: number | null, diagnosis?: CrashDiagnosis) => void;
  onStarted?: (pid: number) => void;
}

/** Uruchamia grę dla wskazanej instancji i sesji. */
export async function launchGame(
  instanceId: string,
  session: GameSession,
  server: ServerEntry | undefined,
  callbacks: LaunchCallbacks = {},
): Promise<RunningGame> {
  if (running.has(instanceId)) throw new Error('Ta instancja jest już uruchomiona');

  const instance = getInstance(instanceId);
  const version = await resolveInstanceVersion(instance);

  // 1. Java: ręcznie wybrana albo dobrana automatycznie do wersji gry.
  const required = javaRequirementFor(version);
  let javaPath = instance.javaPath;
  if (!javaPath || !fs.existsSync(javaPath)) {
    const installs = await detectJava();
    const picked = pickJavaFor(required, installs);
    if (!picked) {
      throw new Error(
        `Ta wersja wymaga Javy ${required}, a nie znaleziono jej w systemie. ` +
          `Otwórz "Java i RAM" i pobierz Java ${required} jednym kliknięciem.`,
      );
    }
    javaPath = picked.path;
  }
  javaPath = toJavaw(javaPath);

  // 2. Katalogi.
  const gameDir = instanceGameDir(instanceId);
  await fsp.mkdir(gameDir, { recursive: true });

  const plan = buildLaunchPlan({
    instance,
    version,
    session,
    javaPath,
    server: server ? { address: server.address, port: server.port } : undefined,
  });

  pushLog(instanceId, 'info', 'launcher', `Uruchamiam ${version.id} (${path.basename(javaPath)})`);
  pushLog(instanceId, 'info', 'launcher', `Klasa główna: ${plan.mainClass}`);
  pushLog(instanceId, 'info', 'launcher', `Elementów classpath: ${plan.classpath.length}`);
  pushLog(instanceId, 'debug', 'launcher', `Argumenty: ${plan.args.join(' ')}`);

  // 3. spawn - tablica argumentów, bez powłoki.
  const child = spawn(plan.javaPath, plan.args, {
    cwd: plan.cwd,
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, APPDATA: process.env['APPDATA'] },
  });

  const startedAt = Date.now();
  const game: RunningGame = { instanceId, pid: child.pid ?? -1, startedAt, child };
  running.set(instanceId, game);
  callbacks.onStarted?.(game.pid);

  const tail: string[] = [];
  const collect = (source: 'game' | 'stderr') => (chunk: Buffer) => {
    for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      const level = /error|exception|severe|fatal/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info';
      const entry = pushLog(instanceId, level, source, line);
      tail.push(entry.text);
      if (tail.length > 400) tail.shift();
    }
  };
  child.stdout?.on('data', collect('game'));
  child.stderr?.on('data', collect('stderr'));

  child.on('error', (err) => {
    pushLog(instanceId, 'error', 'launcher', `Nie udało się uruchomić procesu Javy: ${err.message}`);
  });

  child.on('exit', (code) => {
    running.delete(instanceId);
    const seconds = (Date.now() - startedAt) / 1000;
    const diagnosis = diagnoseCrash(tail.join('\n'), code);
    recordPlaySession(instanceId, seconds, code, diagnosis ? `${diagnosis.title}: ${diagnosis.detail}` : undefined);
    pushLog(
      instanceId,
      code === 0 ? 'info' : 'error',
      'launcher',
      `Gra zakończyła działanie (kod ${code ?? 'brak'}), czas gry: ${Math.round(seconds)} s`,
    );
    if (diagnosis) pushLog(instanceId, 'error', 'launcher', `${diagnosis.title} - ${diagnosis.hint}`);
    callbacks.onExit?.(code, diagnosis);
  });

  return game;
}

/** Zatrzymuje proces gry. */
export function stopGame(instanceId: string): boolean {
  const game = running.get(instanceId);
  if (!game) return false;
  log.info('Zatrzymuję proces gry', instanceId);
  game.child.kill('SIGTERM');
  setTimeout(() => {
    if (running.has(instanceId)) game.child.kill('SIGKILL');
  }, 5000).unref?.();
  return true;
}

/** Zamyka wszystkie procesy gry (przy wyjściu z launchera). */
export function stopAll(): void {
  for (const id of [...running.keys()]) stopGame(id);
}
