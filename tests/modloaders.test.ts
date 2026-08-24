import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  neoforgePrefix,
  parseMavenMetadata,
  readJarMainClass,
  resolveDataValue,
  substituteProcessorArg,
} from '../src/main/modloaders.js';

let tmp = '';
beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nightmc-loader-'));
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe('metadane Maven', () => {
  it('czyta listę wersji z maven-metadata.xml', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <metadata>
        <groupId>net.minecraftforge</groupId>
        <artifactId>forge</artifactId>
        <versioning>
          <versions>
            <version>1.20.1-47.2.0</version>
            <version>1.20.1-47.3.0</version>
            <version>1.21.1-52.0.10</version>
          </versions>
        </versioning>
      </metadata>`;
    const versions = parseMavenMetadata(xml);
    expect(versions).toContain('1.20.1-47.2.0');
    expect(versions).toContain('1.21.1-52.0.10');
    expect(versions).toHaveLength(3);
  });

  it('zwraca pustą listę dla metadanych bez wersji', () => {
    expect(parseMavenMetadata('<metadata></metadata>')).toEqual([]);
  });
});

describe('prefiks wersji NeoForge', () => {
  it('mapuje wersję gry na schemat NeoForge', () => {
    expect(neoforgePrefix('1.20.4')).toBe('20.4.');
    expect(neoforgePrefix('1.21')).toBe('21.0.');
    expect(neoforgePrefix('1.21.1')).toBe('21.1.');
  });
});

describe('profil instalacyjny Forge/NeoForge', () => {
  const ctx = { librariesRoot: path.join('/dane', 'libraries'), installerRoot: path.join('/tmp', 'inst') };

  it('rozwiązuje wartość Maven w nawiasach kwadratowych', () => {
    expect(resolveDataValue('[net.minecraftforge:forge:1.20.1-47.2.0:clientdata@lzma]', ctx)).toBe(
      path.join(ctx.librariesRoot, 'net', 'minecraftforge', 'forge', '1.20.1-47.2.0', 'forge-1.20.1-47.2.0-clientdata.lzma'),
    );
  });

  it('rozwiązuje wartość dosłowną w apostrofach', () => {
    expect(resolveDataValue("'client'", ctx)).toBe('client');
  });

  it('rozwiązuje ścieżkę wewnątrz instalatora', () => {
    expect(resolveDataValue('/data/client.lzma', ctx)).toBe(path.join(ctx.installerRoot, 'data', 'client.lzma'));
  });

  it('podstawia zmienne w argumentach procesora', () => {
    const values = { MINECRAFT_JAR: 'C:\\gra\\client.jar', SIDE: 'client', BINPATCH: 'C:\\tmp\\client.lzma' };
    expect(substituteProcessorArg('{MINECRAFT_JAR}', values, ctx)).toBe('C:\\gra\\client.jar');
    expect(substituteProcessorArg('--side={SIDE}', values, ctx)).toBe('--side=client');
    expect(substituteProcessorArg('{NIEZNANY}', values, ctx)).toBe('{NIEZNANY}');
  });

  it('zamienia współrzędne Maven w argumencie na ścieżkę', () => {
    const out = substituteProcessorArg('[net.minecraftforge:forge:1.20.1-47.2.0:extra]', {}, ctx);
    expect(out).toContain(path.join('net', 'minecraftforge', 'forge'));
    expect(out.endsWith('forge-1.20.1-47.2.0-extra.jar')).toBe(true);
  });
});

describe('manifest JAR procesora', () => {
  const makeJar = (manifest: string): string => {
    const zip = new AdmZip();
    zip.addFile('META-INF/MANIFEST.MF', Buffer.from(manifest));
    const file = path.join(tmp, `p-${Math.random().toString(36).slice(2)}.jar`);
    zip.writeZip(file);
    return file;
  };

  it('czyta Main-Class', () => {
    const jar = makeJar('Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.installertools.ConsoleTool\r\n\r\n');
    expect(readJarMainClass(jar)).toBe('net.minecraftforge.installertools.ConsoleTool');
  });

  it('skleja złamane linie manifestu', () => {
    const jar = makeJar('Manifest-Version: 1.0\r\nMain-Class: net.minecraftforge.install\r\n ertools.ConsoleTool\r\n\r\n');
    expect(readJarMainClass(jar)).toBe('net.minecraftforge.installertools.ConsoleTool');
  });

  it('rzuca czytelny błąd, gdy brak Main-Class', () => {
    const jar = makeJar('Manifest-Version: 1.0\r\n\r\n');
    expect(() => readJarMainClass(jar)).toThrow(/Main-Class/);
  });
});
