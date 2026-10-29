import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type { AccessSetting } from '@/server/access-gate';
import { createPasswordHasher } from './crypto';
import { prepareAccounts, prepareHostedServer, startHeartbeat } from './runtime';
import { tokenHash } from './session-lookup';
import { AccountsSetupError, createAccountStore, type AccountStore } from './store';

const CHEAP = { N: 2 ** 10, r: 8, p: 1 };
const ADMIN_PASSWORD = 'a-long-admin-password-1';
const ON = (password = ADMIN_PASSWORD, username = 'admin'): Extract<AccessSetting, { state: 'on' }> => ({
  state: 'on',
  admin: { username, password },
  trustedProxyHops: 0,
});

let db: SqliteDatabase;
let store: AccountStore;

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE);
  migrateChatSchema(db);
  store = createAccountStore(db);
});

afterEach(() => {
  vi.useRealTimers();
  if (db.isOpen) db.close();
});

describe('prepareAccounts', () => {
  it('creates the admin from the server settings with a hash of their password', async () => {
    const passwords = createPasswordHasher({ cost: CHEAP });
    await prepareAccounts(ON(), store, passwords);
    const admin = store.findAccountForSignIn('admin');
    expect(admin).toMatchObject({ role: 'admin', managedBy: 'server' });
    expect(await passwords.verify(ADMIN_PASSWORD, admin!.passwordHash)).toBe(true);
  });

  it('leaves the admin and their sessions alone on a restart with the same password', async () => {
    const passwords = createPasswordHasher({ cost: CHEAP });
    await prepareAccounts(ON(), store, passwords);
    const admin = store.findAccountForSignIn('admin')!;
    store.openSession({ accountId: admin.id, tokenHash: tokenHash('A'.repeat(43)), expiresAt: '2999-01-01T00:00:00.000Z' });
    const hash = vi.spyOn(passwords, 'hash');

    await prepareAccounts(ON(), store, passwords);

    expect(hash).not.toHaveBeenCalled();
    expect(store.findAccountForSignIn('admin')?.passwordHash).toBe(admin.passwordHash);
    expect(store.findSession('A'.repeat(43))).not.toBeNull();
  });

  it('takes a changed password from the settings: the old one stops working and admin sessions end', async () => {
    const passwords = createPasswordHasher({ cost: CHEAP });
    await prepareAccounts(ON(), store, passwords);
    const admin = store.findAccountForSignIn('admin')!;
    store.openSession({ accountId: admin.id, tokenHash: tokenHash('A'.repeat(43)), expiresAt: '2999-01-01T00:00:00.000Z' });

    await prepareAccounts(ON('another-long-admin-password'), store, passwords);

    const changed = store.findAccountForSignIn('admin')!;
    expect(await passwords.verify('another-long-admin-password', changed.passwordHash)).toBe(true);
    expect(await passwords.verify(ADMIN_PASSWORD, changed.passwordHash)).toBe(false);
    expect(store.findSession('A'.repeat(43))).toBeNull();
  });

  it('refuses an admin name that belongs to a person created in the app', async () => {
    store.createPersonAccount({ username: 'owner', passwordHash: 'scrypt$x', oneTimeExpiresAt: '2999-01-01T00:00:00.000Z', actor: 'admin' });
    await expect(prepareAccounts(ON(ADMIN_PASSWORD, 'owner'), store, createPasswordHasher({ cost: CHEAP }))).rejects.toBeInstanceOf(AccountsSetupError);
  });
});

describe('prepareHostedServer', () => {
  it('opens no database for a local copy: no sign-in, no backup', async () => {
    const openStore = vi.fn(() => store);
    expect(await prepareHostedServer({}, console, { store: openStore, passwords: () => createPasswordHasher({ cost: CHEAP }) })).toEqual({});
    expect(openStore).not.toHaveBeenCalled();
  });

  it('prepares sign-in when it is on', async () => {
    const result = await prepareHostedServer({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD }, console, {
      store: () => store,
      passwords: () => createPasswordHasher({ cost: CHEAP }),
    });
    expect(result.stopHeartbeat).toBeUndefined();
    expect(store.findAccountForSignIn('admin')).not.toBeNull();
  });

  it('keeps the server up and says why, in one line without the password, when the admin cannot be prepared', async () => {
    store.createPersonAccount({ username: 'admin', passwordHash: 'scrypt$x', oneTimeExpiresAt: '2999-01-01T00:00:00.000Z', actor: 'admin' });
    const log = { warn: vi.fn(), error: vi.fn() };
    await prepareHostedServer({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD }, log, { store: () => store, passwords: () => createPasswordHasher({ cost: CHEAP }) });
    expect(log.error).toHaveBeenCalledTimes(1);
    // Members still sign in; only the admin from the settings cannot.
    expect(String(log.error.mock.calls[0][0])).toMatch(/the admin from the server settings cannot sign in until this is fixed/);
    expect(String(log.error.mock.calls[0][0])).not.toContain(ADMIN_PASSWORD);
  });

  it('starts the heartbeat when the database is backed up', async () => {
    vi.useFakeTimers();
    const result = await prepareHostedServer(
      { RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, LITESTREAM_REPLICA_URL: 's3://bucket/chat.db' },
      console,
      { store: () => store, passwords: () => createPasswordHasher({ cost: CHEAP }) },
    );
    expect(db.prepare('SELECT count(*) AS n FROM host_heartbeat').get()).toEqual({ n: 1 });
    result.stopHeartbeat?.();
  });
});

describe('startHeartbeat', () => {
  it('writes the heartbeat at once and then every interval, until stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
    const touch = vi.fn();
    const stop = startHeartbeat({ touchHeartbeat: touch }, console, 15_000);
    expect(touch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(45_000);
    expect(touch).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(45_000);
    expect(touch).toHaveBeenCalledTimes(4);
  });

  it('logs a failed write at most once a minute and keeps trying', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
    const touch = vi.fn(() => {
      throw new Error('database is locked');
    });
    const log = { warn: vi.fn(), error: vi.fn() };
    const stop = startHeartbeat({ touchHeartbeat: touch }, log, 15_000);
    vi.advanceTimersByTime(45_000);
    expect(touch).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(log.warn).toHaveBeenCalledTimes(2);
    stop();
  });
});
