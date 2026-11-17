// The sign-in gate behind src/proxy.ts, for a copy of the app that other people reach over a network. It is off unless
// RAAGENTS_ADMIN_PASSWORD or RAAGENTS_OIDC_ISSUER is set (or RAAGENTS_REQUIRE_SIGN_IN, which the container image sets so
// that a hosted copy can never start open), so a copy run on one computer behaves exactly as before.
//
// Two ways to sign in, never both: with a password (RAAGENTS_ADMIN_PASSWORD), or with the company account through an
// OpenID Connect provider (RAAGENTS_OIDC_ISSUER), where the provider proves who someone is and there is no password way in
// at all. Either way each person signs in to their own account (src/server/accounts): the admin named in the server
// settings, and the people the admin added on the People page. Pages without a session show the login page, API calls get 401,
// a person who must still replace a one-time password reaches only the password page, and the admin paths are for the
// admin. The health check, the login page, sign-in and sign-out stay open. Decisions are still stamped "person (local,
// not authenticated)": names on decisions come in a later step.
//
// Pure: the session comes from a lookup the caller passes in (the proxy reads it from the database), so tests need no
// server. No import of server-only, Next or a Node module: the module has to load in any runtime.

import { SESSION_TTL_MS, checkEmail, checkUsername, normalizeEmail, normalizeUsername, type SessionView } from '@/shared/accounts';

export type AccessEnv = Readonly<Record<string, string | undefined>>;

/** Company sign-in: the provider, this app's registration with it, and what the login page and the claims look like. */
export interface OidcSetting {
  /** The provider's issuer identifier (https), where its discovery document is found. */
  issuer: string;
  clientId: string;
  /** This app's callback, exactly as registered with the provider. */
  redirectUri: string;
  /** Space-separated, always with "openid". */
  scopes: string;
  /** The ID token claim that holds the person's e-mail address. */
  emailClaim: string;
  /** The words on the login page's button. */
  label: string;
}

export type AccessSetting =
  | { state: 'off' }
  | { state: 'misconfigured'; reason: string }
  | { state: 'on'; method: 'password'; admin: { username: string; password: string }; trustedProxyHops: 0 | 1 }
  | { state: 'on'; method: 'oidc'; admin: { username: string; email: string }; oidc: OidcSetting; trustedProxyHops: 0 | 1 };

export interface AccessInput {
  method: string;
  /** The path only, as in URL.pathname. */
  pathname: string;
  /** The query string with its "?", or "" (URL.search). */
  search: string;
}

export type AccessDenial = 'sign_in_required' | 'password_change_required' | 'admin_only';

export type AccessDecision =
  | { kind: 'allow' }
  /** Show the login page (path and query) in place of the page asked for. */
  | { kind: 'login'; path: string }
  /** Show the password page: the person must replace a one-time password first. */
  | { kind: 'change-password'; path: string }
  | { kind: 'deny'; status: 401 | 403; error: AccessDenial };

/** The words for each refusal. The API's error table uses the same ones. */
export const ACCESS_DENIAL_MESSAGES: Record<AccessDenial, string> = {
  sign_in_required: 'Sign in first.',
  password_change_required: 'Choose your own password first, on the password page.',
  admin_only: 'Only the admin can do this.',
};

/** "__Host-": the browser accepts it only from this exact host, over HTTPS, so a sibling host cannot plant or overwrite it. */
export const SESSION_COOKIE = '__Host-raagents_session';
export const MIN_ADMIN_PASSWORD_CHARS = 16;
const DEFAULT_ADMIN_USERNAME = 'admin';
/** The settings of the shared-password version this replaced. Set alone, they lock the app rather than leave it open. */
const RETIRED_SETTINGS = ['RAAGENTS_ACCESS_PASSWORD', 'RAAGENTS_SESSION_SECRET'] as const;

/** The path of the company sign-in callback; RAAGENTS_OIDC_REDIRECT_URI must end in exactly this. */
export const COMPANY_SIGN_IN_CALLBACK_PATH = '/api/auth/callback';
const DEFAULT_OIDC_SCOPES = 'openid email profile';
const DEFAULT_OIDC_EMAIL_CLAIM = 'email';
const DEFAULT_OIDC_LABEL = 'Sign in with your company account';
const MAX_OIDC_LABEL_CHARS = 60;
/** Settings that only make sense with company sign-in: set without an issuer, they lock the app rather than leave it open. */
const COMPANY_ONLY_SETTINGS = [
  'RAAGENTS_OIDC_CLIENT_ID',
  'RAAGENTS_OIDC_REDIRECT_URI',
  'RAAGENTS_OIDC_SCOPES',
  'RAAGENTS_OIDC_EMAIL_CLAIM',
  'RAAGENTS_OIDC_LABEL',
  'RAAGENTS_ADMIN_EMAIL',
] as const;

