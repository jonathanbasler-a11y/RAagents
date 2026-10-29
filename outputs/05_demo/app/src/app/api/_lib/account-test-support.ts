// Test-only harness for the account handlers: a real account store on an in-memory database, a cheap password hasher,
// fresh throttles and a settable clock. Not imported by app code.
import { createAttemptThrottle, type AccessSetting } from '@/server/access-gate';
import { createPasswordHasher } from '@/server/accounts/crypto';
import { createAccountStore, type AccountStore } from '@/server/accounts/store';
import { migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { ONE_TIME_PASSWORD_TTL_MS, canonicalOneTimePassword } from '@/shared/accounts';
import type { AccountDeps } from './account-deps';

export const ADMIN_PASSWORD = 'a-long-admin-password-1';
export const T0 = new Date('2026-10-29T10:00:00.000Z');
const CHEAP = { N: 2 ** 10, r: 8, p: 1 };

export interface AccountHarness {
  deps: AccountDeps;
  db: SqliteDatabase;
  store: AccountStore;
  /** Moves the clock forward. */
  advance(ms: number): void;
  /** Creates a member the way the People page does; returns their one-time password. */
  addMember(username: string): Promise<string>;
  /** Writes the admin from the server settings, as the start hook does. */
  addServerAdmin(): Promise<void>;
  cleanup(): void;
}

export function accountHarness(options: { setting?: AccessSetting; hops?: 0 | 1 } = {}): AccountHarness {
  const db = openDatabase(IN_MEMORY_DATABASE);
  migrateChatSchema(db);
  let clock = T0.getTime();
  let ids = 0;
  let tokens = 0;
  let oneTimes = 0;
  const now = () => new Date(clock);
  const store = createAccountStore(db, { now, newId: () => `acc-${++ids}` });
  const passwords = createPasswordHasher({ cost: CHEAP });
  const setting: AccessSetting = options.setting ?? {
    state: 'on',
    admin: { username: 'admin', password: ADMIN_PASSWORD },
    trustedProxyHops: options.hops ?? 0,
  };
  const deps: AccountDeps = {
    setting: () => setting,
    store: () => store,
    passwords: () => passwords,
    signInThrottle: createAttemptThrottle({ windowMs: 15 * 60 * 1000, maxKeys: 1000 }),
    passwordThrottle: createAttemptThrottle({ windowMs: 15 * 60 * 1000, maxKeys: 1000 }),
    newOneTimePassword: () => `k7qm-2xvd-9hpt-${String(++oneTimes).padStart(4, '2')}`,
    newSessionToken: () => String(++tokens).padStart(43, 'T'),
    now,
    newId: () => `corr-${++ids}`,
    log: { warn: () => {}, error: () => {} },
  };
  return {
    deps,
    db,
    store,
    advance(ms) {
      clock += ms;
    },
    async addMember(username) {
      const oneTime = deps.newOneTimePassword();
      store.createPersonAccount({
        username,
        passwordHash: await passwords.hash(canonicalOneTimePassword(oneTime)),
        oneTimeExpiresAt: new Date(clock + ONE_TIME_PASSWORD_TTL_MS).toISOString(),
        actor: 'admin',
      });
      return oneTime;
    },
    async addServerAdmin() {
      store.bootstrapServerAdmin({ username: 'admin', passwordHash: await passwords.hash(ADMIN_PASSWORD) });
    },
    cleanup() {
      if (db.isOpen) db.close();
    },
  };
}

/** A form POST as the login and password pages send it. */
export function formPost(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3200${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** The session token a response sets, or null. */
export function sessionTokenOf(response: Response): string | null {
  const match = /__Host-raagents_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '');
  return match === null || match[1] === '' ? null : match[1];
}

/** A request carrying a session cookie. */
export function withSession(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', `__Host-raagents_session=${token}`);
  return new Request(`http://localhost:3200${url}`, { ...init, headers });
}
