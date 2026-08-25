/**
 * Warstwa danych kont.
 *
 * W bazie trzymamy WYŁĄCZNIE dane jawne (nazwa, UUID, typ, czy posiada grę).
 * Tokeny i refresh tokeny obsługuje `secrets.ts`, nigdy SQLite.
 */

import { db } from './db.js';
import { forgetAccount } from './auth.js';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createOfflineAccount, offlineUuid, validateUsername } from './offline.js';
import { log } from './logging.js';
import { skinsDir } from './paths.js';
import type { Account } from '../shared/types.js';

function rowToAccount(r: any): Account {
  return {
    id: String(r.id),
    type: r.type === 'microsoft' ? 'microsoft' : 'offline',
    username: String(r.username),
    uuid: String(r.uuid),
    ownsGame: r.owns_game === null || r.owns_game === undefined ? undefined : Number(r.owns_game) === 1,
    skinUrl: r.skin_url ?? undefined,
    avatar: r.avatar ?? undefined,
    active: Number(r.active) === 1,
    addedAt: Number(r.added_at),
    lastUsedAt: r.last_used_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
  };
}

export function listAccounts(): Account[] {
  return db().prepare(`SELECT * FROM accounts ORDER BY active DESC, added_at DESC`).all().map(rowToAccount);
}

export function getAccount(id: string): Account {
  const row = db().prepare(`SELECT * FROM accounts WHERE id = ?`).get(id);
  if (!row) throw new Error(`Profil "${id}" nie istnieje`);
  return rowToAccount(row);
}

export function activeAccount(): Account | null {
  const row = db().prepare(`SELECT * FROM accounts WHERE active = 1 LIMIT 1`).get();
  return row ? rowToAccount(row) : null;
}

export function upsertAccount(account: Account): Account {
  const existing = db().prepare(`SELECT id FROM accounts WHERE type = ? AND uuid = ?`).get(account.type, account.uuid);
  const id = existing ? String(existing.id) : account.id;

  db()
    .prepare(
      `INSERT INTO accounts (id, type, username, uuid, owns_game, skin_url, avatar, active, added_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username, owns_game = excluded.owns_game,
         skin_url = excluded.skin_url, avatar = excluded.avatar, expires_at = excluded.expires_at`,
    )
    .run(
      id,
      account.type,
      account.username,
      account.uuid,
      account.ownsGame === undefined ? null : account.ownsGame ? 1 : 0,
      account.skinUrl ?? null,
      account.avatar ?? null,
      account.active ? 1 : 0,
      account.addedAt,
      account.lastUsedAt ?? null,
      account.expiresAt ?? null,
    );

  // Pierwszy dodany profil staje się aktywny automatycznie.
  const count = Number(db().prepare(`SELECT COUNT(*) AS c FROM accounts`).get()?.c ?? 0);
  if (count === 1) setActiveAccount(id);

  return getAccount(id);
}

export function addOfflineAccount(username: string, opts: { skinPath?: string; avatar?: string } = {}): Account {
  const account = createOfflineAccount(username, opts);
  const created = upsertAccount(account);
  log.info(`Dodano profil offline "${created.username}" (UUID ${created.uuid})`);
  return created;
}

async function readSkinPng(file: string): Promise<Buffer> {
  const data = await fsp.readFile(file);
  if (data.length > 2 * 1024 * 1024) throw new Error('Skórka jest za duża (maksymalnie 2 MB)');
  const pngSignature = '89504e470d0a1a0a';
  if (data.length < 24 || data.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('Wybrany plik nie jest poprawnym obrazem PNG');
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Nieprawidłowy rozmiar skórki: ${width}×${height}. Wymagane 64×64 albo starsze 64×32.`);
  }
  return data;
}

/** Edytuje profil offline i przechowuje wybraną skórkę niezależnie od pliku źródłowego. */
export async function updateOfflineAccount(
  id: string,
  input: { username: string; skinPath?: string; removeSkin?: boolean },
): Promise<Account> {
  const account = getAccount(id);
  if (account.type !== 'offline') throw new Error('Nazwę i lokalną skórkę można edytować tylko w profilu Offline');

  const username = input.username.trim();
  validateUsername(username);
  const uuid = offlineUuid(username);
  const collision = db().prepare(`SELECT id FROM accounts WHERE type = 'offline' AND uuid = ? AND id <> ?`).get(uuid, id);
  if (collision) throw new Error(`Profil offline „${username}” już istnieje`);

  let skinUrl = account.skinUrl;
  let avatar = account.avatar;
  const managedPath = path.join(skinsDir(), `${id}.png`);

  if (input.removeSkin) {
    await fsp.rm(managedPath, { force: true });
    skinUrl = undefined;
    avatar = undefined;
  } else if (input.skinPath) {
    const data = await readSkinPng(input.skinPath);
    await fsp.mkdir(skinsDir(), { recursive: true });
    if (path.resolve(input.skinPath) !== path.resolve(managedPath)) {
      const temp = `${managedPath}.tmp`;
      await fsp.writeFile(temp, data);
      await fsp.rm(managedPath, { force: true });
      await fsp.rename(temp, managedPath);
    }
    skinUrl = managedPath;
    avatar = `data:image/png;base64,${data.toString('base64')}`;
  }

  db().prepare(`UPDATE accounts SET username = ?, uuid = ?, skin_url = ?, avatar = ? WHERE id = ?`)
    .run(username, uuid, skinUrl ?? null, avatar ?? null, id);
  const updated = getAccount(id);
  log.info(`Zaktualizowano profil offline „${updated.username}”`);
  return updated;
}

export function setActiveAccount(id: string): Account {
  db().prepare(`UPDATE accounts SET active = 0`).run();
  db().prepare(`UPDATE accounts SET active = 1, last_used_at = ? WHERE id = ?`).run(Date.now(), id);
  return getAccount(id);
}

export async function removeAccount(id: string): Promise<void> {
  const account = getAccount(id);
  if (account.type === 'microsoft') await forgetAccount(id);
  db().prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  if (account.type === 'offline') await fsp.rm(path.join(skinsDir(), `${id}.png`), { force: true });
  const remaining = listAccounts();
  if (account.active && remaining[0]) setActiveAccount(remaining[0].id);
  log.info(`Usunięto profil "${account.username}"`);
}
