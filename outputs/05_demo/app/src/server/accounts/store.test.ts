import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { tokenHash } from './session-lookup';
import {
  AccountRuleError,
  AccountsSetupError,
  PasswordChangedMeanwhileError,
  PersonNotFoundError,
  ServerManagedAccountError,
  UsernameTakenError,
  createAccountStore,
  type AccountStore,
} from './store';

const T0 = new Date('2026-10-29T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const TOKEN_C = 'C'.repeat(43);

let db: SqliteDatabase;
let clock: number;
let store: AccountStore;

beforeEach(() => {
  db = openDatabase(IN_MEMORY_DATABASE);
  migrateChatSchema(db);
  clock = T0.getTime();
  let next = 0;
  store = createAccountStore(db, { now: () => new Date(clock), newId: () => `id-${++next}` });
});

afterEach(() => {
  if (db.isOpen) db.close();
});

const events = () => db.prepare('SELECT account_id, kind, actor FROM account_events ORDER BY id').all();
const openSessions = () => db.prepare('SELECT count(*) AS n FROM account_sessions WHERE revoked_at IS NULL').get() as { n: number };

function addMember(username = 'member-one') {
  return store.createPersonAccount({ username, passwordHash: 'scrypt$one-time', oneTimeExpiresAt: iso(WEEK), actor: 'admin' });
}

function addServerAdmin(username = 'admin', passwordHash = 'scrypt$env-1') {
  store.bootstrapServerAdmin({ username, passwordHash });
  return store.findAccountForSignIn(username);
}

describe('createPersonAccount', () => {
  it('creates a member waiting for their own password, and records who created them', () => {
    const person = addMember();
    expect(person).toEqual({
      username: 'member-one',
      role: 'member',
      managedBy: 'app',
      status: 'waiting',
      oneTimeExpiresAt: iso(WEEK),
      createdAt: T0.toISOString(),
      createdBy: 'admin',
      lastSignInAt: null,
      openSessions: 0,
    });
    expect(events()).toEqual([{ account_id: 'id-1', kind: 'created', actor: 'admin' }]);
  });

  it('refuses a name that is taken, also by the admin from the server settings', () => {
    addMember();
    addServerAdmin('admin');
    expect(() => addMember('member-one')).toThrow(UsernameTakenError);
    expect(() => addMember('admin')).toThrow(UsernameTakenError);
  });

  it('refuses a name the rules refuse, with the readable message', () => {
    expect(() => addMember('Member One')).toThrow(AccountRuleError);
  });
});

describe('sign-in and sessions', () => {
  it('finds the account to check a password against, and nothing for an unknown name', () => {
    addMember();
    expect(store.findAccountForSignIn('member-one')).toMatchObject({
      username: 'member-one',
      passwordHash: 'scrypt$one-time',
      mustChangePassword: true,
      oneTimeExpiresAt: iso(WEEK),
      disabledAt: null,
    });
    expect(store.findAccountForSignIn('nobody')).toBeNull();
  });

  it('opens a session that the cookie token finds, and records the sign-in', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    expect(store.findSession(TOKEN_A)).toMatchObject({ username: 'member-one', mustChangePassword: true });
    expect(events().at(-1)).toEqual({ account_id: id, kind: 'signed_in', actor: 'member-one' });
    clock += 12 * HOUR;
    expect(store.findSession(TOKEN_A)).toBeNull();
  });

  it('closes a session once, recording the sign-out; closing it again changes nothing', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.closeSession(tokenHash(TOKEN_A));
    store.closeSession(tokenHash(TOKEN_A));
    store.closeSession(tokenHash(TOKEN_B));
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(events().filter((event) => (event as { kind: string }).kind === 'signed_out')).toHaveLength(1);
  });
});

describe('resetPersonPassword', () => {
  it('sets a new one-time password, signs the person out everywhere and records it', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_B), expiresAt: iso(12 * HOUR) });
    clock += HOUR;

    const person = store.resetPersonPassword({ username: 'member-one', passwordHash: 'scrypt$second', oneTimeExpiresAt: iso(HOUR + WEEK), actor: 'admin' });

    expect(person).toMatchObject({ status: 'waiting', oneTimeExpiresAt: iso(HOUR + WEEK), openSessions: 0 });
    expect(store.findAccountForSignIn('member-one')?.passwordHash).toBe('scrypt$second');
    expect(openSessions()).toEqual({ n: 0 });
    expect(events().at(-1)).toEqual({ account_id: id, kind: 'password_reset', actor: 'admin' });
  });

  it('refuses the admin from the server settings and an unknown name', () => {
    addServerAdmin();
    expect(() => store.resetPersonPassword({ username: 'admin', passwordHash: 'scrypt$x', oneTimeExpiresAt: iso(WEEK), actor: 'admin' })).toThrow(ServerManagedAccountError);
    expect(() => store.resetPersonPassword({ username: 'nobody', passwordHash: 'scrypt$x', oneTimeExpiresAt: iso(WEEK), actor: 'admin' })).toThrow(PersonNotFoundError);
  });
});