const isFilled = (value: string | undefined) => (value ?? '').trim() !== '';
const misconfigured = (reason: string): AccessSetting => ({ state: 'misconfigured', reason });

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The admin username and the proxy setting, which both ways of signing in read the same way. */
function readCommon(env: AccessEnv): { ok: true; username: string; trustedProxyHops: 0 | 1 } | { ok: false; reason: string } {
  const username = normalizeUsername(env.RAAGENTS_ADMIN_USERNAME ?? '') || DEFAULT_ADMIN_USERNAME;
  const usernameCheck = checkUsername(username);
  if (!usernameCheck.ok) return { ok: false, reason: `RAAGENTS_ADMIN_USERNAME is not a valid username. ${usernameCheck.message}` };
  const hops = (env.RAAGENTS_TRUSTED_PROXY_HOPS ?? '').trim();
  if (hops !== '' && hops !== '0' && hops !== '1') return { ok: false, reason: 'RAAGENTS_TRUSTED_PROXY_HOPS must be 0 or 1.' };
  return { ok: true, username, trustedProxyHops: hops === '1' ? 1 : 0 };
}

/** The provider settings, checked; the first problem found is the reason. */
function readOidc(env: AccessEnv, issuer: string): { ok: true; oidc: OidcSetting } | { ok: false; reason: string } {
  if (parseUrl(issuer)?.protocol !== 'https:') return { ok: false, reason: "RAAGENTS_OIDC_ISSUER must be the provider's https web address." };
  const clientId = (env.RAAGENTS_OIDC_CLIENT_ID ?? '').trim();
  if (!/^[\x21-\x7e]{1,200}$/.test(clientId)) {
    return { ok: false, reason: 'RAAGENTS_OIDC_CLIENT_ID is required with company sign-in: the client id the provider gave this app, with no spaces.' };
  }
  const redirectUri = (env.RAAGENTS_OIDC_REDIRECT_URI ?? '').trim();
  const redirect = parseUrl(redirectUri);
  const local = redirect !== null && redirect.protocol === 'http:' && (redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1');
  if (
    redirect === null ||
    !(redirect.protocol === 'https:' || local) ||
    redirect.pathname !== COMPANY_SIGN_IN_CALLBACK_PATH ||
    redirect.search !== '' ||
    redirect.hash !== '' ||
    redirect.username !== '' ||
    redirect.password !== ''
  ) {
    return {
      ok: false,
      reason: `RAAGENTS_OIDC_REDIRECT_URI must be https://<this app's address>${COMPANY_SIGN_IN_CALLBACK_PATH}, or http://localhost:<port>${COMPANY_SIGN_IN_CALLBACK_PATH} on one computer, exactly as registered with the provider.`,
    };
  }
  const scopeList = (env.RAAGENTS_OIDC_SCOPES ?? '').trim().split(/\s+/).filter((scope) => scope !== '');
  const scopes = scopeList.length === 0 ? DEFAULT_OIDC_SCOPES : scopeList.join(' ');
  if (!scopes.split(' ').includes('openid') || !scopes.split(' ').every((scope) => /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))) {
    return { ok: false, reason: 'RAAGENTS_OIDC_SCOPES must be scope names separated by spaces, including "openid".' };
  }
  const emailClaim = (env.RAAGENTS_OIDC_EMAIL_CLAIM ?? '').trim() || DEFAULT_OIDC_EMAIL_CLAIM;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(emailClaim)) {
    return { ok: false, reason: 'RAAGENTS_OIDC_EMAIL_CLAIM must be the plain name of the claim that holds the e-mail address, such as "email".' };
  }
  const label = (env.RAAGENTS_OIDC_LABEL ?? '').trim() || DEFAULT_OIDC_LABEL;
  if ([...label].length > MAX_OIDC_LABEL_CHARS || /[\u0000-\u001f\u007f]/.test(label)) {
    return { ok: false, reason: `RAAGENTS_OIDC_LABEL must be one line of at most ${MAX_OIDC_LABEL_CHARS} characters.` };
  }
  return { ok: true, oidc: { issuer, clientId, redirectUri, scopes, emailClaim, label } };
}

