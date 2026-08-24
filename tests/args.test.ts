import { describe, it, expect } from 'vitest';
import {
  buildLaunchArguments,
  expandArguments,
  legacyJvmArguments,
  mergeVersions,
  requiredJavaMajor,
  substitute,
} from '../src/main/minecraft.js';
import { FABRIC_PROFILE, LEGACY_VERSION, LINUX, MODERN_VERSION, WINDOWS } from './fixtures.js';

const PLACEHOLDERS = {
  auth_player_name: 'Nocny_Gracz',
  version_name: '1.21.4',
  game_directory: 'C:\\dane\\minecraft',
  assets_root: 'C:\\dane\\assets',
  assets_index_name: '19',
  auth_uuid: '0123456789abcdef0123456789abcdef',
  auth_access_token: '0',
  user_type: 'legacy',
  version_type: 'release',
  natives_directory: 'C:\\dane\\natives',
  launcher_name: 'NightMC',
  launcher_version: '1.0.0',
  classpath: 'a.jar;b.jar',
  classpath_separator: ';',
  resolution_width: '1280',
  resolution_height: '720',
  user_properties: '{}',
  quickPlayMultiplayer: 'mc.przyklad.pl:25565',
};

describe('podstawianie placeholderów', () => {
  it('podstawia znane klucze', () => {
    expect(substitute('--username ${auth_player_name}', PLACEHOLDERS)).toBe('--username Nocny_Gracz');
  });

  it('zostawia nieznane placeholdery nietknięte', () => {
    expect(substitute('${nie_istnieje}', PLACEHOLDERS)).toBe('${nie_istnieje}');
  });

  it('nie psuje się na ścieżkach Windows ze spacjami', () => {
    const out = substitute('-Djava.library.path=${natives_directory}', {
      natives_directory: 'C:\\Program Files\\NightMC\\natives',
    });
    expect(out).toBe('-Djava.library.path=C:\\Program Files\\NightMC\\natives');
  });
});

