/**
 * Warstwa danych kont.
 *
 * W bazie trzymamy WYŁĄCZNIE dane jawne (nazwa, UUID, typ, czy posiada grę).
 * Tokeny i refresh tokeny obsługuje `secrets.ts`, nigdy SQLite.
 */

import { db } from './db.js';
import { forgetAccount } from './auth.js';
import { createOfflineAccount } from './offline.js';
import { log } from './logging.js';
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

export function setActiveAccount(id: string): Account {
  db().prepare(`UPDATE accounts SET active = 0`).run();
  db().prepare(`UPDATE accounts SET active = 1, last_used_at = ? WHERE id = ?`).run(Date.now(), id);
  return getAccount(id);
}

export async function removeAccount(id: string): Promise<void> {
  const account = getAccount(id);
  if (account.type === 'microsoft') await forgetAccount(id);
  db().prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
  const remaining = listAccounts();
  if (account.active && remaining[0]) setActiveAccount(remaining[0].id);
  log.info(`Usunięto profil "${account.username}"`);
}
