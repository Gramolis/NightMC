#!/usr/bin/env node
/**
 * Buduje trzy artefakty do out/:
 *   out/main/index.cjs      - proces główny (CommonJS, bo Electron main + moduły natywne)
 *   out/preload/index.cjs   - preload (CommonJS, sandbox wymaga CJS)
 *   out/renderer/           - statyczny build Vite
 */
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'out');

// Lokalne buildy pobierają konfigurację z ignorowanego przez Git pliku .env.
// Zmienne ustawione przez CI mają pierwszeństwo przed wartościami z pliku.
try {
  loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

/** Moduły, których nie wolno wbudować w bundle. */
const external = ['electron', 'better-sqlite3', 'keytar', 'bindings'];

const define = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  // Wartości wstrzykiwane w czasie budowania (patrz .env.example / README).
  'process.env.NIGHTMC_MS_CLIENT_ID': JSON.stringify(process.env.NIGHTMC_MS_CLIENT_ID ?? ''),
  'process.env.NIGHTMC_UPDATE_REPO': JSON.stringify(process.env.NIGHTMC_UPDATE_REPO ?? ''),
  'process.env.NIGHTMC_NEWS_URL': JSON.stringify(process.env.NIGHTMC_NEWS_URL ?? ''),
  'process.env.NIGHTMC_UPDATE_PUBKEY': JSON.stringify(process.env.NIGHTMC_UPDATE_PUBKEY ?? ''),
};

async function bundleNode(entry, outfile) {
  await esbuild({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, outfile),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    minify: process.env.NODE_ENV !== 'development',
    external,
    define,
    logLevel: 'info',
    tsconfig: path.join(root, 'tsconfig.json'),
  });
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await bundleNode('src/main/index.ts', 'out/main/index.cjs');
  await bundleNode('src/preload/index.ts', 'out/preload/index.cjs');
  await viteBuild({ configFile: path.join(root, 'vite.config.ts') });

  console.log('\n[NightMC] Build gotowy -> out/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
