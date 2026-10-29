import 'server-only';
import { createHash } from 'node:crypto';
import {
  CLEAR_SESSION_COOKIE,
  clientAddress,
  safeNextPath,
  sessionCookieHeader,
  type AttemptBucket,
} from '@/server/access-gate';
import { HashingBusyError, secretEquals } from '@/server/accounts/crypto';
import { isSessionToken, tokenHash } from '@/server/accounts/session-lookup';
import { SESSION_TTL_MS, canonicalOneTimePassword, checkUsername, normalizeUsername } from '@/shared/accounts';
import type { AccountDeps } from './account-deps';
import { htmlPage, isSameOriginRequest, plainText, readFormBody, seeOther, sessionTokenFrom } from './account-http';
import { LOGIN_MESSAGES, loginPage } from './account-pages';

// Sign-in and sign-out for a hosted copy (src/server/access-gate.ts). The login page posts a plain HTML form; every
// answer is a 303 back to a page.
//
// Failed attempts are counted before any password is checked, and only failures count: per name (10 in 15 minutes) and,
// behind one trusted load balancer (RAAGENTS_TRUSTED_PROXY_HOPS=1), per machine and name (5) and per machine (50). The
// admin from the server settings has no per-name budget: its default name "admin" would otherwise let anyone lock the
// owner out. Without a trusted proxy only the hashing limit slows guesses at that name, so its password must be long and
// random (the setup tool makes 24 characters). There is no global ceiling: a script could otherwise lock everyone out.
// Successful sign-ins are limited too (20 per account in 15 minutes): every session is a row the database keeps for good.

export const SIGN_IN_LIMITS = { pair: 5, account: 10, client: 50, sessions: 20 } as const;
/** Longer than any username can be: such a name is not looked up, and is checked against the dummy hash. */
const MAX_LOOKUP_CHARS = 64;

/** A name's throttle key: a hash, so a long name typed into the form takes no more memory than a short one. */
function nameKey(username: string): string {
  return createHash('sha256').update(username, 'utf8').digest('hex').slice(0, 32);
}

const refusals = new WeakMap<object, { count: number; notedAt: number }>();

/** Notes refused sign-ins in the log at most once a minute, as a count: a stream of refusals must not flood the log. */
function noteRefusal(log: AccountDeps['log'], nowMs: number): void {
  const state = refusals.get(log) ?? { count: 0, notedAt: Number.NEGATIVE_INFINITY };
  state.count += 1;
  if (nowMs - state.notedAt >= 60_000) {
    // Counts only, never the typed name: people type passwords into the name field.
    log.warn(`[accounts] ${state.count} sign-in(s) refused for too many failed attempts since the last note`);
    state.count = 0;
    state.notedAt = nowMs;
  }
  refusals.set(log, state);
}

function backToLogin(error: string, next: string): Response {
  const query = new URLSearchParams({ error });
  if (next !== '/') query.set('next', next);
  return seeOther(`/login?${query.toString()}`);
}

