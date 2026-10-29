// The access gate behind src/proxy.ts, for a copy of the app that other people reach over a
// network. It is off unless RAAGENTS_ACCESS_PASSWORD is set, so a copy run on one computer
// behaves exactly as before. When on, every request needs a session cookie, which the login
// route issues after the shared password; the health check, the login page, sign-in and
// sign-out stay open. A shared password tells the app that someone may come in, not who they
// are: decisions are still stamped "person (local, not authenticated)".
//
// Pure functions of the request, the environment and the clock, so tests need no server. The
// only crypto is the Web Crypto API, so the module loads in every runtime Next.js may use for
// the proxy. No import of server-only or Next.

export type AccessEnv = Readonly<Record<string, string | undefined>>;

export type AccessSetting =
  | { state: 'off' }
  | { state: 'misconfigured'; reason: string }
  | { state: 'on'; password: string; secret: string };

export interface AccessInput {
  method: string;
  /** The path only, as in URL.pathname. */
  pathname: string;
  /** The query string with its "?", or "" (URL.search). */
  search: string;
  /** The session cookie's value, or null when absent. */
  cookie: string | null;
}

export type AccessDecision =
  | { kind: 'allow' }
  /** Show the login page (path and query) in place of the page asked for. */
  | { kind: 'login'; path: string }
  | { kind: 'deny'; status: 401 };

export const ACCESS_COOKIE = 'raagents_access';
/** How long a sign-in lasts. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const TOKEN_VERSION = 'v1';

export function readAccessSetting(env: AccessEnv): AccessSetting {
  const password = env.RAAGENTS_ACCESS_PASSWORD ?? '';
  if (password.trim() === '') return { state: 'off' };
  const secret = env.RAAGENTS_SESSION_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      state: 'misconfigured',
      reason: `RAAGENTS_SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters when RAAGENTS_ACCESS_PASSWORD is set.`,
    };
  }
  return { state: 'on', password, secret };
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** A session token: "v1.<expiry ms>.<HMAC-SHA256 of the first two parts, base64url>". */
export async function createAccessToken(secret: string, nowMs: number): Promise<string> {
  const payload = `${TOKEN_VERSION}.${nowMs + SESSION_TTL_MS}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyAccessToken(token: string | null, secret: string, nowMs: number): Promise<boolean> {
  if (token === null) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !/^\d{1,16}$/.test(parts[1])) return false;
  if (Number(parts[1]) <= nowMs) return false;
  const signature = base64UrlDecode(parts[2]);
  if (signature === null) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(`${parts[0]}.${parts[1]}`));
}

/** Compares SHA-256 digests in constant time, so neither the length nor a prefix of the password leaks. */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  if (input === '') return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(input)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/**
 * Where to send someone after signing in. Only a path on this site; anything that could leave
 * it (scheme, "//host", backslashes) or come back to the login itself falls back to "/".
 */
export function safeNextPath(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  const path = value.split('?')[0];
  if (path === '/login' || path.startsWith('/api/') || path.startsWith('/_next/')) return '/';
  return value;
}

/** True for the few requests that must work without a session. */
function isOpen(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  if (pathname === '/api/health') return true;
  if (pathname === '/login') return verb === 'GET' || verb === 'HEAD';
  if (pathname === '/api/login' || pathname === '/api/logout') return verb === 'POST';
  return false;
}

export async function decideAccess(input: AccessInput, setting: AccessSetting, nowMs: number): Promise<AccessDecision> {
  if (setting.state === 'off') return { kind: 'allow' };
  if (isOpen(input.method, input.pathname)) return { kind: 'allow' };
  if (setting.state === 'on' && (await verifyAccessToken(input.cookie, setting.secret, nowMs))) return { kind: 'allow' };

  const verb = input.method.toUpperCase();
  if (input.pathname.startsWith('/api/') || (verb !== 'GET' && verb !== 'HEAD')) return { kind: 'deny', status: 401 };
  const next = safeNextPath(`${input.pathname}${input.search}`);
  return { kind: 'login', path: `/login?next=${encodeURIComponent(next)}` };
}

/**
 * A failure budget shared by everyone: once `limit` failed sign-ins fall inside `windowMs`,
 * further attempts are refused until the oldest ages out. It does not depend on a client
 * address, which a proxy in front of the app would hide or a client could make up.
 */
export function createLoginThrottle(options: { limit: number; windowMs: number }) {
  let failures: number[] = [];
  const prune = (nowMs: number) => {
    failures = failures.filter((at) => at > nowMs - options.windowMs);
  };
  return {
    allowed(nowMs: number): boolean {
      prune(nowMs);
      return failures.length < options.limit;
    },
    recordFailure(nowMs: number): void {
      prune(nowMs);
      failures.push(nowMs);
    },
  };
}
