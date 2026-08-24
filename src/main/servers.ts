/**
 * Lokalna lista serwerów.
 *
 * WAŻNE: `online-mode` serwera NIE DA SIĘ wiarygodnie odczytać zwykłym pingiem
 * statusu (Server List Ping nie zwraca tej informacji). NightMC tego nie udaje.
 * Użytkownik sam oznacza zaufany serwer jako działający z online-mode=false,
 * a launcher jedynie zapamiętuje tę deklarację i pokazuje ostrzeżenie.
 *
 * Profil offline, który spróbuje wejść na serwer z online-mode=true, zostanie
 * przez ten serwer odrzucony - i tak ma być. NightMC tego nie obchodzi.
 */

import net from 'node:net';
import crypto from 'node:crypto';
import { db } from './db.js';
import type { ServerEntry } from '../shared/types.js';

function rowToServer(r: any): ServerEntry {
  return {
    id: String(r.id),
    name: String(r.name),
    address: String(r.address),
    port: Number(r.port),
    icon: r.icon ?? undefined,
    description: r.description ?? undefined,
    mcVersion: r.mc_version ?? undefined,
    instanceId: r.instance_id ?? undefined,
    userMarkedOffline: Number(r.marked_offline) === 1,
    createdAt: Number(r.created_at),
  };
}

export function listServers(): ServerEntry[] {
  return db().prepare(`SELECT * FROM servers ORDER BY created_at DESC`).all().map(rowToServer);
}

export function getServer(id: string): ServerEntry {
  const row = db().prepare(`SELECT * FROM servers WHERE id = ?`).get(id);
  if (!row) throw new Error(`Serwer "${id}" nie istnieje`);
  return rowToServer(row);
}

export interface AddServerInput {
  name: string;
  address: string;
  port: number;
  description?: string;
  mcVersion?: string;
  instanceId?: string;
  userMarkedOffline: boolean;
}

/** Waliduje adres serwera - nazwa hosta albo adres IP, bez schematu i ścieżki. */
export function validateAddress(address: string): string {
  const value = address.trim().toLowerCase();
  if (!value) throw new Error('Adres serwera nie może być pusty');
  if (/[\s/\\@]/.test(value)) throw new Error('Adres serwera nie może zawierać spacji, ukośników ani znaku @');
  if (value.length > 253) throw new Error('Adres serwera jest za długi');
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  const isHost = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value);
  if (!isIpv4 && !isHost) throw new Error(`Nieprawidłowy adres serwera: ${address}`);
  if (isIpv4 && value.split('.').some((o) => Number(o) > 255)) throw new Error(`Nieprawidłowy adres IP: ${address}`);
  return value;
}

/** Rozdziela "host:port" na części. */
export function splitAddress(input: string): { address: string; port: number } {
  const trimmed = input.trim();
  const match = trimmed.match(/^(.+?):(\d{1,5})$/);
  if (match) {
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error(`Nieprawidłowy port: ${match[2]}`);
    return { address: validateAddress(match[1]!), port };
  }
  return { address: validateAddress(trimmed), port: 25565 };
}

export function addServer(input: AddServerInput): ServerEntry {
  const address = validateAddress(input.address);
  const id = `srv-${crypto.randomBytes(6).toString('hex')}`;
  db()
    .prepare(
      `INSERT INTO servers (id, name, address, port, description, mc_version, instance_id, marked_offline, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      address,
      input.port,
      input.description ?? null,
      input.mcVersion ?? null,
      input.instanceId ?? null,
      input.userMarkedOffline ? 1 : 0,
      Date.now(),
    );
  return getServer(id);
}

export function updateServer(id: string, patch: Partial<AddServerInput>): ServerEntry {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.address !== undefined) {
    sets.push('address = ?');
    params.push(validateAddress(patch.address));
  }
  if (patch.port !== undefined) {
    sets.push('port = ?');
    params.push(patch.port);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }
  if (patch.instanceId !== undefined) {
    sets.push('instance_id = ?');
    params.push(patch.instanceId);
  }
  if (patch.userMarkedOffline !== undefined) {
    sets.push('marked_offline = ?');
    params.push(patch.userMarkedOffline ? 1 : 0);
  }
  if (sets.length === 0) return getServer(id);
  params.push(id);
  db().prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getServer(id);
}

export function removeServer(id: string): void {
  db().prepare(`DELETE FROM servers WHERE id = ?`).run(id);
}

/* ------------------------------------------------------------------ */
/* Ping statusu                                                        */
/* ------------------------------------------------------------------ */

export interface ServerStatus {
  online: boolean;
  latencyMs?: number;
  /** Świadomie zawsze `undefined` - patrz nagłówek pliku. */
  onlineMode?: undefined;
  error?: string;
}

/**
 * Sprawdza wyłącznie OSIĄGALNOŚĆ serwera (otwarty port TCP).
 * Nie zwraca `online-mode`, bo protokół tego nie udostępnia.
 */
export function pingServer(address: string, port: number, timeoutMs = 4000): Promise<ServerStatus> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (status: ServerStatus) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ online: true, latencyMs: Date.now() - started }));
    socket.once('timeout', () => finish({ online: false, error: 'Przekroczono limit czasu połączenia' }));
    socket.once('error', (e) => finish({ online: false, error: e.message }));

    try {
      socket.connect(port, address);
    } catch (e) {
      finish({ online: false, error: (e as Error).message });
    }
  });
}
