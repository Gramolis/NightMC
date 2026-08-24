import { describe, it, expect, beforeEach } from 'vitest';
import { clearLogs, formatLogs, getLogs, pushLog, redact, redactDeep } from '../src/main/logging.js';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('redakcja danych poufnych', () => {
  it('usuwa tokeny JWT', () => {
    const out = redact(`Token sesji: ${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain('[TOKEN USUNIĘTY]');
  });

  it('usuwa refresh token Microsoft', () => {
    const out = redact('refresh: M.C507_BAY.0.U.-CkE9v2xyzabcdefghijklmnopqrstuvw');
    expect(out).toContain('[REFRESH TOKEN USUNIĘTY]');
    expect(out).not.toContain('CkE9v2xyzabcdefghijklmnopqrstuvw');
  });

  it('usuwa token z argumentów wiersza poleceń', () => {
    const out = redact(`java -cp x Main --username Gracz --accessToken ${JWT} --userType msa`);
    expect(out).not.toContain(JWT);
    expect(out).toContain('--username Gracz');
    expect(out).toContain('--userType msa');
  });

  it('usuwa pola JSON z tokenami', () => {
    const out = redact('{"access_token":"abc123","refresh_token":"def456","username":"Gracz"}');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('def456');
    expect(out).toContain('Gracz');
  });

  it('usuwa nagłówki autoryzacji i klucze API', () => {
    expect(redact('Authorization: Bearer abcdef')).toContain('[USUNIĘTY]');
    expect(redact('x-api-key: $2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234')).not.toContain('abcdefghij');
  });

  it('usuwa token XBL i kod autoryzacyjny z URL', () => {
    expect(redact('identityToken=XBL3.0 x=1234567;eyJhbGciOi')).toContain('[USUNIĘTY]');
    const url = redact('http://localhost:1234/?code=M.C1_BL2.2.U.abcdefgh&state=xyz');
    expect(url).not.toContain('abcdefgh');
    expect(url).toContain('[USUNIĘTY]');
  });

  it('usuwa podpis i token z tymczasowego URL GitHub Releases', () => {
    const out = redact('https://release-assets.githubusercontent.com/java.zip?sig=sekretny-podpis&jwt=sekretny-token');
    expect(out).not.toContain('sekretny-podpis');
    expect(out).not.toContain('sekretny-token');
  });

  it('nie rusza zwykłych komunikatów', () => {
    const msg = 'Pobrano 1234 plików do C:\\Users\\aleks\\AppData\\Roaming\\NightMC';
    expect(redact(msg)).toBe(msg);
  });

  it('redaguje struktury zagnieżdżone po nazwie pola', () => {
    const out = redactDeep({
      user: { name: 'Gracz', accessToken: JWT },
      nested: [{ api_key: 'sekret' }, 'zwykły tekst'],
    }) as any;
    expect(out.user.name).toBe('Gracz');
    expect(out.user.accessToken).toBe('[USUNIĘTY]');
    expect(out.nested[0].api_key).toBe('[USUNIĘTY]');
    expect(out.nested[1]).toBe('zwykły tekst');
  });
});

describe('bufor logów', () => {
  beforeEach(() => {
    clearLogs('test-inst');
    clearLogs();
  });

  it('redaguje przy zapisie, a nie dopiero przy odczycie', () => {
    pushLog('test-inst', 'info', 'game', `--accessToken ${JWT}`);
    const lines = getLogs('test-inst');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).not.toContain(JWT);
    expect(formatLogs(lines)).not.toContain(JWT);
  });

  it('trzyma logi rozdzielone per instancja', () => {
    pushLog('test-inst', 'info', 'game', 'linia A');
    pushLog(undefined, 'info', 'launcher', 'linia B');
    expect(getLogs('test-inst').map((l) => l.text)).toEqual(['linia A']);
    expect(getLogs().map((l) => l.text)).toEqual(['linia B']);
  });

  it('formatuje log w czytelnej postaci', () => {
    pushLog('test-inst', 'error', 'stderr', 'coś padło');
    const text = formatLogs(getLogs('test-inst'));
    expect(text).toContain('[ERROR]');
    expect(text).toContain('[stderr]');
    expect(text).toContain('coś padło');
  });
});