describe('setPersonDisabled', () => {
  it('disables a person, ending their sessions at once, and enables them again', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });

    expect(store.setPersonDisabled({ username: 'member-one', disabled: true, actor: 'admin' }).status).toBe('disabled');
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(openSessions()).toEqual({ n: 0 });
    expect(() => store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_B), expiresAt: iso(12 * HOUR) })).toThrow(/disabled/);

    expect(store.setPersonDisabled({ username: 'member-one', disabled: false, actor: 'admin' }).status).toBe('waiting');
    expect(events().slice(-2)).toEqual([
      { account_id: id, kind: 'disabled', actor: 'admin' },
      { account_id: id, kind: 'enabled', actor: 'admin' },
    ]);
  });

  it('records nothing when the person is already in that state', () => {
    addMember();
    store.setPersonDisabled({ username: 'member-one', disabled: false, actor: 'admin' });
    expect(events()).toHaveLength(1);
  });

  it('refuses to disable the admin from the server settings', () => {
    addServerAdmin();
    expect(() => store.setPersonDisabled({ username: 'admin', disabled: true, actor: 'admin' })).toThrow(ServerManagedAccountError);
  });
});

describe('changeOwnPassword', () => {
  it('sets the new password, ends every session of the person and opens the new one, in one step', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.openSession({ accountId: id, tokenHash: tokenHash(TOKEN_B), expiresAt: iso(12 * HOUR) });

    store.changeOwnPassword({ accountId: id, expectedHash: 'scrypt$one-time', newHash: 'scrypt$mine', newTokenHash: tokenHash(TOKEN_C), sessionExpiresAt: iso(12 * HOUR) });

    expect(store.findAccountForSignIn('member-one')).toMatchObject({ passwordHash: 'scrypt$mine', mustChangePassword: false, oneTimeExpiresAt: null });
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(store.findSession(TOKEN_B)).toBeNull();
    expect(store.findSession(TOKEN_C)).toMatchObject({ username: 'member-one', mustChangePassword: false });
    expect(events().at(-1)).toEqual({ account_id: id, kind: 'password_changed', actor: 'member-one' });
  });

  it('refuses when the password changed in the meantime (an admin reset wins), changing nothing', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.resetPersonPassword({ username: 'member-one', passwordHash: 'scrypt$reset', oneTimeExpiresAt: iso(WEEK), actor: 'admin' });
    expect(() =>
      store.changeOwnPassword({ accountId: id, expectedHash: 'scrypt$one-time', newHash: 'scrypt$mine', newTokenHash: tokenHash(TOKEN_C), sessionExpiresAt: iso(12 * HOUR) }),
    ).toThrow(PasswordChangedMeanwhileError);
    expect(store.findAccountForSignIn('member-one')?.passwordHash).toBe('scrypt$reset');
    expect(store.findSession(TOKEN_C)).toBeNull();
  });

  it('refuses a disabled account', () => {
    const id = store.findAccountForSignIn(addMember().username)!.id;
    store.setPersonDisabled({ username: 'member-one', disabled: true, actor: 'admin' });
    expect(() =>
      store.changeOwnPassword({ accountId: id, expectedHash: 'scrypt$one-time', newHash: 'scrypt$mine', newTokenHash: tokenHash(TOKEN_C), sessionExpiresAt: iso(12 * HOUR) }),
    ).toThrow(PersonNotFoundError);
  });
});

