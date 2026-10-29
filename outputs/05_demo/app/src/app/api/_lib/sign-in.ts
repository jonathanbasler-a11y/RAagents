import 'server-only';
import {
  CLEAR_SESSION_COOKIE,
  clientAddress,
  safeNextPath,
  sessionCookieHeader,
  type AttemptBucket,
} from '@/server/access-gate';
import { HashingBusyError, secretEquals } from '@/server/accounts/crypto';
import { isSessionToken, tokenHash } from '@/server/accounts/session-lookup';
import { SESSION_TTL_MS, canonicalOneTimePassword, normalizeUsername } from '@/shared/accounts';
import type { AccountDeps } from './account-deps';
import { htmlPage, isSameOriginRequest, plainText, readFormBody, seeOther, sessionTokenFrom } from './account-http';
import { LOGIN_MESSAGES, loginPage } from './account-pages';

// Sign-in and sign-out for a hosted copy (src/server/access-gate.ts). The login page posts a plain HTML form; every
// answer is a 303 back to a page.
//
// Failed attempts are counted before any password is checked, and only failures count. Per machine and name, per name,
// and per machine (the address the load balancer added, only behind one trusted proxy). The admin from the server
// settings has no per-name budget: its default name "admin" would otherwise let anyone lock the owner out, and its long
// random password cannot be guessed at the per-machine rate. There is no global ceiling: a script could otherwise lock
// everyone out. The password hasher's own limit keeps a flood from tying up the server.

export const SIGN_IN_LIMITS = { pair: 5, account: 10, client: 50 } as const;

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
  const isServerAdminName = username === setting.admin.username;
  const client = clientAddress(request.headers.get('x-forwarded-for'), setting.trustedProxyHops);
  const buckets: AttemptBucket[] = [];
  if (client !== null) {
    buckets.push({ key: `pair:${client}|${username}`, limit: SIGN_IN_LIMITS.pair });
    buckets.push({ key: `client:${client}`, limit: SIGN_IN_LIMITS.client });
  }
  if (!isServerAdminName) buckets.push({ key: `account:${username}`, limit: SIGN_IN_LIMITS.account });
  const now = deps.now();
  const ticket = deps.signInThrottle.reserve(buckets, now.getTime());
  if (ticket === null) {
    // Counts only, never the typed name: people type passwords into the name field.
    deps.log.warn('[accounts] a sign-in was refused: too many failed attempts');
    return backToLogin('locked', next);
  }

  const store = deps.store();
  const passwords = deps.passwords();
  const account = store.findAccountForSignIn(username);
  let matches = false;
  try {
    if (account === null) {
      // As long as a real check, so the time taken does not tell which names exist.
      await passwords.verify(password, passwords.dummy);
    } else if (account.managedBy === 'server') {
      // The live setting must match too, so a changed admin password works (and the old one stops) at once.
      const hashMatches = await passwords.verify(password, account.passwordHash);
      matches = hashMatches && isServerAdminName && secretEquals(password, setting.admin.password);
    } else {
      matches = await passwords.verify(account.mustChangePassword ? canonicalOneTimePassword(password) : password, account.passwordHash);
    }
  } catch (error) {
    if (!(error instanceof HashingBusyError)) throw error;
    ticket.refund();
    return backToLogin('busy', next);
  }
  if (!matches || account === null || account.disabledAt !== null) return backToLogin('wrong', next);

  ticket.refund();
  if (account.mustChangePassword && (account.oneTimeExpiresAt ?? '') <= now.toISOString()) return backToLogin('expired', next);
  const token = deps.newSessionToken();
  store.openSession({ accountId: account.id, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() });
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
