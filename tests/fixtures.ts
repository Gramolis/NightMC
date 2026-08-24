/** Wspólne dane testowe: uproszczone, ale wierne metadane Mojang. */

import type { OsContext, VersionJson, VersionManifest } from '../src/shared/types.js';

export const WINDOWS: OsContext = { name: 'windows', version: '10.0.22631', arch: 'x86_64', features: {} };
export const LINUX: OsContext = { name: 'linux', version: '6.1.0', arch: 'x86_64', features: {} };
export const OSX_ARM: OsContext = { name: 'osx', version: '14.4', arch: 'arm64', features: {} };

export const RAW_MANIFEST = {
  latest: { release: '1.21.4', snapshot: '25w02a' },
  versions: [
    { id: '1.21.4', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/aaa/1.21.4.json', time: '2024-12-03T10:12:57+00:00', releaseTime: '2024-12-03T10:12:57+00:00', sha1: 'a'.repeat(40), complianceLevel: 1 },
    { id: '25w02a', type: 'snapshot', url: 'https://piston-meta.mojang.com/v1/packages/bbb/25w02a.json', time: '2025-01-08T12:00:00+00:00', releaseTime: '2025-01-08T12:00:00+00:00', sha1: 'b'.repeat(40) },
    { id: '1.12.2', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/ccc/1.12.2.json', time: '2017-09-18T08:39:46+00:00', releaseTime: '2017-09-18T08:39:46+00:00', sha1: 'c'.repeat(40) },
    { id: 'b1.7.3', type: 'old_beta', url: 'https://piston-meta.mojang.com/v1/packages/ddd/b1.7.3.json', time: '2011-07-08T10:00:00+00:00', releaseTime: '2011-07-08T10:00:00+00:00', sha1: 'd'.repeat(40) },
    { id: 'a1.0.4', type: 'old_alpha', url: 'https://piston-meta.mojang.com/v1/packages/eee/a1.0.4.json', time: '2010-11-30T10:00:00+00:00', releaseTime: '2010-11-30T10:00:00+00:00', sha1: 'e'.repeat(40) },
    { id: 'ZEPSUTA', type: 'nieznany', url: 'https://example.com/x.json', time: '', releaseTime: '', sha1: '' },
  ],
} as const;

/** Nowoczesna wersja (format argumentów 1.13+, natives jako osobne biblioteki). */
export const MODERN_VERSION: VersionJson = {
  id: '1.21.4',
  type: 'release',
  releaseTime: '2024-12-03T10:12:57+00:00',
  mainClass: 'net.minecraft.client.main.Main',
  javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
  assets: '19',
  assetIndex: {
    id: '19',
    sha1: '1'.repeat(40),
    size: 447000,
    totalSize: 800000000,
    url: 'https://piston-meta.mojang.com/v1/packages/111/19.json',
  },
  downloads: {
    client: { url: 'https://piston-data.mojang.com/v1/objects/aaa/client.jar', sha1: 'f'.repeat(40), size: 26000000 },
  },
  logging: {
    client: {
      argument: '-Dlog4j.configurationFile=${path}',
      type: 'log4j2-xml',
      file: { id: 'client-1.12.xml', sha1: '2'.repeat(40), size: 888, url: 'https://piston-data.mojang.com/v1/objects/bbb/client-1.12.xml' },
    },
  },
  libraries: [
    {
      name: 'com.mojang:logging:1.2.7',
      downloads: {
        artifact: {
          path: 'com/mojang/logging/1.2.7/logging-1.2.7.jar',
          sha1: '3'.repeat(40),
          size: 15000,
          url: 'https://libraries.minecraft.net/com/mojang/logging/1.2.7/logging-1.2.7.jar',
        },
      },
    },
    {
      name: 'org.lwjgl:lwjgl:3.3.3',
      downloads: {
        artifact: {
          path: 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar',
          sha1: '4'.repeat(40),
          size: 900000,
          url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar',
        },
      },
    },
    {
      // Nowy format natives: osobna biblioteka z regułą OS.
      name: 'org.lwjgl:lwjgl:3.3.3:natives-windows',
      rules: [{ action: 'allow', os: { name: 'windows' } }],
      downloads: {
        artifact: {
          path: 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar',
          sha1: '5'.repeat(40),
          size: 400000,
          url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar',
        },
      },
    },
    {
      // Biblioteka wyłącznie dla macOS - na Windows musi zniknąć.
      name: 'ca.weblite:java-objc-bridge:1.1',
      rules: [{ action: 'allow', os: { name: 'osx' } }],
      downloads: {
        artifact: {
          path: 'ca/weblite/java-objc-bridge/1.1/java-objc-bridge-1.1.jar',
          sha1: '6'.repeat(40),
          size: 40000,
          url: 'https://libraries.minecraft.net/ca/weblite/java-objc-bridge/1.1/java-objc-bridge-1.1.jar',
        },
      },
    },
  ],
  arguments: {
    jvm: [
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-XstartOnFirstThread' },
      { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump' },
      '-Djava.library.path=${natives_directory}',
      '-Dminecraft.launcher.brand=${launcher_name}',
      '-cp',
      '${classpath}',
    ],
    game: [
      '--username', '${auth_player_name}',
      '--version', '${version_name}',
      '--gameDir', '${game_directory}',
      '--assetsDir', '${assets_root}',
      '--assetIndex', '${assets_index_name}',
      '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}',
      '--userType', '${user_type}',
      '--versionType', '${version_type}',
      {
        rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
        value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
      },
      {
        rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }],
        value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'],
      },
    ],
  },
};

/** Stara wersja (minecraftArguments, natives przez classifiers). */
export const LEGACY_VERSION: VersionJson = {
  id: '1.7.10',
  type: 'release',
  releaseTime: '2014-05-14T17:29:23+00:00',
  mainClass: 'net.minecraft.client.main.Main',
  assets: '1.7.10',
  minecraftArguments:
    '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} ' +
    '--assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} ' +
    '--accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type}',
  assetIndex: {
    id: '1.7.10',
    sha1: '7'.repeat(40),
    size: 100,
    totalSize: 1000,
    url: 'https://piston-meta.mojang.com/v1/packages/777/1.7.10.json',
  },
  downloads: {
    client: { url: 'https://piston-data.mojang.com/v1/objects/ccc/client.jar', sha1: '8'.repeat(40), size: 5000000 },
  },
  libraries: [
    {
      name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.1',
      natives: { windows: 'natives-windows', linux: 'natives-linux', osx: 'natives-osx' },
      extract: { exclude: ['META-INF/'] },
      downloads: {
        classifiers: {
          'natives-windows': {
            path: 'org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar',
            sha1: '9'.repeat(40),
            size: 500000,
            url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar',
          },
          'natives-linux': {
            path: 'org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-linux.jar',
            sha1: 'a'.repeat(40),
            size: 500000,
            url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-linux.jar',
          },
        },
      },
    },
    {
      name: 'net.sf.jopt-simple:jopt-simple:4.5',
      downloads: {
        artifact: {
          path: 'net/sf/jopt-simple/jopt-simple/4.5/jopt-simple-4.5.jar',
          sha1: 'b'.repeat(40),
          size: 62000,
          url: 'https://libraries.minecraft.net/net/sf/jopt-simple/jopt-simple/4.5/jopt-simple-4.5.jar',
        },
      },
    },
  ],
};

/** Profil Fabric dziedziczący po wersji vanilla. */
export const FABRIC_PROFILE: VersionJson = {
  id: 'fabric-loader-0.16.9-1.21.4',
  inheritsFrom: '1.21.4',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  arguments: { jvm: [], game: [] },
  libraries: [
    { name: 'net.fabricmc:fabric-loader:0.16.9', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:intermediary:1.21.4', url: 'https://maven.fabricmc.net/' },
  ],
};

export const MANIFEST_TYPED = RAW_MANIFEST as unknown as VersionManifest;
