#!/usr/bin/env node
/**
 * Podpisuje SHA-256 pliku kluczem Ed25519 i zapisuje <plik>.sig (base64).
 * Klucz prywatny pochodzi WYŁĄCZNIE ze zmiennej NIGHTMC_UPDATE_PRIVKEY (sekret CI).
 * W EXE trafia tylko klucz publiczny.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const file = process.argv[2];
const priv = process.env.NIGHTMC_UPDATE_PRIVKEY;
if (!file) { console.error('Użycie: node scripts/sign-update.mjs <plik>'); process.exit(1); }
if (!priv) { console.log('[NightMC] Brak NIGHTMC_UPDATE_PRIVKEY - pomijam podpisywanie.'); process.exit(0); }

const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest();
const key = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(priv, 'base64')]),
  format: 'der',
  type: 'pkcs8',
});
fs.writeFileSync(`${file}.sig`, crypto.sign(null, hash, key).toString('base64'));
console.log(`[NightMC] Zapisano podpis: ${file}.sig`);
