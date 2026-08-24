/**
 * Logowanie do konta Microsoft (Premium).
 *
 * Przepływ: OAuth 2.0 Authorization Code + PKCE w SYSTEMOWEJ przeglądarce,
 * pętla zwrotna na 127.0.0.1, następnie Xbox Live -> XSTS -> Minecraft Services.
 *
 * Gwarancje:
 *  - NightMC nigdy nie pokazuje własnego pola na hasło Microsoft,
 *  - NightMC nigdy nie widzi ani nie zapisuje hasła,
 *  - w aplikacji nie ma `client_secret` (klient publiczny),
 *  - tokeny trafiają wyłącznie do magazynu poświadczeń systemu (`secrets.ts`),
 *  - tokeny nigdy nie trafiają do SQLite, do JSON-a ani do logów.
 *
 * Dokumentacja przepływu:
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { shell } from 'electron';
import { ENDPOINTS } from '../shared/constants.js';
import { httpRequest, NetError } from './net.js';
import { log } from './logging.js';
import { deleteSecret, getSecret, SECRET_KEYS, setSecret } from './secrets.js';
import { stripDashes } from './offline.js';
import type { Account, GameSession } from '../shared/types.js';

/** Client ID z Microsoft Entra - wstrzykiwany przy budowaniu (patrz .env.example). */
export const MS_CLIENT_ID = process.env.NIGHTMC_MS_CLIENT_ID ?? '';

const SCOPES = 'XboxLive.signin offline_access';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function isAuthConfigured(): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(MS_CLIENT_ID) && MS_CLIENT_ID !== '00000000-0000-0000-0000-000000000000';
}

/* ------------------------------------------------------------------ */
/* PKCE                                                                */
/* ------------------------------------------------------------------ */

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkce(): PkcePair {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const u = new URL(ENDPOINTS.msAuthorize);
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('code_challenge', params.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', params.state);
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/* ------------------------------------------------------------------ */
/* Serwer pętli zwrotnej                                               */
/* ------------------------------------------------------------------ */

const RESULT_PAGE = (title: string, message: string) =>
  `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<title>NightMC</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#08080f;color:#e7e9f5;
font-family:Segoe UI,system-ui,sans-serif}
.card{max-width:440px;padding:40px;text-align:center;border-radius:20px;
background:rgba(24,24,44,.7);border:1px solid rgba(140,120,255,.25);
box-shadow:0 0 60px rgba(120,90,255,.18)}
h1{margin:0 0 12px;font-size:22px;color:#bfa8ff}p{margin:0;color:#9aa0be;line-height:1.6}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;

interface Loopback {
  port: number;
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
}

/**
 * Uruchamia jednorazowy serwer na 127.0.0.1 i ZWRACA numer portu od razu.
 * Dopiero znając port możemy zbudować redirect_uri i otworzyć przeglądarkę,
 * więc kolejność jest istotna: nasłuch -> URL -> przeglądarka -> oczekiwanie.
 */
async function startLoopback(state: string, timeoutMs = 5 * 60_000): Promise<Loopback> {
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  if (!port) {
    server.close();
    throw new AuthError('Nie udało się otworzyć portu lokalnego dla logowania.', 'LOOPBACK');
  }

  let settle: ((code: string) => void) | null = null;
  let reject: ((e: Error) => void) | null = null;
  let done = false;

  const promise = new Promise<string>((res, rej) => {
    settle = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    server.close();
    reject?.(new AuthError('Logowanie przekroczyło limit czasu (5 minut).', 'TIMEOUT'));
  }, timeoutMs);

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/' && url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }

    const html = (title: string, msg: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(RESULT_PAGE(title, msg));
    };

    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const gotState = url.searchParams.get('state');

    if (error) {
      const desc = url.searchParams.get('error_description') ?? error;
      html('Logowanie nieudane', 'Możesz zamknąć tę kartę i wrócić do NightMC.');
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject?.(new AuthError(`Microsoft odrzucił logowanie: ${desc}`, 'OAUTH_ERROR'));
      }
      return;
    }
    if (!code) {
      res.writeHead(400).end();
      return;
    }
    if (gotState !== state) {
      html('Błąd bezpieczeństwa', 'Parametr state się nie zgadza. Spróbuj ponownie.');
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject?.(new AuthError('Parametr "state" się nie zgadza - logowanie przerwane.', 'STATE_MISMATCH'));
      }
      return;
    }

    html('Zalogowano', 'Możesz zamknąć tę kartę i wrócić do NightMC.');
    if (!done) {
      done = true;
      clearTimeout(timer);
      settle?.(code);
    }
  });

  return {
    port,
    // Entra dla klientów publicznych akceptuje dowolny port na http://localhost.
    redirectUri: `http://localhost:${port}`,
    waitForCode: () => promise,
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Wymiana tokenów                                                     */
/* ------------------------------------------------------------------ */

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    timeoutMs: 30_000,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = j.error_description ?? j.error ?? msg;
    } catch {
      /* zostaje HTTP nnn */
    }
    throw new AuthError(`Microsoft odrzucił żądanie: ${msg}`, 'MS_TOKEN');
  }
  return JSON.parse(text) as T;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new NetError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, url);
  }
  return JSON.parse(text) as T;
}

