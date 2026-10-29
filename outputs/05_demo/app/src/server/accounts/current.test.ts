import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { openDatabase } from '@/server/db/sqlite';
import { currentAccount, layoutPlan } from './current';
import { closeAccountsDb, tokenHash } from './session-lookup';

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined, reads: 0 }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    cookie.reads += 1;
    return { get: (name: string) => (name === '__Host-raagents_session' && cookie.value !== undefined ? { name, value: cookie.value } : undefined) };
  },
}));

const TOKEN = 'M'.repeat(43);
const dirs: string[] = [];

afterEach(() => {
  closeAccountsDb();
  vi.unstubAllEnvs();
  cookie.value = undefined;
  cookie.reads = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function databaseWith(account: { username: string; role: string; managedBy: string; mustChange?: boolean }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'current-'));
  dirs.push(dir);
  const file = path.join(dir, 'chat.db');
  const db = openDatabase(file);
  migrateChatSchema(db);
  db.prepare(
    `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
     VALUES ('acc-1', ?, ?, ?, 'scrypt$x', ?, ?, NULL, '2026-10-29T08:00:00.000Z', 'server')`,
  ).run(account.username, account.role, account.managedBy, account.mustChange ? 1 : 0, account.mustChange ? '2999-01-01T00:00:00.000Z' : null);
  db.prepare(`INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, 'acc-1', '2026-10-29T08:00:00.000Z', '2999-01-01T00:00:00.000Z')`).run(tokenHash(TOKEN));
  db.close();
  vi.stubEnv('CHAT_DB_PATH', file);
  vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'a-long-admin-password-1');
}

describe('currentAccount', () => {
  it('reads no cookie when sign-in is off', async () => {
    expect(await currentAccount()).toEqual({ signIn: 'off' });
    expect(cookie.reads).toBe(0);
  });

  it('finds the person behind the session cookie', async () => {
    databaseWith({ username: 'member-one', role: 'member', managedBy: 'app' });
    cookie.value = TOKEN;
    expect(await currentAccount()).toMatchObject({ signIn: 'on', session: { username: 'member-one', role: 'member' } });
  });

  it('finds no one without a cookie, with an unknown one, or while the person must still choose a password', async () => {
    databaseWith({ username: 'member-one', role: 'member', managedBy: 'app', mustChange: true });
    expect(await currentAccount()).toEqual({ signIn: 'on', session: null });
    cookie.value = 'X'.repeat(43);
    expect(await currentAccount()).toEqual({ signIn: 'on', session: null });
    cookie.value = TOKEN;
    expect(await currentAccount()).toEqual({ signIn: 'on', session: null });
  });

  it('finds no one for a former admin from earlier settings', async () => {
    databaseWith({ username: 'old-admin', role: 'admin', managedBy: 'server' });
    cookie.value = TOKEN;
    expect(await currentAccount()).toEqual({ signIn: 'on', session: null });
  });
});

describe('layoutPlan', () => {
  const session = { accountId: 'a', username: 'member-one', role: 'member' as const, managedBy: 'app' as const, mustChangePassword: false, expiresAt: 'x' };

  it('keeps today\'s shell, with no account line, when sign-in is off', () => {
    expect(layoutPlan({ signIn: 'off' })).toEqual({ shell: true, account: undefined });
  });

  it('renders no shell and no roster for a request without a valid session', () => {
    expect(layoutPlan({ signIn: 'on', session: null })).toEqual({ shell: false });
  });

  it('names the person in the shell, with the People page for the admin and the password page for people created in the app', () => {
    expect(layoutPlan({ signIn: 'on', session })).toEqual({ shell: true, account: { username: 'member-one', isAdmin: false, canChangePassword: true } });
    expect(layoutPlan({ signIn: 'on', session: { ...session, username: 'admin', role: 'admin', managedBy: 'server' } })).toEqual({
      shell: true,
      account: { username: 'admin', isAdmin: true, canChangePassword: false },
    });
  });
});
