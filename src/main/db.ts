/**
 * Lokalna baza SQLite + migracje.
 *
 * W bazie NIE MOGĄ znaleźć się: hasła Microsoft, tokeny, client_secret,
 * certyfikaty ani klucze prywatne. Tokeny obsługuje wyłącznie `secrets.ts`.
 *
 * Sterownik: better-sqlite3 jeśli się załadował, w przeciwnym razie wbudowany
 * `node:sqlite` (Electron 38+ = Node 22). Dzięki temu brak modułu natywnego
 * nie wywraca całej aplikacji.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from './logging.js';
import { optionalRequire, requireOrThrow } from './native.js';

/* ------------------------------------------------------------------ */
/* Minimalny interfejs sterownika                                      */
/* ------------------------------------------------------------------ */

export interface SqlStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface SqlDriver {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
  readonly kind: 'better-sqlite3' | 'node:sqlite';
}

/** Tworzy sterownik dla podanego pliku (":memory:" w testach). */
export function openDriver(file: string): SqlDriver {
  const Better = optionalRequire<any>('better-sqlite3');
  try {
    if (!Better) throw new Error('moduł nie jest zainstalowany');
    const db = new Better(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return {
      kind: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql) as SqlStatement,
      close: () => db.close(),
    };
  } catch (e) {
    log.warn(`better-sqlite3 niedostępny (${(e as Error).message}), używam wbudowanego node:sqlite`);
    const { DatabaseSync } = requireOrThrow<{ DatabaseSync: any }>('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    return {
      kind: 'node:sqlite',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const st = db.prepare(sql);
        return {
          run: (...p: unknown[]) => {
            const r = st.run(...(p as any[]));
            return { changes: Number(r?.changes ?? 0) };
          },
          get: (...p: unknown[]) => st.get(...(p as any[])),
          all: (...p: unknown[]) => st.all(...(p as any[])),
        };
      },
      close: () => db.close(),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Migracje                                                            */
/* ------------------------------------------------------------------ */

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * Migracje są addytywne i idempotentne w obrębie wersji.
 * NIGDY nie zmieniaj istniejącej migracji - dodaj nową.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'schemat początkowy',
    up: `
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS instances (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        icon           TEXT,
        mc_version     TEXT NOT NULL,
        loader         TEXT NOT NULL DEFAULT 'vanilla',
        loader_version TEXT,
        version_id     TEXT NOT NULL,
        java_path      TEXT,
        memory_min     INTEGER NOT NULL DEFAULT 1024,
        memory_max     INTEGER NOT NULL DEFAULT 4096,
        jvm_args       TEXT NOT NULL DEFAULT '',
        width          INTEGER,
        height         INTEGER,
        fullscreen     INTEGER NOT NULL DEFAULT 0,
        play_time      INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER,
        created_at     INTEGER NOT NULL,
        notes          TEXT,
        installed      INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_instances_last_played ON instances(last_played_at DESC);

      -- Konta: TYLKO dane jawne. Tokeny są w magazynie poświadczeń systemu.
      CREATE TABLE IF NOT EXISTS accounts (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL CHECK (type IN ('microsoft','offline')),
        username   TEXT NOT NULL,
        uuid       TEXT NOT NULL,
        owns_game  INTEGER,
        skin_url   TEXT,
        avatar     TEXT,
        active     INTEGER NOT NULL DEFAULT 0,
        added_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_identity ON accounts(type, uuid);

      CREATE TABLE IF NOT EXISTS servers (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        address       TEXT NOT NULL,
        port          INTEGER NOT NULL DEFAULT 25565,
        icon          TEXT,
        description   TEXT,
        mc_version    TEXT,
        instance_id   TEXT,
        marked_offline INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS launch_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        account_id  TEXT,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        exit_code   INTEGER,
        error       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_instance ON launch_history(instance_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS download_meta (
        url        TEXT PRIMARY KEY,
        dest       TEXT NOT NULL,
        size       INTEGER,
        sha1       TEXT,
        bytes_done INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cache (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS instance_mods (
        instance_id TEXT NOT NULL,
        file_name   TEXT NOT NULL,
        project_id  TEXT,
        version_id  TEXT,
        display_name TEXT,
        loaders     TEXT,
        game_versions TEXT,
        sha1        TEXT,
        PRIMARY KEY (instance_id, file_name)
      );
    `,
  },
  {
    version: 2,
    name: 'katalog instancji per instancja + licznik modów',
    up: `
      ALTER TABLE instances ADD COLUMN dir_override TEXT;
      ALTER TABLE instances ADD COLUMN mod_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 3,
    name: 'znacznik ostatniej naprawy instancji',
    up: `
      ALTER TABLE instances ADD COLUMN last_verified_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** Odczytuje aktualną wersję schematu. */
export function getSchemaVersion(driver: SqlDriver): number {
  driver.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL, name TEXT)`);
  const row = driver.prepare(`SELECT MAX(version) AS v FROM schema_version`).get();
  const v = row?.v;
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/** Uruchamia brakujące migracje po kolei. Zwraca listę zastosowanych wersji. */
export function migrate(driver: SqlDriver): number[] {
  const current = getSchemaVersion(driver);
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    driver.exec('BEGIN');
    try {
      driver.exec(m.up);
      driver.prepare(`INSERT INTO schema_version (version, applied_at, name) VALUES (?, ?, ?)`).run(m.version, Date.now(), m.name);
      driver.exec('COMMIT');
      applied.push(m.version);
      log.info(`Migracja bazy #${m.version} (${m.name}) zastosowana`);
    } catch (e) {
      driver.exec('ROLLBACK');
      throw new Error(`Migracja #${m.version} (${m.name}) nie powiodła się: ${(e as Error).message}`);
    }
  }
  return applied;
}

/* ------------------------------------------------------------------ */
/* Singleton                                                           */
/* ------------------------------------------------------------------ */

let instance: SqlDriver | null = null;

export function initDb(file: string): SqlDriver {
  if (instance) return instance;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const driver = openDriver(file);
  migrate(driver);
  instance = driver;
  log.info(`Baza danych gotowa (${driver.kind}), schemat v${getSchemaVersion(driver)}`);
  return driver;
}

export function db(): SqlDriver {
  if (!instance) throw new Error('Baza danych nie została zainicjalizowana');
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/* ------------------------------------------------------------------ */
/* Pomocnicze: cache trwały                                            */
/* ------------------------------------------------------------------ */

export function cacheGet<T>(key: string): T | undefined {
  const row = db().prepare(`SELECT value, expires_at FROM cache WHERE key = ?`).get(key);
  if (!row) return undefined;
  if (Number(row.expires_at) < Date.now()) {
    db().prepare(`DELETE FROM cache WHERE key = ?`).run(key);
    return undefined;
  }
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return undefined;
  }
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  db()
    .prepare(`INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`)
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}
