#!/usr/bin/env node
/** Tryb deweloperski: Vite dev server + Electron z watcherem esbuild na main/preload. */
import { createServer } from 'vite';
import { context as esbuildContext } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import electronPath from 'electron';
import { loadEnvFile } from 'node:process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Lokalne uruchomienie pobiera konfigurację z ignorowanego przez Git pliku .env.
try {
  loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const external = ['electron', 'better-sqlite3', 'keytar', 'bindings'];

const define = {
  'process.env.NODE_ENV': JSON.stringify('development'),
  'process.env.NIGHTMC_MS_CLIENT_ID': JSON.stringify(process.env.NIGHTMC_MS_CLIENT_ID ?? ''),
  'process.env.NIGHTMC_UPDATE_REPO': JSON.stringify(process.env.NIGHTMC_UPDATE_REPO ?? ''),
  'process.env.NIGHTMC_NEWS_URL': JSON.stringify(process.env.NIGHTMC_NEWS_URL ?? ''),
  'process.env.NIGHTMC_UPDATE_PUBKEY': JSON.stringify(process.env.NIGHTMC_UPDATE_PUBKEY ?? ''),
};

let child = null;
function restartElectron(url) {
  if (child) {
    child.removeAllListeners('exit');
    child.kill();
  }
  child = spawn(String(electronPath), [path.join(root, 'out/main/index.cjs')], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: url },
  });
  child.on('exit', () => process.exit(0));
}

async function main() {
  const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';
  server.printUrls();

  const mkCtx = (entry, outfile) =>
    esbuildContext({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(root, outfile),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external,
      define,
      sourcemap: 'inline',
      plugins: [
        {
          name: 'nightmc-restart',
          setup(b) {
            b.onEnd((res) => {
              if (res.errors.length === 0 && outfile.includes('main')) restartElectron(url);
            });
          },
        },
      ],
    });

  const ctxPreload = await mkCtx('src/preload/index.ts', 'out/preload/index.cjs');
  await ctxPreload.watch();
  const ctxMain = await mkCtx('src/main/index.ts', 'out/main/index.cjs');
  await ctxMain.watch();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