describe('rozwijanie argumentów warunkowych', () => {
  it('pomija argumenty, których reguły nie pasują', () => {
    const jvm = expandArguments(MODERN_VERSION.arguments!.jvm, WINDOWS, PLACEHOLDERS);
    expect(jvm).toContain('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    expect(jvm).not.toContain('-XstartOnFirstThread');
  });

  it('dodaje rozdzielczość tylko przy włączonej cesze', () => {
    const bez = expandArguments(MODERN_VERSION.arguments!.game, WINDOWS, PLACEHOLDERS);
    expect(bez).not.toContain('--width');

    const z = expandArguments(
      MODERN_VERSION.arguments!.game,
      { ...WINDOWS, features: { has_custom_resolution: true } },
      PLACEHOLDERS,
    );
    expect(z).toContain('--width');
    expect(z[z.indexOf('--width') + 1]).toBe('1280');
  });

  it('dodaje Quick Play tylko przy dołączaniu do serwera', () => {
    const z = expandArguments(
      MODERN_VERSION.arguments!.game,
      { ...WINDOWS, features: { is_quick_play_multiplayer: true } },
      PLACEHOLDERS,
    );
    expect(z).toContain('--quickPlayMultiplayer');
    expect(z[z.indexOf('--quickPlayMultiplayer') + 1]).toBe('mc.przyklad.pl:25565');
  });
});

describe('budowa pełnej listy argumentów', () => {
  it('nowy format: pamięć, JVM, klasa główna, argumenty gry', () => {
    const args = buildLaunchArguments({
      version: MODERN_VERSION,
      ctx: WINDOWS,
      placeholders: PLACEHOLDERS,
      memoryMin: 1024,
      memoryMax: 4096,
      extraJvmArgs: ['-XX:+UseG1GC'],
    });
    expect(args[0]).toBe('-Xms1024M');
    expect(args[1]).toBe('-Xmx4096M');
    expect(args).toContain('-XX:+UseG1GC');
    const mainIndex = args.indexOf('net.minecraft.client.main.Main');
    expect(mainIndex).toBeGreaterThan(0);
    // -cp musi być PRZED klasą główną, argumenty gry PO niej.
    expect(args.indexOf('-cp')).toBeLessThan(mainIndex);
    expect(args.indexOf('--username')).toBeGreaterThan(mainIndex);
    expect(args).toContain('Nocny_Gracz');
  });

  it('stary format minecraftArguments jest rozbijany po spacjach', () => {
    const args = buildLaunchArguments({
      version: LEGACY_VERSION,
      ctx: WINDOWS,
      placeholders: PLACEHOLDERS,
      memoryMin: 512,
      memoryMax: 2048,
      extraJvmArgs: [],
    });
    const mainIndex = args.indexOf('net.minecraft.client.main.Main');
    expect(mainIndex).toBeGreaterThan(0);
    expect(args).toContain('--userProperties');
    expect(args.indexOf('--username')).toBeGreaterThan(mainIndex);
    // Stare wersje nie deklarują argumentów JVM - musimy je dodać sami.
    expect(args).toContain('-cp');
    expect(args.some((a) => a.startsWith('-Djava.library.path='))).toBe(true);
  });

  it('dokleja dodatkowe argumenty gry na końcu', () => {
    const args = buildLaunchArguments({
      version: LEGACY_VERSION,
      ctx: WINDOWS,
      placeholders: PLACEHOLDERS,
      memoryMin: 512,
      memoryMax: 2048,
      extraJvmArgs: [],
      extraGameArgs: ['--server', 'mc.przyklad.pl', '--port', '25565'],
    });
    expect(args.slice(-4)).toEqual(['--server', 'mc.przyklad.pl', '--port', '25565']);
  });

  it('dodaje -XstartOnFirstThread na macOS w trybie klasycznym', () => {
    expect(legacyJvmArguments({ name: 'osx', version: '14', arch: 'arm64' })).toContain('-XstartOnFirstThread');
    expect(legacyJvmArguments(LINUX)).not.toContain('-XstartOnFirstThread');
  });
});

describe('dziedziczenie wersji', () => {
  it('scala profil loadera z wersją bazową', () => {
    const merged = mergeVersions(FABRIC_PROFILE, MODERN_VERSION);
    expect(merged.id).toBe('fabric-loader-0.16.9-1.21.4');
    expect(merged.inheritsFrom).toBeUndefined();
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient');
    expect(merged.assetIndex?.id).toBe('19');
    expect(merged.downloads?.['client']).toBeTruthy();
    // Biblioteki loadera mają być PRZED bibliotekami vanilla.
    expect(merged.libraries![0]!.name).toBe('net.fabricmc:fabric-loader:0.16.9');
    expect(merged.libraries!.some((l) => l.name === 'org.lwjgl:lwjgl:3.3.3')).toBe(true);
  });

  it('argumenty rodzica poprzedzają argumenty potomka', () => {
    const merged = mergeVersions(
      { ...FABRIC_PROFILE, arguments: { jvm: ['-DfabricFlag=1'], game: [] } },
      MODERN_VERSION,
    );
    const jvm = merged.arguments!.jvm!;
    expect(jvm[jvm.length - 1]).toBe('-DfabricFlag=1');
    expect(jvm).toContain('${classpath}');
  });
});

describe('wymagana wersja Javy', () => {
  it('używa pola javaVersion, gdy jest dostępne', () => {
    expect(requiredJavaMajor(MODERN_VERSION)).toBe(21);
  });

  it('dla starych wersji bez tego pola stosuje heurystykę po dacie', () => {
    expect(requiredJavaMajor(LEGACY_VERSION)).toBe(8);
    expect(requiredJavaMajor({ id: '1.17', mainClass: 'M', releaseTime: '2021-06-08T11:00:00+00:00' })).toBe(16);
    expect(requiredJavaMajor({ id: '1.18', mainClass: 'M', releaseTime: '2021-11-30T09:16:29+00:00' })).toBe(17);
    expect(requiredJavaMajor({ id: '1.20.5', mainClass: 'M', releaseTime: '2024-04-23T12:56:12+00:00' })).toBe(21);
  });

  it('bez daty zakłada Javę 8', () => {
    expect(requiredJavaMajor({ id: 'x', mainClass: 'M' })).toBe(8);
  });
});