function readCompanySignIn(env: AccessEnv, issuer: string): AccessSetting {
  if (isFilled(env.RAAGENTS_ADMIN_PASSWORD)) {
    return misconfigured(
      'company sign-in is on (RAAGENTS_OIDC_ISSUER), so there is no password way in: remove RAAGENTS_ADMIN_PASSWORD from the settings.',
    );
  }
  const provider = readOidc(env, issuer);
  if (!provider.ok) return misconfigured(provider.reason);
  const email = normalizeEmail(env.RAAGENTS_ADMIN_EMAIL ?? '');
  if (email === '') return misconfigured('RAAGENTS_ADMIN_EMAIL is required with company sign-in: the company e-mail address of the admin.');
  const emailCheck = checkEmail(email);
  if (!emailCheck.ok) return misconfigured(`RAAGENTS_ADMIN_EMAIL is not a valid e-mail address. ${emailCheck.message}`);
  const common = readCommon(env);
  if (!common.ok) return misconfigured(common.reason);
  return { state: 'on', method: 'oidc', admin: { username: common.username, email }, oidc: provider.oidc, trustedProxyHops: common.trustedProxyHops };
}

export function readAccessSetting(env: AccessEnv): AccessSetting {
  // Trimmed: secret stores often end a value with a newline.
  const issuer = (env.RAAGENTS_OIDC_ISSUER ?? '').trim();
  if (issuer !== '') return readCompanySignIn(env, issuer);
  const leftover = COMPANY_ONLY_SETTINGS.find((name) => isFilled(env[name]));
  if (leftover !== undefined) {
    return misconfigured(`${leftover} is set, but RAAGENTS_OIDC_ISSUER is not: company sign-in needs the provider's address.`);
  }
  const password = (env.RAAGENTS_ADMIN_PASSWORD ?? '').trim();
  if (password === '') {
    const required = (env.RAAGENTS_REQUIRE_SIGN_IN ?? '').trim();
    if (required !== '' && required !== '0') {
      return misconfigured('sign-in is required here (RAAGENTS_REQUIRE_SIGN_IN), but neither RAAGENTS_ADMIN_PASSWORD nor RAAGENTS_OIDC_ISSUER is set.');
    }
    if (RETIRED_SETTINGS.some((name) => isFilled(env[name]))) {
      return {
        state: 'misconfigured',
        reason: 'RAAGENTS_ACCESS_PASSWORD and RAAGENTS_SESSION_SECRET are no longer read; set RAAGENTS_ADMIN_PASSWORD instead.',
      };
    }
    return { state: 'off' };
  }
  if ([...password].length < MIN_ADMIN_PASSWORD_CHARS) {
    return misconfigured(`RAAGENTS_ADMIN_PASSWORD must have at least ${MIN_ADMIN_PASSWORD_CHARS} characters.`);
  }
  const common = readCommon(env);
  if (!common.ok) return misconfigured(common.reason);
  return { state: 'on', method: 'password', admin: { username: common.username, password }, trustedProxyHops: common.trustedProxyHops };
}

const isGetOrHead = (method: string) => method === 'GET' || method === 'HEAD';
const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/** Exactly these stay open, each for its own methods and spelling: the load balancer's check, and the way in and out. */
function isOpen(method: string, pathname: string): boolean {
  if (isGetOrHead(method)) return pathname === '/api/health' || pathname === '/login';
  if (method === 'POST') return pathname === '/api/login' || pathname === '/api/logout';
  return false;
}

/** What a person who must replace a one-time password may still do (sign-out is open anyway). */
function isPasswordChange(method: string, pathname: string): boolean {
  return (isGetOrHead(method) && pathname === '/account/password') || (method === 'POST' && pathname === '/api/account/password');
}

/**
 * The admin's pages and API. Matched on the decoded, lower-cased path, so an escaped or upper-case spelling of /admin
 * counts too; a path that cannot be decoded counts as one rather than slipping past.
 */
function isAdminPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return true;
  }
  return ['/admin', '/api/admin'].some((root) => decoded === root || decoded.startsWith(`${root}/`));
}

/**
 * The session as sign-in counts it: the one rule every reader of the session cookie applies (the proxy here, the root
 * layout, the admin and password handlers, the health report). Nobody counts while sign-in is not on (off or
 * misconfigured), and a server-admin session under a name the settings no longer use is nobody: it belongs to an admin
 * the settings replaced, whose row the start hook may not have retired yet.
 */
export function countedSession(setting: AccessSetting, session: SessionView | null): SessionView | null {
  if (setting.state !== 'on' || session === null) return null;
  if (session.managedBy === 'server' && session.username !== setting.admin.username) return null;
  return session;
}

const deny = (status: 401 | 403, error: AccessDenial): AccessDecision => ({ kind: 'deny', status, error });

/**
 * What the proxy does with one request. `lookup` returns the person behind the request's session cookie, or null; it is
 * called only when the answer matters, never for the open paths or with the gate off.
 */
