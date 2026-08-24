import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  accountBadge,
  createOfflineAccount,
  InvalidUsernameError,
  offlineSession,
  offlineUuid,
  stripDashes,
  validateUsername,
} from '../src/main/offline.js';

describe('stabilny UUID profilu offline', () => {
  it('jest zgodny z konwencją Javy UUID.nameUUIDFromBytes("OfflinePlayer:" + nick)', () => {
    // Wartość odniesienia liczona niezależnie, wprost z definicji UUID v3.
    const reference = (name: string) => {
      const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
      md5[6] = (md5[6]! & 0x0f) | 0x30;
      md5[8] = (md5[8]! & 0x3f) | 0x80;
      const h = md5.toString('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    for (const nick of ['Notch', 'Nocny_Gracz', 'aleks', 'Steve']) {
      expect(offlineUuid(nick)).toBe(reference(nick));
    }
  });

  it('ma wersję 3 i wariant IETF', () => {
    const uuid = offlineUuid('Nocny_Gracz');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('ten sam nick zawsze daje ten sam UUID', () => {
    expect(offlineUuid('Nocny_Gracz')).toBe(offlineUuid('Nocny_Gracz'));
    expect(createOfflineAccount('Nocny_Gracz').uuid).toBe(createOfflineAccount('Nocny_Gracz').uuid);
  });

  it('różne nicki dają różne UUID, także przy różnej wielkości liter', () => {
    expect(offlineUuid('Gracz')).not.toBe(offlineUuid('gracz'));
    expect(offlineUuid('A')).not.toBe(offlineUuid('B'));
  });

  it('usuwa myślniki dla argumentów gry', () => {
    expect(stripDashes(offlineUuid('Steve'))).toHaveLength(32);
    expect(stripDashes(offlineUuid('Steve'))).not.toContain('-');
  });
});

describe('walidacja nazwy gracza', () => {
  it('akceptuje poprawne nicki', () => {
    expect(validateUsername('Steve')).toBe('Steve');
    expect(validateUsername('  Nocny_Gracz  ')).toBe('Nocny_Gracz');
    expect(validateUsername('abc')).toBe('abc');
    expect(validateUsername('a'.repeat(16))).toHaveLength(16);
  });

  it('odrzuca nicki niezgodne z regułami Minecrafta', () => {
    expect(() => validateUsername('ab')).toThrow(InvalidUsernameError);
    expect(() => validateUsername('a'.repeat(17))).toThrow(InvalidUsernameError);
    expect(() => validateUsername('zły-nick')).toThrow(InvalidUsernameError);
    expect(() => validateUsername('gracz z spacją')).toThrow(InvalidUsernameError);
    expect(() => validateUsername('gracz;rm -rf')).toThrow(InvalidUsernameError);
    expect(() => validateUsername('')).toThrow(InvalidUsernameError);
  });
});

describe('sesja profilu offline', () => {
  const account = createOfflineAccount('Nocny_Gracz');

  it('nie tworzy fałszywego tokenu premium', () => {
    const session = offlineSession(account);
    expect(session.accessToken).toBe('0');
    expect(session.accessToken.length).toBeLessThan(4);
    // Token nie może wyglądać jak prawdziwy JWT Minecraft Services.
    expect(session.accessToken.startsWith('eyJ')).toBe(false);
  });

  it('przekazuje lokalną nazwę i lokalny UUID', () => {
    const session = offlineSession(account);
    expect(session.username).toBe('Nocny_Gracz');
    expect(session.uuid).toBe(stripDashes(offlineUuid('Nocny_Gracz')));
    expect(session.userType).toBe('legacy');
  });

  it('nie pozwala zbudować sesji offline z konta Microsoft', () => {
    expect(() =>
      offlineSession({ ...account, type: 'microsoft', uuid: '069a79f444e94726a5befca90e38aaf5' }),
    ).toThrow();
  });

  it('profil jest wyraźnie oznaczony jako nie-premium', () => {
    expect(accountBadge(account)).toContain('OFFLINE');
    expect(accountBadge({ ...account, type: 'microsoft', ownsGame: true })).toBe('MICROSOFT PREMIUM');
    expect(accountBadge({ ...account, type: 'microsoft', ownsGame: false })).toContain('brak Java Edition');
  });

  it('UUID offline nie koliduje z UUID prawdziwego konta premium', () => {
    // UUID Notcha (konto premium) jest wersji 4 - konwencja offline zawsze daje wersję 3.
    const premium = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
    expect(offlineUuid('Notch')).not.toBe(premium);
    expect(offlineUuid('Notch')[14]).toBe('3');
  });
});
