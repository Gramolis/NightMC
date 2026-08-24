#!/usr/bin/env node
/** Generuje parę kluczy Ed25519 do podpisywania aktualizacji. */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');

console.log('\nKLUCZ PUBLICZNY  -> .env jako NIGHTMC_UPDATE_PUBKEY (trafia do EXE):');
console.log(pub);
console.log('\nKLUCZ PRYWATNY   -> sekret GitHub Actions NIGHTMC_UPDATE_PRIVKEY.');
console.log('NIGDY nie umieszczaj go w repozytorium ani w pliku .env commitowanym do gita:');
console.log(priv);
console.log('');
