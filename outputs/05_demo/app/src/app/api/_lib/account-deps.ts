import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAttemptThrottle, readAccessSetting, type AccessSetting, type AttemptThrottle } from '@/server/access-gate';
import { newOneTimePassword, newSessionToken, type PasswordHasher } from '@/server/accounts/crypto';
import { getAccountStore, getPasswordHasher } from '@/server/accounts/runtime';
import type { AccountStore } from '@/server/accounts/store';

// What the account handlers need. Kept apart from ApiDeps (deps.ts), so the chat handlers and their test harness do not
// change. The route files pass accountDeps(); tests pass account-test-support.ts.

export interface AccountDeps {
  setting: () => AccessSetting;
  store: () => AccountStore;
  passwords: () => PasswordHasher;
  /** Failed sign-ins, per key (src/app/api/_lib/sign-in.ts). */
  signInThrottle: AttemptThrottle;
  /** Wrong current passwords on the password page, per account. */
  passwordThrottle: AttemptThrottle;
  newOneTimePassword: () => string;
  newSessionToken: () => string;
  now: () => Date;
  newId: () => string;
  log: Pick<Console, 'warn' | 'error'>;
}

const WINDOW_MS = 15 * 60 * 1000;
// One of each per route bundle, in memory: a restart clears them, which is fine with one server process. Keys are short
// hashes, so 50,000 of them take a few megabytes; that many keep a flood of made-up names from pushing a real one out.
const signInThrottle = createAttemptThrottle({ windowMs: WINDOW_MS, maxKeys: 50_000 });
const passwordThrottle = createAttemptThrottle({ windowMs: WINDOW_MS, maxKeys: 50_000 });

export function accountDeps(): AccountDeps {
  return {
    setting: () => readAccessSetting(process.env),
    store: getAccountStore,
    passwords: getPasswordHasher,
    signInThrottle,
    passwordThrottle,
    newOneTimePassword,
    newSessionToken,
    now: () => new Date(),
    newId: () => randomUUID(),
    log: console,
  };
}
