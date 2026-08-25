/**
 * Test end-to-end (bez prawdziwego Minecrafta - w CI go nie uruchamiamy).
 *
 * Przechodzi całą ścieżkę: start launchera -> utworzenie instancji Vanilla ->
 * pobranie metadanych -> weryfikacja plików -> wybór Javy -> profil offline ->
 * zbudowanie argumentów -> uruchomienie atrapowego procesu -> odczyt logów.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ensureDirs, dataDir, dbPath, instanceGameDir, skinsDir } from '../src/main/paths.js';
import { closeDb, initDb } from '../src/main/db.js';
import { createInstance, getInstance, listInstances, recordPlaySession, updateInstance } from '../src/main/instances.js';
import { addOfflineAccount, activeAccount, setActiveAccount, updateOfflineAccount } from '../src/main/accounts.js';
import { offlineSession } from '../src/main/offline.js';
import { DownloadQueue, hashBuffer, verifyFile } from '../src/main/downloader.js';
import { pickJavaFor, parseJavaVersionOutput } from '../src/main/java.js';
import { requiredJavaMajor } from '../src/main/minecraft.js';
import { buildLaunchPlan } from '../src/main/launcher.js';
import { clearLogs, getLogs, pushLog } from '../src/main/logging.js';
import { MODERN_VERSION } from './fixtures.js';

const CLIENT_JAR = Buffer.from('UDAWANY-CLIENT-JAR-'.repeat(200));
const LIBRARY_JAR = Buffer.from('UDAWANA-BIBLIOTEKA-'.repeat(50));
const ASSET = Buffer.from('{"pack":{"description":"test"}}');

const CLIENT_SHA1 = hashBuffer(CLIENT_JAR, 'sha1');
const LIBRARY_SHA1 = hashBuffer(LIBRARY_JAR, 'sha1');
const ASSET_SHA1 = hashBuffer(ASSET, 'sha1');

let server: http.Server;
let base = '';
let workRoot = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const body = p === '/client.jar' ? CLIENT_JAR : p === '/library.jar' ? LIBRARY_JAR : p === '/asset' ? ASSET : null;
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': String(body.length) }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  workRoot = path.join(dataDir());
  await fsp.rm(workRoot, { recursive: true, force: true });
  ensureDirs();
  initDb(dbPath());
});

afterAll(async () => {
  closeDb();
  await new Promise<void>((r) => server.close(() => r()));
  await fsp.rm(path.dirname(workRoot), { recursive: true, force: true });
});

describe('pełna ścieżka: od instancji do uruchomionego procesu', () => {
  it('1. tworzy instancję Vanilla z kompletem katalogów', () => {
    const instance = createInstance(
      { name: 'E2E Vanilla', mcVersion: '1.21.4', loader: 'vanilla' },
      { memoryMin: 1024, memoryMax: 2048, jvmArgs: '-XX:+UseG1GC' },
    );
    expect(instance.id).toMatch(/^inst-/);
    expect(instance.versionId).toBe('1.21.4');
    expect(instance.installed).toBe(false);
    for (const sub of ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots']) {
      expect(fs.existsSync(path.join(instance.dir, 'minecraft', sub))).toBe(true);
    }
    expect(fs.existsSync(path.join(instance.dir, 'natives'))).toBe(true);
  });

  it('2. pobiera pliki gry i weryfikuje każdy z nich', async () => {
    const instance = getInstance(instanceId());
    const libraries = path.join(workRoot, 'shared', 'libraries');
    const versions = path.join(workRoot, 'shared', 'versions', '1.21.4');
    const assets = path.join(workRoot, 'shared', 'assets', 'objects', ASSET_SHA1.slice(0, 2));

    const progressEvents: number[] = [];
    const queue = new DownloadQueue({
      allowExtraHosts: ['127.0.0.1'],
      concurrency: 3,
      onProgress: (p) => progressEvents.push(p.progress),
      phase: 'E2E',
    });
    queue.add({ id: 'client', url: `${base}/client.jar`, dest: path.join(versions, '1.21.4.jar'), sha1: CLIENT_SHA1, size: CLIENT_JAR.length });
    queue.add({ id: 'lib', url: `${base}/library.jar`, dest: path.join(libraries, 'com', 'mojang', 'logging', '1.2.7', 'logging-1.2.7.jar'), sha1: LIBRARY_SHA1, size: LIBRARY_JAR.length });
    queue.add({ id: 'asset', url: `${base}/asset`, dest: path.join(assets, ASSET_SHA1), sha1: ASSET_SHA1, size: ASSET.length });

    const result = await queue.run();
    expect(result.ok).toBe(true);
    expect(result.failed).toHaveLength(0);
    expect(progressEvents.length).toBeGreaterThan(0);

    // Instalacja jest kompletna dopiero, gdy KAŻDY plik przechodzi weryfikację.
    expect(await verifyFile(path.join(versions, '1.21.4.jar'), { sha1: CLIENT_SHA1, size: CLIENT_JAR.length })).toBe(true);
    expect(await verifyFile(path.join(assets, ASSET_SHA1), { sha1: ASSET_SHA1 })).toBe(true);

    updateInstance(instance.id, { installed: true });
    expect(getInstance(instance.id).installed).toBe(true);
  });

  it('3. wykrywa uszkodzony plik i pozwala go naprawić', async () => {
    const target = path.join(workRoot, 'shared', 'versions', '1.21.4', '1.21.4.jar');
    await fsp.writeFile(target, 'USZKODZONY');
    expect(await verifyFile(target, { sha1: CLIENT_SHA1 })).toBe(false);

    const queue = new DownloadQueue({ allowExtraHosts: ['127.0.0.1'] });
    queue.add({ id: 'client', url: `${base}/client.jar`, dest: target, sha1: CLIENT_SHA1, size: CLIENT_JAR.length });
    expect((await queue.run()).ok).toBe(true);
    expect(await verifyFile(target, { sha1: CLIENT_SHA1 })).toBe(true);
  });

  it('4. dobiera Javę wymaganą przez tę wersję gry', () => {
    const required = requiredJavaMajor(MODERN_VERSION);
    expect(required).toBe(21);

    const detected = [
      parseJavaVersionOutput('openjdk version "1.8.0_402"\nOpenJDK 64-Bit Server VM'),
      parseJavaVersionOutput('openjdk version "21.0.2"\nOpenJDK 64-Bit Server VM Temurin-21.0.2+13'),
    ].map((p, i) => ({
      path: i === 0 ? '/java8/bin/java' : '/java21/bin/java',
      version: p!.version,
      majorVersion: p!.majorVersion,
      arch: p!.arch,
      managed: false,
    }));

    const picked = pickJavaFor(required, detected);
    expect(picked?.majorVersion).toBe(21);
    expect(picked?.path).toBe('/java21/bin/java');
  });

  it('5. dodaje profil offline i czyni go aktywnym', () => {
    const account = addOfflineAccount('Nocny_Gracz');
    setActiveAccount(account.id);
    const active = activeAccount();
    expect(active?.username).toBe('Nocny_Gracz');
    expect(active?.type).toBe('offline');
    expect(active?.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-/);
  });

  it('6. buduje argumenty procesu gry', () => {
    const instance = getInstance(instanceId());
    const session = offlineSession(activeAccount()!);
    const plan = buildLaunchPlan({
      instance,
      version: MODERN_VERSION,
      session,
      javaPath: process.execPath,
      roots: {
        libraries: path.join(workRoot, 'shared', 'libraries'),
        assets: path.join(workRoot, 'shared', 'assets'),
        gameDir: instanceGameDir(instance.id),
        natives: path.join(instance.dir, 'natives'),
        clientJar: path.join(workRoot, 'shared', 'versions', '1.21.4', '1.21.4.jar'),
      },
    });

    expect(plan.args).toContain('net.minecraft.client.main.Main');
    expect(plan.args[plan.args.indexOf('--username') + 1]).toBe('Nocny_Gracz');
    expect(plan.args[plan.args.indexOf('--accessToken') + 1]).toBe('0');
    expect(plan.args[0]).toBe('-Xms1024M');
    expect(plan.args[1]).toBe('-Xmx2048M');
  });

  it('7. uruchamia atrapowy proces gry, zbiera logi i zapisuje czas gry', async () => {
    const instance = getInstance(instanceId());
    clearLogs(instance.id);

    // Atrapa "javy": wypisuje kilka linii, w tym coś, co wygląda na token.
    const fakeJava = path.join(os.tmpdir(), `nightmc-fake-java-${process.pid}.mjs`);
    await fsp.writeFile(
      fakeJava,
      [
        "const args = process.argv.slice(2);",
        "console.log('[main/INFO] Setting user: ' + args[args.indexOf('--username') + 1]);",
        "console.log('[main/INFO] --accessToken eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SGVsbG9Xb3JsZFNpZ25hdHVyZQ');",
        "console.error('[Render thread/WARN] Ostrzeżenie testowe');",
        "console.log('[main/INFO] Stopping!');",
        "process.exit(0);",
      ].join('\n'),
      'utf8',
    );

    const startedAt = Date.now();
    const child = spawn(process.execPath, [fakeJava, '--username', 'Nocny_Gracz', '--accessToken', '0'], {
      cwd: instanceGameDir(instance.id),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const collect = (source: 'game' | 'stderr') => (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const level = /error|exception/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info';
        pushLog(instance.id, level, source, line);
      }
    };
    child.stdout.on('data', collect('game'));
    child.stderr.on('data', collect('stderr'));

    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);

    const logs = getLogs(instance.id);
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs.some((l) => l.text.includes('Setting user: Nocny_Gracz'))).toBe(true);
    expect(logs.some((l) => l.level === 'warn')).toBe(true);

    // Token musi zniknąć z logów - to jest twarde wymaganie bezpieczeństwa.
    const all = logs.map((l) => l.text).join('\n');
    expect(all).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(all).toContain('[TOKEN USUNIĘTY]');

    recordPlaySession(instance.id, (Date.now() - startedAt) / 1000, code);
    const after = getInstance(instance.id);
    expect(after.lastPlayedAt).toBeGreaterThan(0);
    expect(after.playTimeSeconds).toBeGreaterThanOrEqual(0);
    expect(after.lastError).toBeUndefined();

    await fsp.rm(fakeJava, { force: true });
  });

  it('8. edytuje profil offline i kopiuje poprawną skórkę do NightMC', async () => {
    const account = activeAccount()!;
    const source = path.join(os.tmpdir(), `nightmc-skin-${process.pid}.png`);
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
    png.writeUInt32BE(64, 16);
    png.writeUInt32BE(64, 20);
    await fsp.writeFile(source, png);

    const updated = await updateOfflineAccount(account.id, { username: 'Nocny_Edit', skinPath: source });
    expect(updated.username).toBe('Nocny_Edit');
    expect(updated.uuid).not.toBe(account.uuid);
    expect(updated.skinUrl).toBe(path.join(skinsDir(), `${account.id}.png`));
    expect(updated.avatar).toMatch(/^data:image\/png;base64,/);
    expect(fs.existsSync(updated.skinUrl!)).toBe(true);

    const withoutSkin = await updateOfflineAccount(account.id, { username: 'Nocny_Edit', removeSkin: true });
    expect(withoutSkin.skinUrl).toBeUndefined();
    expect(withoutSkin.avatar).toBeUndefined();
    await fsp.rm(source, { force: true });
  });
});

/** Pierwsza (i jedyna) instancja utworzona w tym teście. */
function instanceId(): string {
  const first = listInstances()[0];
  if (!first) throw new Error('Brak instancji - poprzedni krok testu nie przeszedł');
  return first.id;
}