export function decideAccess(input: AccessInput, setting: AccessSetting, lookup: () => SessionView | null): AccessDecision {
  if (setting.state === 'off') return { kind: 'allow' };
  const method = input.method.toUpperCase();
  const { pathname } = input;
  if (isOpen(method, pathname)) return { kind: 'allow' };

  const page = isGetOrHead(method) && !isApiPath(pathname);
  const here = encodeURIComponent(`${pathname}${input.search}`);
  const signIn = (): AccessDecision => (page ? { kind: 'login', path: `/login?next=${here}` } : deny(401, 'sign_in_required'));
  if (setting.state === 'misconfigured') return signIn();

  const session = countedSession(setting, lookup());
  if (session === null) return signIn();

  if (session.mustChangePassword) {
    if (isPasswordChange(method, pathname)) return { kind: 'allow' };
    return page ? { kind: 'change-password', path: `/account/password?next=${here}` } : deny(403, 'password_change_required');
  }
  if (session.role !== 'admin' && isAdminPath(pathname)) return deny(403, 'admin_only');
  return { kind: 'allow' };
}

const NEXT_BASE = 'http://next.invalid';

/**
 * Where to send a person after signing in: a path on this site, re-encoded so it fits in a Location header whatever was
 * typed, or "/". Anything that could leave the site, loop back to sign-in or name an API or build file falls back to "/".
 */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  let url: URL;
  try {
    url = new URL(value, NEXT_BASE);
  } catch {
    return '/';
  }
  if (url.origin !== NEXT_BASE) return '/';
  const path = `${url.pathname}${url.search}`;
  if (!/^[\x21-\x7e]+$/.test(path)) return '/';
  const p = url.pathname;
  const loops =
    p === '/login' ||
    p.startsWith('/login/') ||
    p === '/account/password' ||
    p.startsWith('/account/password/') ||
    isApiPath(p) ||
    p.startsWith('/_next/');
  return loops ? '/' : path;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;

/**
 * The client's address for the sign-in limits, or null. Behind exactly one trusted load balancer (hops = 1) it is the
 * right-most X-Forwarded-For entry, the one the balancer added; entries further left are whatever the client sent. With
 * no trusted proxy there is no address to trust, and the per-client limit is skipped rather than shared by everyone.
 */
export function clientAddress(forwardedFor: string | null, hops: 0 | 1): string | null {
  if (hops === 0 || forwardedFor === null) return null;
  const entries = forwardedFor.split(',');
  const last = entries[entries.length - 1].trim();
  if (IPV4.test(last)) return last;
  // An IPv6 address has at least two colons; "1.2.3.4:5678" (an address with a port) is not one.
  if ((last.match(/:/g) ?? []).length >= 2 && IPV6.test(last)) return last.toLowerCase();
  return null;
}

export interface AttemptBucket {
  key: string;
  /** Failed attempts allowed in the window. */
  limit: number;
}

export interface AttemptTicket {
  /** The attempt did not count (it succeeded, or the server was too busy to check it): take its counts back. Once. */
  refund(): void;
}

export interface AttemptThrottle {
  /**
   * Synchronous, before any await: if every bucket is under its limit, count one attempt in each and return a ticket;
   * otherwise count nothing and return null. Attempts made at the same moment therefore cannot all slip through.
   */
  reserve(buckets: readonly AttemptBucket[], nowMs: number): AttemptTicket | null;
  /** How many keys it holds. */
  size(): number;
}

/** Sliding-window counts of failed attempts per key, at most `maxKeys` keys (the least recently used go first). In memory. */
export function createAttemptThrottle(options: { windowMs: number; maxKeys: number }): AttemptThrottle {
  const attempts = new Map<string, number[]>();

  const recent = (key: string, nowMs: number): number[] =>
    (attempts.get(key) ?? []).filter((at) => at > nowMs - options.windowMs);

  return {
    reserve(buckets, nowMs) {
      if (buckets.some((bucket) => recent(bucket.key, nowMs).length >= bucket.limit)) return null;
      for (const bucket of buckets) {
        const list = recent(bucket.key, nowMs);
        attempts.delete(bucket.key);
        attempts.set(bucket.key, [...list, nowMs]);
      }
      while (attempts.size > options.maxKeys) {
        const oldest = attempts.keys().next().value;
        if (oldest === undefined) break;
        attempts.delete(oldest);
      }
      let refunded = false;
      return {
        refund() {
          // Once only: a second call would remove another attempt made in the same millisecond.
          if (refunded) return;
          refunded = true;
          for (const bucket of buckets) {
            const list = attempts.get(bucket.key);
            if (list === undefined) continue;
            const index = list.indexOf(nowMs);
            if (index >= 0) list.splice(index, 1);
            if (list.length === 0) attempts.delete(bucket.key);
          }
        },
      };
    },
    size: () => attempts.size,
  };
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

/** The Set-Cookie value for a new session. Secure always: TLS ends at the load balancer, so the server sees plain HTTP. */
export function sessionCookieHeader(token: string): string {
  if (!TOKEN_SHAPE.test(token)) throw new TypeError('a session token is base64url text');
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
