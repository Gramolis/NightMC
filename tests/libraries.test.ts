import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildClasspath, classpathSeparator, mavenToPath, mavenUrl, resolveLibraries } from '../src/main/minecraft.js';
import { LEGACY_VERSION, LINUX, MODERN_VERSION, OSX_ARM, WINDOWS } from './fixtures.js';

describe('współrzędne Maven', () => {
  it('zamienia group:artifact:version na ścieżkę', () => {
    expect(mavenToPath('com.mojang:logging:1.2.7')).toBe('com/mojang/logging/1.2.7/logging-1.2.7.jar');
  });

  it('obsługuje klasyfikator', () => {
    expect(mavenToPath('org.lwjgl:lwjgl:3.3.3:natives-windows')).toBe(
      'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar',
    );
  });

  it('obsługuje inne rozszerzenie', () => {
    expect(mavenToPath('net.minecraftforge:forge:1.20.1-47.2.0:clientdata@lzma')).toBe(
      'net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-clientdata.lzma',
    );
  });

  it('odrzuca niepełne współrzędne', () => {
    expect(() => mavenToPath('a:b')).toThrow();
  });

  it('buduje URL na podstawie repozytorium', () => {
    expect(mavenUrl('https://maven.fabricmc.net/', 'net.fabricmc:fabric-loader:0.16.9')).toBe(
      'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar',
    );
  });
});

describe('rozwiązywanie bibliotek', () => {
  it('na Windows bierze natives-windows i pomija biblioteki macOS', () => {
    const libs = resolveLibraries(MODERN_VERSION, WINDOWS);
    const names = libs.map((l) => l.relPath);
    expect(names).toContain('org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
    expect(names.some((n) => n.includes('java-objc-bridge'))).toBe(false);
  });

  it('oznacza nowy format natives jako archiwum do rozpakowania', () => {
    const libs = resolveLibraries(MODERN_VERSION, WINDOWS);
    const native = libs.find((l) => l.relPath.includes('natives-windows'));
    expect(native?.isNative).toBe(true);
    const normal = libs.find((l) => l.relPath.endsWith('lwjgl-3.3.3.jar'));
    expect(normal?.isNative).toBe(false);
  });

  it('na macOS dołącza bibliotekę zależną od systemu', () => {
    const libs = resolveLibraries(MODERN_VERSION, OSX_ARM);
    expect(libs.some((l) => l.relPath.includes('java-objc-bridge'))).toBe(true);
    expect(libs.some((l) => l.relPath.includes('natives-windows'))).toBe(false);
  });

  it('obsługuje stary format natives przez classifiers', () => {
    const win = resolveLibraries(LEGACY_VERSION, WINDOWS);
    const native = win.find((l) => l.isNative);
    expect(native?.relPath).toBe('org/lwjgl/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar');
    expect(native?.excludes).toEqual(['META-INF/']);

    const lin = resolveLibraries(LEGACY_VERSION, LINUX);
    expect(lin.find((l) => l.isNative)?.relPath).toContain('natives-linux');
  });

  it('buduje URL bibliotek loadera bez sekcji downloads', () => {
    const libs = resolveLibraries(
      { id: 'x', mainClass: 'M', libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.9', url: 'https://maven.fabricmc.net/' }] },
      WINDOWS,
    );
    expect(libs[0]!.url).toBe('https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
  });
});

describe('classpath', () => {
  it('pomija natives i kończy się plikiem klienta', () => {
    const libs = resolveLibraries(MODERN_VERSION, WINDOWS);
    const cp = buildClasspath(libs, '/libs', '/versions/1.21.4/1.21.4.jar');
    expect(cp[cp.length - 1]).toBe('/versions/1.21.4/1.21.4.jar');
    expect(cp.some((p) => p.includes('natives-windows'))).toBe(false);
  });

  it('usuwa duplikaty group:artifact zachowując pierwsze wystąpienie', () => {
    const libs = resolveLibraries(
      {
        id: 'x',
        mainClass: 'M',
        libraries: [
          { name: 'com.example:lib:2.0', url: 'https://maven.neoforged.net/releases/' },
          { name: 'com.example:lib:1.0', url: 'https://maven.neoforged.net/releases/' },
        ],
      },
      WINDOWS,
    );
    const cp = buildClasspath(libs, '/libs', '/client.jar');
    expect(cp).toHaveLength(2);
    expect(cp[0]).toBe(path.join('/libs', 'com', 'example', 'lib', '2.0', 'lib-2.0.jar'));
  });

  it('używa średnika na Windows i dwukropka gdzie indziej', () => {
    expect(classpathSeparator(WINDOWS)).toBe(';');
    expect(classpathSeparator(LINUX)).toBe(':');
    expect(classpathSeparator(OSX_ARM)).toBe(':');
  });
});
