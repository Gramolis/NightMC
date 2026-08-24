import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildLaunchPlan, diagnoseCrash, supportsQuickPlay } from '../src/main/launcher.js';
import { createOfflineAccount, offlineSession } from '../src/main/offline.js';
import { MODERN_VERSION, LEGACY_VERSION } from './fixtures.js';
import type { Instance } from '../src/shared/types.js';

const roots = {
  libraries: path.join('/dane', 'libraries'),
  assets: path.join('/dane', 'assets'),
  gameDir: path.join('/dane', 'instances', 'inst-1', 'minecraft'),
  natives: path.join('/dane', 'instances', 'inst-1', 'natives'),
  clientJar: path.join('/dane', 'versions', '1.21.4', '1.21.4.jar'),
};

const instance: Instance = {
  id: 'inst-1',
  name: 'Testowa',
  mcVersion: '1.21.4',
  loader: 'vanilla',
  versionId: '1.21.4',
  memoryMin: 1024,
  memoryMax: 4096,
  jvmArgs: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50',
  fullscreen: false,
  playTimeSeconds: 0,
  createdAt: Date.now(),
  dir: path.join('/dane', 'instances', 'inst-1'),
  installed: true,
};

const offline = offlineSession(createOfflineAccount('Nocny_Gracz'));

