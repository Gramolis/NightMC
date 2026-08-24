import { describe, it, expect } from 'vitest';
import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  migrate,
  MIGRATIONS,
  openDriver,
} from '../src/main/db.js';

describe('migracje SQLite', () => {
  it('kolejne migracje mają rosnące, unikalne numery', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(LATEST_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
  });

  it('tworzy schemat od zera', () => {
    const db = openDriver(':memory:');
    expect(getSchemaVersion(db)).toBe(0);
    const applied = migrate(db);
    expect(applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('jest idempotentna - druga migracja nic nie robi', () => {
    const db = openDriver(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual([]);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });

  it('tworzy wszystkie wymagane tabele', () => {
    const db = openDriver(':memory:');
    migrate(db);
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    const names = rows.map((r: any) => String(r.name));
    for (const table of ['settings', 'instances', 'accounts', 'servers', 'launch_history', 'download_meta', 'cache', 'instance_mods', 'schema_version']) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('dodaje kolumny z późniejszych migracji', () => {
    const db = openDriver(':memory:');
    migrate(db);
    const cols = db.prepare(`PRAGMA table_info(instances)`).all().map((r: any) => String(r.name));
    expect(cols).toContain('dir_override');
    expect(cols).toContain('mod_count');
    expect(cols).toContain('last_verified_at');
    db.close();
  });

  it('wymusza dozwolone typy kont', () => {
    const db = openDriver(':memory:');
    migrate(db);
    db.prepare(`INSERT INTO accounts (id, type, username, uuid, active, added_at) VALUES (?,?,?,?,?,?)`)
      .run('a1', 'offline', 'Gracz', 'uuid-1', 0, Date.now());
    expect(() =>
      db.prepare(`INSERT INTO accounts (id, type, username, uuid, active, added_at) VALUES (?,?,?,?,?,?)`)
        .run('a2', 'premium-fałszywy', 'Gracz', 'uuid-2', 0, Date.now()),
    ).toThrow();
    db.close();
  });

  it('nie pozwala na dwa profile o tym samym typie i UUID', () => {
    const db = openDriver(':memory:');
    migrate(db);
    const insert = () =>
      db.prepare(`INSERT INTO accounts (id, type, username, uuid, active, added_at) VALUES (?,?,?,?,?,?)`)
        .run(`id-${Math.random()}`, 'offline', 'Gracz', 'ten-sam-uuid', 0, Date.now());
    insert();
    expect(insert).toThrow();
    db.close();
  });

  it('w schemacie nie ma żadnej kolumny na tokeny ani hasła', () => {
    const db = openDriver(':memory:');
    migrate(db);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r: any) => String(r.name));
    for (const table of tables) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => String(r.name).toLowerCase());
      for (const col of cols) {
        expect(col).not.toContain('token');
        expect(col).not.toContain('password');
        expect(col).not.toContain('secret');
      }
    }
    db.close();
  });
});
