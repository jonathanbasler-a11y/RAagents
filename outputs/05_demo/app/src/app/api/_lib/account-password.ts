import 'server-only';
import { CLEAR_SESSION_COOKIE, countedSession, safeNextPath, sessionCookieHeader, type AttemptTicket } from '@/server/access-gate';
import { HashingBusyError } from '@/server/accounts/crypto';
import { tokenHash } from '@/server/accounts/session-lookup';
import { PasswordChangedMeanwhileError, PersonNotFoundError } from '@/server/accounts/store';
import { SESSION_TTL_MS, canonicalOneTimePassword, checkNewPassword } from '@/shared/accounts';
import type { AccountDeps } from './account-deps';
import { htmlPage, isSameOriginRequest, plainText, readFormBody, seeOther, sessionTokenFrom } from './account-http';
import { PASSWORD_MESSAGES, passwordPage } from './account-pages';

// Choosing a password on a hosted copy: the first time, to replace the one-time password the admin handed over (the proxy
// lets such a session reach nothing else), and later whenever a person wants to. The admin from the server settings
// changes theirs in the settings, not here.
//
// The current password is checked first (5 wrong attempts per account and 15 minutes), then the new one against the
// rules; the hash is computed outside any transaction, and the store swaps the password, ends every session of the
// person and opens a fresh one for this browser in one step, refused if an admin reset the password in the meantime.
// Changes are limited too (5 per account in 15 minutes): like a sign-in, each opens a session the database keeps for good.

export const PASSWORD_ATTEMPT_LIMIT = 5;
export const PASSWORD_CHANGE_LIMIT = 5;

function backToPage(error: string, next: string): Response {
  const query = new URLSearchParams({ error });
  if (next !== '/') query.set('next', next);
  return seeOther(`/account/password?${query.toString()}`);
}

export function getPasswordPage(request: Request, deps: AccountDeps): Response {
  const setting = deps.setting();
  if (setting.state === 'off') return plainText(404, 'Not found.');
  const token = sessionTokenFrom(request);
  const session = countedSession(setting, token === null ? null : deps.store().findSession(token));
  if (session === null) return seeOther('/login');
  const url = new URL(request.url);
  return htmlPage(
    passwordPage({
      notice: (process.env.RAAGENTS_HOSTED_NOTICE ?? '').trim(),
      message: PASSWORD_MESSAGES.get(url.searchParams.get('error') ?? '') ?? '',
      next: safeNextPath(url.searchParams.get('next')),
      username: session.username,
      serverManaged: session.managedBy === 'server',
      mustChange: session.mustChangePassword,
    }),
  );
}

export async function postPassword(request: Request, deps: AccountDeps): Promise<Response> {
  const setting = deps.setting();
  if (setting.state === 'off') return plainText(404, 'Not found.');
  if (!isSameOriginRequest(request)) return plainText(403, 'Forbidden: change your password from this site.');
  const fields = await readFormBody(request);
  if (fields === null) return plainText(413, 'The request body is too large.');
  const next = safeNextPath(fields.get('next'));

  const store = deps.store();
  const token = sessionTokenFrom(request);
  const session = countedSession(setting, token === null ? null : store.findSession(token));
  if (session === null) return seeOther('/login');
  if (session.managedBy === 'server') return backToPage('server', next);
  const account = store.findAccountById(session.accountId);
  if (account === null || account.disabledAt !== null) return seeOther('/login');

  const now = deps.now();
  const ticket = deps.passwordThrottle.reserve([{ key: `password:${account.id}`, limit: PASSWORD_ATTEMPT_LIMIT }], now.getTime());
  if (ticket === null) return backToPage('locked', next);
  const current = fields.get('current') ?? '';
  const password = fields.get('password') ?? '';
  const passwords = deps.passwords();
  let changed: AttemptTicket | null = null;
  let newHash: string;
  try {
    const currentMatches = await passwords.verify(account.mustChangePassword ? canonicalOneTimePassword(current) : current, account.passwordHash);
    if (!currentMatches) return backToPage('wrong', next);
    ticket.refund();
    if (account.mustChangePassword && (account.oneTimeExpiresAt ?? '') <= now.toISOString()) return backToPage('expired', next);
    if (password !== (fields.get('repeat') ?? '')) return backToPage('mismatch', next);
    const check = checkNewPassword(password, { username: account.username, current: account.mustChangePassword ? undefined : current });
    if (!check.ok) return backToPage(check.rule, next);
    // Counted before the hash, and given back below whenever the change does not happen.
    changed = deps.passwordThrottle.reserve([{ key: `changed:${account.id}`, limit: PASSWORD_CHANGE_LIMIT }], now.getTime());
    if (changed === null) return backToPage('many', next);
    newHash = await passwords.hash(password);
  } catch (error) {
    changed?.refund();
    if (!(error instanceof HashingBusyError)) throw error;
    ticket.refund();
    return backToPage('busy', next);
  }

  const fresh = deps.newSessionToken();
  try {
    store.changeOwnPassword({
      accountId: account.id,
      expectedHash: account.passwordHash,
      newHash,
      newTokenHash: tokenHash(fresh),
      sessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
  } catch (error) {
    changed.refund();
    // An admin reset the password, or disabled the person, while this change was being checked.
    if (!(error instanceof PasswordChangedMeanwhileError) && !(error instanceof PersonNotFoundError)) throw error;
    return seeOther('/login?error=ended', CLEAR_SESSION_COOKIE);
  }
  return seeOther(next, sessionCookieHeader(fresh));
}
