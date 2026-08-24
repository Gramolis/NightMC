/**
 * Profile Offline / Non-Premium.
 *
 * Profil offline to PEŁNOPRAWNY profil NightMC: może pobierać wersje z manifestu
 * Mojang, instalować Fabric/Forge/NeoForge, pobierać mody z Modrinth, importować
 * paczki, grać w singleplayer, przez LAN i na serwerach z online-mode=false.
 *
 * Czego profil offline NIE ROBI i robić nie będzie:
 *  - nie tworzy fałszywej sesji premium,
 *  - nie przekazuje spreparowanego tokenu Microsoft,
 *  - nie podszywa się pod UUID konta premium,
 *  - nie obchodzi odrzucenia przez serwer z online-mode=true.
 */

import crypto from 'node:crypto';
import { USERNAME_PATTERN } from '../shared/ipc.js';
import type { Account, GameSession } from '../shared/types.js';

/**
 * Stabilny UUID offline zgodny z konwencją Minecrafta.
 *
 * Odpowiednik `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))`
 * z Javy: UUID wersji 3 (MD5) z wariantem IETF. Ten sam nick zawsze daje ten sam
 * UUID - dzięki temu świat, inwentarz i uprawnienia na serwerze offline przetrwają
 * usunięcie i ponowne dodanie profilu.
 */
export function offlineUuid(username: string): string {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  md5[6] = (md5[6]! & 0x0f) | 0x30; // wersja 3
  md5[8] = (md5[8]! & 0x3f) | 0x80; // wariant IETF
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID bez myślników - w tej postaci trafia do argumentów gry. */
export function stripDashes(uuid: string): string {
  return uuid.replace(/-/g, '');
}

export class InvalidUsernameError extends Error {}

/** Waliduje nazwę gracza wg reguł Minecrafta (3-16 znaków, [A-Za-z0-9_]). */
export function validateUsername(username: string): string {
  const name = username.trim();
  if (!USERNAME_PATTERN.test(name)) {
    throw new InvalidUsernameError(
      'Nazwa gracza musi mieć 3-16 znaków i zawierać wyłącznie litery, cyfry oraz podkreślenie.',
    );
  }
  return name;
}

/** Tworzy profil offline. */
export function createOfflineAccount(username: string, opts: { skinPath?: string; avatar?: string } = {}): Account {
  const name = validateUsername(username);
  const uuid = offlineUuid(name);
  return {
    id: `off-${stripDashes(uuid).slice(0, 16)}`,
    type: 'offline',
    username: name,
    uuid,
    skinUrl: opts.skinPath,
    avatar: opts.avatar,
    active: false,
    addedAt: Date.now(),
  };
}

/**
 * Buduje sesję gry dla profilu offline.
 *
 * `accessToken` ma wartość "0" - taką samą, jakiej używa sam Minecraft dla sesji
 * bez uwierzytelnienia. To NIE jest podrobiony token: serwer z online-mode=true
 * odrzuci takie połączenie i tak ma być.
 *
 * `userType` = "legacy" dla starszych wersji i "msa" dla nowszych nie ma znaczenia
 * dla serwera offline, ale musi być obecne, bo argumenty gry go wymagają.
 */
export function offlineSession(account: Account): GameSession {
  if (account.type !== 'offline') throw new Error('offlineSession wymaga profilu offline');
  return {
    username: account.username,
    uuid: stripDashes(account.uuid),
    accessToken: '0',
    userType: 'legacy',
  };
}

/** Etykieta wyświetlana przy profilu. Nigdy nie udajemy konta zweryfikowanego. */
export function accountBadge(account: Account): string {
  if (account.type === 'offline') return 'OFFLINE / NON-PREMIUM';
  return account.ownsGame ? 'MICROSOFT PREMIUM' : 'MICROSOFT (brak Java Edition)';
}