/* ------------------------------------------------------------------ */
/* Łańcuch Xbox -> Minecraft                                           */
/* ------------------------------------------------------------------ */

interface XboxResponse {
  Token: string;
  DisplayClaims: { xui: { uhs: string; xid?: string }[] };
}

/** Krok 1: Microsoft access token -> token Xbox Live. */
export async function xboxLiveAuth(msAccessToken: string): Promise<{ token: string; uhs: string }> {
  const data = await postJson<XboxResponse>(ENDPOINTS.xboxAuth, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!data.Token || !uhs) throw new AuthError('Xbox Live nie zwrócił poprawnego tokenu.', 'XBL');
  return { token: data.Token, uhs };
}

/** Mapuje kody błędów XSTS na czytelne komunikaty. */
export function describeXstsError(xErr: string | number): { code: string; message: string; hint: string } {
  const code = String(xErr);
  switch (code) {
    case '2148916233':
      return {
        code: 'XSTS_NO_ACCOUNT',
        message: 'To konto Microsoft nie ma profilu Xbox.',
        hint: 'Załóż profil Xbox na https://www.xbox.com i spróbuj ponownie.',
      };
    case '2148916235':
      return {
        code: 'XSTS_COUNTRY',
        message: 'Xbox Live jest niedostępny w kraju przypisanym do tego konta.',
        hint: 'Zmień kraj konta Microsoft albo użyj profilu Offline / Non-Premium.',
      };
    case '2148916236':
    case '2148916237':
      return {
        code: 'XSTS_ADULT_VERIFICATION',
        message: 'Konto wymaga weryfikacji dorosłości.',
        hint: 'Dokończ weryfikację na stronie konta Microsoft.',
      };
    case '2148916238':
      return {
        code: 'XSTS_CHILD',
        message: 'To konto dziecięce nie jest przypisane do rodziny.',
        hint: 'Dodaj konto do rodziny Microsoft, aby móc korzystać z Xbox Live.',
      };
    default:
      return {
        code: `XSTS_${code}`,
        message: `Xbox Live odrzucił logowanie (kod ${code}).`,
        hint: 'Sprawdź stan konta Microsoft i spróbuj ponownie.',
      };
  }
}

/** Krok 2: token Xbox Live -> token XSTS dla Minecraft Services. */
export async function xstsAuth(xblToken: string): Promise<{ token: string; uhs: string }> {
  const res = await httpRequest(ENDPOINTS.xstsAuth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
    timeoutMs: 30_000,
  });
  const text = await res.text();
  if (res.status === 401) {
    let xErr: string | number = 'nieznany';
    try {
      xErr = JSON.parse(text).XErr ?? 'nieznany';
    } catch {
      /* pusto */
    }
    const d = describeXstsError(xErr);
    throw new AuthError(d.message, d.code, d.hint);
  }
  if (!res.ok) throw new AuthError(`XSTS zwrócił HTTP ${res.status}.`, 'XSTS');

  const data = JSON.parse(text) as XboxResponse;
  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  if (!data.Token || !uhs) throw new AuthError('XSTS nie zwrócił poprawnego tokenu.', 'XSTS');
  return { token: data.Token, uhs };
}