export async function postLogin(request: Request, deps: AccountDeps): Promise<Response> {
  const setting = deps.setting();
  if (setting.state === 'off') return plainText(404, 'Not found.');
  if (!isSameOriginRequest(request)) return plainText(403, 'Forbidden: sign in from this site.');
  const fields = await readFormBody(request);
  if (fields === null) return plainText(413, 'The request body is too large.');
  const next = safeNextPath(fields.get('next'));
  if (setting.state === 'misconfigured') return backToLogin('setup', next);

  const username = normalizeUsername(fields.get('username') ?? '');
  const password = fields.get('password') ?? '';
  const store = deps.store();
  const passwords = deps.passwords();
  const now = deps.now();
  // Looked up before anything is counted: a database error here is a server error, never a failed attempt.
  const account = username.length <= MAX_LOOKUP_CHARS && checkUsername(username).ok ? store.findAccountForSignIn(username) : null;
  const isServerAdmin = account !== null && account.managedBy === 'server' && username === setting.admin.username;

  const key = nameKey(username);
  const client = clientAddress(request.headers.get('x-forwarded-for'), setting.trustedProxyHops);
  const buckets: AttemptBucket[] = [];
  if (client !== null) {
    buckets.push({ key: `pair:${client}|${key}`, limit: SIGN_IN_LIMITS.pair });
    buckets.push({ key: `client:${client}`, limit: SIGN_IN_LIMITS.client });
  }
  if (!isServerAdmin) buckets.push({ key: `account:${key}`, limit: SIGN_IN_LIMITS.account });
  const ticket = deps.signInThrottle.reserve(buckets, now.getTime());
  if (ticket === null) {
    noteRefusal(deps.log, now.getTime());
    return backToLogin('locked', next);
  }

  let matches = false;
  try {
    if (account === null) {
      // As long as a real check, so the time taken does not tell which names exist.
      await passwords.verify(password, passwords.dummy);
    } else if (account.managedBy === 'server') {
      // The live setting must match too, so a changed admin password works (and the old one stops) at once.
      const hashMatches = await passwords.verify(password, account.passwordHash);
      matches = hashMatches && isServerAdmin && secretEquals(password, setting.admin.password);
    } else {
      matches = await passwords.verify(account.mustChangePassword ? canonicalOneTimePassword(password) : password, account.passwordHash);
    }
  } catch (error) {
    // Busy, or a stored hash that cannot be checked: no password was judged, so nothing counts.
    ticket.refund();
    if (error instanceof HashingBusyError) return backToLogin('busy', next);
    throw error;
  }
  if (!matches || account === null || account.disabledAt !== null) return backToLogin('wrong', next);

  ticket.refund();
  if (account.mustChangePassword && (account.oneTimeExpiresAt ?? '') <= now.toISOString()) return backToLogin('expired', next);
  const opened = deps.signInThrottle.reserve([{ key: `opened:${account.id}`, limit: SIGN_IN_LIMITS.sessions }], now.getTime());
  if (opened === null) return backToLogin('many', next);
  const token = deps.newSessionToken();
  try {
    store.openSession({ accountId: account.id, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() });
  } catch (error) {
    opened.refund();
    // Disabled while the password was being checked: the database refused the session. The same answer as any refusal.
    if (store.findAccountForSignIn(username)?.disabledAt) return backToLogin('wrong', next);
    throw error;
  }
  const destination = !account.mustChangePassword
    ? next
    : next === '/'
      ? '/account/password'
      : `/account/password?next=${encodeURIComponent(next)}`;
  return seeOther(destination, sessionCookieHeader(token));
}

/** Ends this browser's session in the database and clears its cookie; the cookie is cleared even if the database fails. */
export async function postLogout(request: Request, deps: AccountDeps): Promise<Response> {
  if (deps.setting().state === 'off') return plainText(404, 'Not found.');
  if (!isSameOriginRequest(request)) return plainText(403, 'Forbidden: sign out from this site.');
  const token = sessionTokenFrom(request);
  if (token !== null && isSessionToken(token)) {
    try {
      deps.store().closeSession(tokenHash(token));
    } catch (error) {
      deps.log.error(`[accounts] could not record a sign-out: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return seeOther('/login', CLEAR_SESSION_COOKIE);
}

export function getLoginPage(request: Request, deps: AccountDeps): Response {
  const setting = deps.setting();
  if (setting.state === 'off') return new Response(null, { status: 307, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  const url = new URL(request.url);
  const message = setting.state === 'misconfigured' ? (LOGIN_MESSAGES.get('setup') ?? '') : (LOGIN_MESSAGES.get(url.searchParams.get('error') ?? '') ?? '');
  return htmlPage(
    loginPage({
      notice: (process.env.RAAGENTS_HOSTED_NOTICE ?? '').trim(),
      message,
      next: safeNextPath(url.searchParams.get('next')),
    }),
  );
}
