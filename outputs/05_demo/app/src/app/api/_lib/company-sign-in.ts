import 'server-only';
import { safeNextPath, sessionCookieHeader } from '@/server/access-gate';
import { OIDC_COOKIE, type OidcFailure } from '@/server/accounts/oidc';
import { tokenHash } from '@/server/accounts/session-lookup';
import { IdentityMismatchError } from '@/server/accounts/store';
import { SESSION_TTL_MS } from '@/shared/accounts';
import type { AccountDeps } from './account-deps';
import { cookieFrom, plainText, seeOther } from './account-http';
import { SIGN_IN_LIMITS } from './sign-in';

// Company sign-in's two routes (src/server/accounts/oidc.ts does the provider's part). The start sends the browser to
// the provider and keeps the sign-in in progress on the server; the browser holds only its id, in a __Host- cookie that
// lives 10 minutes. The callback takes that sign-in once, has the provider's answer checked, finds the person on the
// People page by e-mail, binds or checks their identity, and opens a session exactly as the password sign-in does. Every
// refusal goes back to the login page with a code; no session is opened and the sign-in cookie is cleared. The log gets
// codes only: never an e-mail, a name, a subject, a code or a token.

const SIGN_IN_COOKIE_MAX_AGE_SECONDS = 600;
const CLEAR_SIGN_IN_COOKIE = `${OIDC_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const TRANSACTION_ID = /^[A-Za-z0-9_-]{43}$/;

export type CompanySignInRefusal = Exclude<OidcFailure, 'expired'> | 'not_listed' | 'disabled' | 'identity_mismatch' | 'stale' | 'many';

function signInCookie(id: string): string {
  // SameSite=Lax, not Strict: the provider sends the browser back with a top-level GET from its own site.
  return `${OIDC_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SIGN_IN_COOKIE_MAX_AGE_SECONDS}`;
}

function backToLogin(error: string, next = '/'): Response {
  const query = new URLSearchParams({ error });
  if (next !== '/') query.set('next', next);
  return seeOther(`/login?${query.toString()}`, CLEAR_SIGN_IN_COOKIE);
}

const lastNoted = new WeakMap<object, number>();

/** A provider-side problem, at most once a minute: the code, nothing else. */
function noteProblem(log: AccountDeps['log'], code: string, nowMs: number): void {
  if (nowMs - (lastNoted.get(log) ?? Number.NEGATIVE_INFINITY) < 60_000) return;
  lastNoted.set(log, nowMs);
  log.warn(`[accounts] a company sign-in could not be completed: ${code}`);
}

export async function getCompanySignInStart(request: Request, deps: AccountDeps): Promise<Response> {
  const setting = deps.setting();
  if (setting.state === 'misconfigured') return seeOther('/login?error=setup');
  if (setting.state !== 'on' || setting.method !== 'oidc') return plainText(404, 'Not found.');
  const next = safeNextPath(new URL(request.url).searchParams.get('next'));
  const started = await deps.oidc.beginSignIn(setting.oidc, next);
  if (!started.ok) {
    noteProblem(deps.log, started.failure, deps.now().getTime());
    return backToLogin(started.failure, next);
  }
  deps.signInTransactions.put(started.transaction);
  return seeOther(started.url.href, signInCookie(started.transaction.id));
}

export async function getCompanySignInCallback(request: Request, deps: AccountDeps): Promise<Response> {
  const setting = deps.setting();
  if (setting.state === 'misconfigured') return seeOther('/login?error=setup', CLEAR_SIGN_IN_COOKIE);
  if (setting.state !== 'on' || setting.method !== 'oidc') return plainText(404, 'Not found.');
  const now = deps.now();
  const id = cookieFrom(request, OIDC_COOKIE);
  const transaction = id !== null && TRANSACTION_ID.test(id) ? deps.signInTransactions.take(id, now.getTime()) : null;
  if (transaction === null) return backToLogin('stale');
  const next = transaction.next;

  const result = await deps.oidc.completeSignIn(setting.oidc, new URL(request.url).searchParams, transaction);
  if (!result.ok) {
    if (result.failure !== 'denied') noteProblem(deps.log, result.failure, now.getTime());
    return backToLogin(result.failure, next);
  }
  const { identity } = result;
  const store = deps.store();
  const account = store.findIdentityAccount(identity.email);
  // The admin of earlier settings is nobody (as countedSession says): only the admin the settings name signs in as admin.
  if (account === null || (account.managedBy === 'server' && account.username !== setting.admin.username)) return backToLogin('not_listed', next);
  if (account.disabled) {
    store.noteIdentityRefusal({ accountId: account.accountId, reason: 'disabled' });
    return backToLogin('disabled', next);
  }
  try {
    store.bindIdentity({ accountId: account.accountId, issuer: identity.issuer, subject: identity.subject, displayName: identity.displayName });
  } catch (error) {
    if (!(error instanceof IdentityMismatchError)) throw error;
    store.noteIdentityRefusal({ accountId: account.accountId, reason: 'identity_mismatch' });
    return backToLogin('identity_mismatch', next);
  }

  const opened = deps.signInThrottle.reserve([{ key: `opened:${account.accountId}`, limit: SIGN_IN_LIMITS.sessions }], now.getTime());
  if (opened === null) return backToLogin('many', next);
  const sessionToken = deps.newSessionToken();
  try {
    store.openSession({ accountId: account.accountId, tokenHash: tokenHash(sessionToken), expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() });
  } catch (error) {
    opened.refund();
    // Disabled while the provider was being asked: the database refused the session. The same answer as any refusal.
    if (store.findIdentityAccount(identity.email)?.disabled) return backToLogin('disabled', next);
    throw error;
  }
  return seeOther(next, [sessionCookieHeader(sessionToken), CLEAR_SIGN_IN_COOKIE]);
}