describe('listPeople', () => {
  it('shows each person with their status, last sign-in and open sessions, and never a hash', () => {
    addServerAdmin();
    const active = store.findAccountForSignIn(addMember('member-one').username)!.id;
    store.changeOwnPassword({ accountId: active, expectedHash: 'scrypt$one-time', newHash: 'scrypt$mine', newTokenHash: tokenHash(TOKEN_A), sessionExpiresAt: iso(12 * HOUR) });
    store.openSession({ accountId: active, tokenHash: tokenHash(TOKEN_B), expiresAt: iso(12 * HOUR) });
    store.createPersonAccount({ username: 'member-two', passwordHash: 'scrypt$x', oneTimeExpiresAt: iso(HOUR), actor: 'admin' });
    addMember('member-three');
    store.setPersonDisabled({ username: 'member-three', disabled: true, actor: 'admin' });
    clock += 2 * HOUR;

    const people = store.listPeople();

    expect(people.map((person) => [person.username, person.status, person.openSessions])).toEqual([
      ['admin', 'active', 0],
      ['member-one', 'active', 2],
      ['member-three', 'disabled', 0],
      ['member-two', 'expired', 0],
    ]);
    expect(people.find((person) => person.username === 'member-one')?.lastSignInAt).toBe(T0.toISOString());
    expect(JSON.stringify(people)).not.toMatch(/scrypt/);
  });
});

describe('bootstrapServerAdmin', () => {
  it('creates the admin from the server settings at the first start', () => {
    const admin = addServerAdmin('admin', 'scrypt$env-1');
    expect(admin).toMatchObject({ role: 'admin', managedBy: 'server', passwordHash: 'scrypt$env-1', mustChangePassword: false });
    expect(events()).toEqual([{ account_id: admin!.id, kind: 'created', actor: 'server' }]);
  });

  it('keeps the admin and their sessions when the password in the settings is unchanged', () => {
    const admin = addServerAdmin();
    store.openSession({ accountId: admin!.id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: null });
    expect(store.findSession(TOKEN_A)).not.toBeNull();
    expect(events().map((event) => (event as { kind: string }).kind)).toEqual(['created', 'signed_in']);
  });

  it('takes a changed password from the settings and ends the admin sessions', () => {
    const admin = addServerAdmin();
    store.openSession({ accountId: admin!.id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-2' });
    expect(store.findAccountForSignIn('admin')?.passwordHash).toBe('scrypt$env-2');
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(events().at(-1)).toEqual({ account_id: admin!.id, kind: 'password_changed', actor: 'server' });
  });

  it('retires a former admin named by earlier settings before creating the new one', () => {
    const former = addServerAdmin('admin');
    store.openSession({ accountId: former!.id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdmin({ username: 'owner', passwordHash: 'scrypt$env-2' });
    expect(store.findAccountForSignIn('admin')?.disabledAt).not.toBeNull();
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(store.findAccountForSignIn('owner')).toMatchObject({ role: 'admin', managedBy: 'server', disabledAt: null });
  });

  it('enables a former admin again when the settings name them again', () => {
    addServerAdmin('admin');
    store.bootstrapServerAdmin({ username: 'owner', passwordHash: 'scrypt$env-2' });
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-3' });
    expect(store.findAccountForSignIn('admin')).toMatchObject({ disabledAt: null, passwordHash: 'scrypt$env-3' });
    expect(store.findAccountForSignIn('owner')?.disabledAt).not.toBeNull();
  });

  it('refuses a name already used by a person created in the app, changing nothing', () => {
    addMember('owner');
    expect(() => store.bootstrapServerAdmin({ username: 'owner', passwordHash: 'scrypt$env-1' })).toThrow(AccountsSetupError);
    expect(store.findAccountForSignIn('owner')).toMatchObject({ role: 'member', managedBy: 'app' });
  });

  it('needs a hash for an admin it has to create', () => {
    expect(() => store.bootstrapServerAdmin({ username: 'admin', passwordHash: null })).toThrow(AccountsSetupError);
  });

  it('tells the caller what it would find, so the password can be checked outside the transaction', () => {
    expect(store.serverAdminState('admin')).toEqual({ existing: null, clash: false });
    addServerAdmin('admin', 'scrypt$env-1');
    expect(store.serverAdminState('admin')).toEqual({ existing: { passwordHash: 'scrypt$env-1', disabled: false }, clash: false });
    addMember('member-one');
    expect(store.serverAdminState('member-one').clash).toBe(true);
  });
});

describe('touchHeartbeat', () => {
  it('rewrites the one heartbeat row with the time', () => {
    store.touchHeartbeat();
    clock += 15_000;
    store.touchHeartbeat();
    expect(db.prepare('SELECT id, at FROM host_heartbeat').all()).toEqual([{ id: 1, at: iso(15_000) }]);
  });
});