describe('budowa procesu gry', () => {
  it('tworzy plan z klasą główną, classpath i katalogiem roboczym', () => {
    const plan = buildLaunchPlan({ instance, version: MODERN_VERSION, session: offline, javaPath: '/java/bin/java', roots });
    expect(plan.javaPath).toBe('/java/bin/java');
    expect(plan.mainClass).toBe('net.minecraft.client.main.Main');
    expect(plan.cwd).toBe(roots.gameDir);
    expect(plan.nativesDir).toBe(roots.natives);
    expect(plan.classpath[plan.classpath.length - 1]).toBe(roots.clientJar);
  });

  it('przekazuje argumenty jako osobne elementy tablicy, nie jako jeden łańcuch', () => {
    const plan = buildLaunchPlan({ instance, version: MODERN_VERSION, session: offline, javaPath: 'java', roots });
    expect(Array.isArray(plan.args)).toBe(true);
    // Żaden argument nie może zawierać znaków sterujących powłoki.
    for (const arg of plan.args) {
      expect(arg).not.toMatch(/[&|;`\n]/);
    }
    const nameIndex = plan.args.indexOf('--username');
    expect(plan.args[nameIndex + 1]).toBe('Nocny_Gracz');
  });

  it('nazwa gracza z próbą wstrzyknięcia trafia jako jeden argument', () => {
    // Walidacja nie dopuszcza takiego nicku, ale plan i tak nie może go rozbić.
    const session = { ...offline, username: 'Gracz & calc.exe' };
    const plan = buildLaunchPlan({ instance, version: MODERN_VERSION, session, javaPath: 'java', roots });
    const idx = plan.args.indexOf('--username');
    expect(plan.args[idx + 1]).toBe('Gracz & calc.exe');
    expect(plan.args.filter((a) => a === 'calc.exe')).toHaveLength(0);
  });

  it('ustawia -Xms i -Xmx z ustawień instancji oraz argumenty użytkownika', () => {
    const plan = buildLaunchPlan({ instance, version: MODERN_VERSION, session: offline, javaPath: 'java', roots });
    expect(plan.args[0]).toBe('-Xms1024M');
    expect(plan.args[1]).toBe('-Xmx4096M');
    expect(plan.args).toContain('-XX:+UseG1GC');
    expect(plan.args).toContain('-XX:MaxGCPauseMillis=50');
  });

  it('profil offline nie przekazuje tokenu wyglądającego na premium', () => {
    const plan = buildLaunchPlan({ instance, version: MODERN_VERSION, session: offline, javaPath: 'java', roots });
    const idx = plan.args.indexOf('--accessToken');
    expect(plan.args[idx + 1]).toBe('0');
    expect(plan.args.join(' ')).not.toContain('eyJ');
    const userType = plan.args.indexOf('--userType');
    expect(plan.args[userType + 1]).toBe('legacy');
  });

  it('dodaje rozdzielczość tylko przy ustawionych wymiarach', () => {
    const bez = buildLaunchPlan({ instance, version: MODERN_VERSION, session: offline, javaPath: 'java', roots });
    expect(bez.args).not.toContain('--width');

    const z = buildLaunchPlan({
      instance: { ...instance, width: 1600, height: 900 },
      version: MODERN_VERSION,
      session: offline,
      javaPath: 'java',
      roots,
    });
    expect(z.args[z.args.indexOf('--width') + 1]).toBe('1600');
    expect(z.args[z.args.indexOf('--height') + 1]).toBe('900');
  });

  it('dodaje --fullscreen na końcu, gdy włączony', () => {
    const plan = buildLaunchPlan({
      instance: { ...instance, fullscreen: true },
      version: MODERN_VERSION,
      session: offline,
      javaPath: 'java',
      roots,
    });
    expect(plan.args).toContain('--fullscreen');
  });

  it('używa Quick Play dla wersji, które je obsługują', () => {
    expect(supportsQuickPlay(MODERN_VERSION)).toBe(true);
    const plan = buildLaunchPlan({
      instance,
      version: MODERN_VERSION,
      session: offline,
      javaPath: 'java',
      roots,
      server: { address: 'mc.przyklad.pl', port: 25565 },
    });
    expect(plan.args).toContain('--quickPlayMultiplayer');
    expect(plan.args[plan.args.indexOf('--quickPlayMultiplayer') + 1]).toBe('mc.przyklad.pl:25565');
    expect(plan.args).not.toContain('--server');
  });

  it('dla starszych wersji używa --server/--port', () => {
    expect(supportsQuickPlay(LEGACY_VERSION)).toBe(false);
    const plan = buildLaunchPlan({
      instance: { ...instance, mcVersion: '1.7.10', versionId: '1.7.10' },
      version: LEGACY_VERSION,
      session: offline,
      javaPath: 'java',
      roots,
      server: { address: 'mc.przyklad.pl', port: 25566 },
    });
    expect(plan.args).toContain('--server');
    expect(plan.args[plan.args.indexOf('--port') + 1]).toBe('25566');
    expect(plan.args).not.toContain('--quickPlayMultiplayer');
  });

  it('stara wersja dostaje wygenerowane argumenty JVM', () => {
    const plan = buildLaunchPlan({
      instance: { ...instance, mcVersion: '1.7.10', versionId: '1.7.10' },
      version: LEGACY_VERSION,
      session: offline,
      javaPath: 'java',
      roots,
    });
    expect(plan.args).toContain('-cp');
    expect(plan.args.some((a) => a === `-Djava.library.path=${roots.natives}`)).toBe(true);
  });
});

describe('diagnostyka awarii', () => {
  const cases: [string, string][] = [
    ['java.lang.UnsupportedClassVersionError: net/minecraft/Main has been compiled by a more recent version of the Java Runtime', 'JAVA_TOO_OLD'],
    ['Error occurred during initialization of VM\nCould not reserve enough space for 8388608KB object heap', 'NO_MEMORY'],
    ['java.lang.OutOfMemoryError: Java heap space', 'OUT_OF_MEMORY'],
    ['java.lang.NoClassDefFoundError: org/lwjgl/system/MemoryUtil', 'MISSING_LIBRARY'],
    ['java.lang.UnsatisfiedLinkError: Failed to load a library', 'NATIVES'],
    ['Mixin apply failed sodium.mixins.json:MixinChunk', 'MOD_CONFLICT'],
    ['Missing or unsupported mandatory dependencies', 'MOD_DEPENDENCY'],
    ['Invalid session id', 'SESSION'],
    ['java.io.IOException: No space left on device', 'DISK_FULL'],
    ['Error: Could not find or load main class net.minecraftforge.Bootstrap', 'BAD_LOADER'],
  ];

  for (const [logText, code] of cases) {
    it(`rozpoznaje ${code}`, () => {
      const d = diagnoseCrash(logText, 1);
      expect(d?.code).toBe(code);
      expect(d?.hint.length).toBeGreaterThan(10);
    });
  }

  it('nie zgłasza problemu przy poprawnym zakończeniu', () => {
    expect(diagnoseCrash('Stopping worker threads\nGame closed', 0)).toBeUndefined();
    expect(diagnoseCrash('', null)).toBeUndefined();
  });

  it('daje ogólną diagnozę dla nieznanego kodu wyjścia', () => {
    const d = diagnoseCrash('nic ciekawego', 137);
    expect(d?.code).toBe('EXIT_137');
  });
});