interface McLoginResponse {
  access_token: string;
  expires_in: number;
  username: string;
}

/** Krok 3: token XSTS -> token Minecraft Services. */
export async function minecraftLogin(uhs: string, xstsToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const data = await postJson<McLoginResponse>(ENDPOINTS.mcLogin, {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`,
  });
  if (!data.access_token) throw new AuthError('Minecraft Services nie zwrócił tokenu sesji.', 'MC_LOGIN');
  return { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000 };
}

/** Krok 4: sprawdzenie posiadania Minecraft Java Edition. */
export async function checkEntitlements(mcAccessToken: string): Promise<boolean> {
  const res = await httpRequest(ENDPOINTS.mcEntitlements, {
    headers: { Authorization: `Bearer ${mcAccessToken}`, Accept: 'application/json' },
    timeoutMs: 20_000,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { items?: { name: string }[] };
  const items = data.items ?? [];
  return items.some((i) => i.name === 'product_minecraft' || i.name === 'game_minecraft');
}

interface McProfile {
  id: string;
  name: string;
  skins?: { id: string; state: string; url: string; variant?: string }[];
}

/** Krok 5: profil (nazwa, UUID, skórka). */
export async function fetchProfile(mcAccessToken: string): Promise<McProfile> {
  const res = await httpRequest(ENDPOINTS.mcProfile, {
    headers: { Authorization: `Bearer ${mcAccessToken}`, Accept: 'application/json' },
    timeoutMs: 20_000,
  });
  if (res.status === 404) {
    throw new AuthError(
      'To konto Microsoft nie ma profilu Minecraft Java Edition.',
      'NO_JAVA_PROFILE',
      'Kup grę albo utwórz profil na minecraft.net, lub użyj profilu Offline / Non-Premium.',
    );
  }
  if (!res.ok) throw new AuthError(`Nie udało się pobrać profilu (HTTP ${res.status}).`, 'PROFILE');
  return (await res.json()) as McProfile;
}

/* ------------------------------------------------------------------ */
/* Pełny przepływ                                                      */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  account: Account;
  session: GameSession;
}

/** Zamienia zestaw tokenów Microsoft na konto NightMC i zapisuje sekrety. */
async function completeChain(ms: MsTokenResponse, existingId?: string): Promise<LoginResult> {
  const xbl = await xboxLiveAuth(ms.access_token);
  const xsts = await xstsAuth(xbl.token);
  const mc = await minecraftLogin(xsts.uhs, xsts.token);
  const owns = await checkEntitlements(mc.accessToken);
  const profile = await fetchProfile(mc.accessToken);

  const accountId = existingId ?? `ms-${profile.id.slice(0, 16)}`;
  const account: Account = {
    id: accountId,
    type: 'microsoft',
    username: profile.name,
    uuid: profile.id,
    ownsGame: owns,
    skinUrl: profile.skins?.find((s) => s.state === 'ACTIVE')?.url,
    active: false,
    addedAt: Date.now(),
    expiresAt: mc.expiresAt,
  };

  if (ms.refresh_token) await setSecret(SECRET_KEYS.msRefresh(accountId), ms.refresh_token);
  await setSecret(SECRET_KEYS.mcAccess(accountId), JSON.stringify({ token: mc.accessToken, expiresAt: mc.expiresAt }));

  log.info(`Zalogowano konto Microsoft: ${profile.name} (posiada Java Edition: ${owns ? 'tak' : 'nie'})`);

  return {
    account,
    session: {
      username: profile.name,
      uuid: stripDashes(profile.id),
      accessToken: mc.accessToken,
      userType: 'msa',
      xuid: xsts.uhs,
      clientId: MS_CLIENT_ID,
    },
  };
}

/** Interaktywne logowanie w systemowej przeglądarce. */
export async function loginMicrosoft(): Promise<LoginResult> {
  if (!isAuthConfigured()) {
    throw new AuthError(
      'Brak własnego Client ID Microsoft Entra.',
      'NO_CLIENT_ID',
      'Uzupełnij NIGHTMC_MS_CLIENT_ID w pliku .env i zbuduj launcher ponownie (instrukcja w README). ' +
        'Profile Offline / Non-Premium działają bez tej konfiguracji.',
    );
  }

  const pkce = createPkce();
  const state = crypto.randomBytes(16).toString('base64url');

  // 1. Nasłuch MUSI wystartować przed otwarciem przeglądarki.
  const loopback = await startLoopback(state);
  try {
    const authorizeUrl = buildAuthorizeUrl({
      clientId: MS_CLIENT_ID,
      redirectUri: loopback.redirectUri,
      challenge: pkce.challenge,
      state,
    });

    // 2. Logowanie odbywa się WYŁĄCZNIE na oficjalnej stronie Microsoft,
    //    w systemowej przeglądarce. NightMC nie widzi hasła.
    log.info('Otwieram stronę logowania Microsoft w systemowej przeglądarce');
    await openInBrowser(authorizeUrl);

    // 3. Czekamy na kod autoryzacyjny.
    const code = await loopback.waitForCode();

    // 4. Wymiana kodu na tokeny - z PKCE, bez client_secret.
    const ms = await postForm<MsTokenResponse>(ENDPOINTS.msToken, {
      client_id: MS_CLIENT_ID,
      scope: SCOPES,
      code,
      redirect_uri: loopback.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: pkce.verifier,
    });

    return await completeChain(ms);
  } finally {
    loopback.close();
  }
}

/** Odświeża sesję konta na podstawie zapisanego refresh tokenu. */
export async function refreshAccount(accountId: string): Promise<LoginResult> {
  const refresh = await getSecret(SECRET_KEYS.msRefresh(accountId));
  if (!refresh) {
    throw new AuthError('Sesja wygasła i nie ma zapisanego tokenu odświeżania.', 'NO_REFRESH', 'Zaloguj się ponownie.');
  }
  const ms = await postForm<MsTokenResponse>(ENDPOINTS.msToken, {
    client_id: MS_CLIENT_ID,
    scope: SCOPES,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  return completeChain(ms, accountId);
}

/** Zwraca ważną sesję gry: z pamięci podręcznej albo po odświeżeniu. */
export async function getValidSession(accountId: string): Promise<GameSession> {
  const cached = await getSecret(SECRET_KEYS.mcAccess(accountId));
  if (cached) {
    try {
      const { token, expiresAt } = JSON.parse(cached) as { token: string; expiresAt: number };
      // 5 minut marginesu.
      if (token && expiresAt - 5 * 60_000 > Date.now()) {
        const profile = await fetchProfile(token);
        return {
          username: profile.name,
          uuid: stripDashes(profile.id),
          accessToken: token,
          userType: 'msa',
          clientId: MS_CLIENT_ID,
        };
      }
    } catch {
      /* wygasła lub uszkodzona - odświeżamy */
    }
  }
  const refreshed = await refreshAccount(accountId);
  return refreshed.session;
}

/** Usuwa wszystkie sekrety konta - wywoływane przy wylogowaniu. */
export async function forgetAccount(accountId: string): Promise<void> {
  await deleteSecret(SECRET_KEYS.msRefresh(accountId));
  await deleteSecret(SECRET_KEYS.mcAccess(accountId));
  log.info(`Usunięto dane logowania konta ${accountId}`);
}

/** Otwiera stronę logowania Microsoft w SYSTEMOWEJ przeglądarce. */
export async function openInBrowser(url: string): Promise<void> {
  await shell.openExternal(url);
}
