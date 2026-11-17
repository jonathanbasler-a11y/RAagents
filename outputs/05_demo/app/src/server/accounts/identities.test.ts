import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { NO_PASSWORD_HASH } from './crypto';
import { tokenHash } from './session-lookup';
import {
  AccountRuleError,
  AccountsSetupError,
  EmailTakenError,
  IdentityMismatchError,
  PersonNotFoundError,
  ServerManagedAccountError,
  createAccountStore,
  type AccountStore,
} from './store';

// Company sign-in: people are added by company e-mail, and the first sign-in binds the provider's subject to the account.

const T0 = new Date('2026-11-17T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const ISSUER = 'https://idp.example.test';
const TOKEN_A = 'A'.repeat(43);

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

const identityEvents = () => db.prepare('SELECT account_id, kind, actor FROM account_identity_events ORDER BY id').all();
const accountRow = (username: string) => db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as Record<string, unknown>;

describe('addPersonByEmail', () => {
  it('addPersonByEmail normalises the e-mail and makes a member with no password, invited until the first sign-in', () => {
    const person = store.addPersonByEmail({ email: '  Jane.Doe@Example.TEST ', actor: 'admin' });
    expect(person).toMatchObject({ username: 'jane.doe', email: 'jane.doe@example.test', signIn: 'company', status: 'invited', role: 'member', managedBy: 'app' });
    expect(accountRow('jane.doe')).toMatchObject({ password_hash: NO_PASSWORD_HASH, must_change_password: 0, one_time_expires_at: null, created_by: 'admin' });
    expect(identityEvents()).toEqual([{ account_id: 'id-1', kind: 'added', actor: 'admin' }]);
    expect(JSON.stringify(person)).not.toMatch(/scrypt/);
  });

  it('refuses an e-mail already on the list, however it is typed', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    expect(() => store.addPersonByEmail({ email: 'JANE.DOE@example.test', actor: 'admin' })).toThrow(EmailTakenError);
  });

  it('refuses what is not an e-mail address, with the readable message', () => {
    expect(() => store.addPersonByEmail({ email: 'jane doe', actor: 'admin' })).toThrow(AccountRuleError);
  });

  it('gives a second person with the same name before the @ their own username', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    expect(store.addPersonByEmail({ email: 'jane.doe@other.example.test', actor: 'admin' }).username).toBe('jane.doe-2');
  });

  it('finds the account for an e-mail, and nothing for one that is not on the list', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    expect(store.findIdentityAccount('jane.doe@example.test')).toMatchObject({
      username: 'jane.doe',
      role: 'member',
      disabled: false,
      email: 'jane.doe@example.test',
      issuer: null,
      subject: null,
      displayName: null,
    });
    expect(store.findIdentityAccount('john@example.test')).toBeNull();
  });

  it('finds the account however the e-mail is typed', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    expect(store.findIdentityAccount('  Jane.Doe@Example.TEST ')?.username).toBe('jane.doe');
  });
});

describe('bindIdentity', () => {
  it('binds the first sign-in to the account once, and keeps the name the provider sends', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    clock += HOUR;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Doe' });
    expect(store.findIdentityAccount('jane.doe@example.test')).toMatchObject({ issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Doe' });
    expect(store.listPeople().find((person) => person.username === 'jane.doe')?.status).toBe('active');
    expect(identityEvents().map((event) => (event as { kind: string }).kind)).toEqual(['added', 'bound']);
  });

  it('takes a new display name from a later sign-in of the same subject, recording no new binding', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Doe' });
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Q. Doe' });
    expect(store.findIdentityAccount('jane.doe@example.test')?.displayName).toBe('Jane Q. Doe');
    expect(identityEvents()).toHaveLength(2);
  });

  it('refuses a different subject or issuer for a bound account, changing nothing', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: null });
    expect(() => store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-someone-else', displayName: null })).toThrow(IdentityMismatchError);
    expect(() => store.bindIdentity({ accountId, issuer: 'https://other.example.test', subject: 'sub-jane', displayName: null })).toThrow(IdentityMismatchError);
    expect(store.findIdentityAccount('jane.doe@example.test')?.subject).toBe('sub-jane');
  });

  it('refuses to bind a subject that is already bound to another account', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    store.addPersonByEmail({ email: 'jane.d@example.test', actor: 'admin' });
    const first = store.findIdentityAccount('jane.doe@example.test')!.accountId;
    const second = store.findIdentityAccount('jane.d@example.test')!.accountId;
    store.bindIdentity({ accountId: first, issuer: ISSUER, subject: 'sub-jane', displayName: null });
    expect(() => store.bindIdentity({ accountId: second, issuer: ISSUER, subject: 'sub-jane', displayName: null })).toThrow(IdentityMismatchError);
    expect(store.findIdentityAccount('jane.d@example.test')?.subject).toBeNull();
  });

  it('keeps a display name the database can hold: one line, at most 120 characters, or none', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: `  Jane\nDoe${'e'.repeat(200)}  ` });
    const name = store.findIdentityAccount('jane.doe@example.test')!.displayName!;
    expect([...name].length).toBe(120);
    expect(name.startsWith('Jane Doe')).toBe(true);
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: '   ' });
    expect(store.findIdentityAccount('jane.doe@example.test')!.displayName).toBeNull();
  });

  it('refuses an account with no company identity', () => {
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-1' });
    const admin = store.findAccountForSignIn('admin')!;
    expect(() => store.bindIdentity({ accountId: admin.id, issuer: ISSUER, subject: 's', displayName: null })).toThrow(PersonNotFoundError);
  });

  it('records a refusal as an event of the account', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.noteIdentityRefusal({ accountId, reason: 'identity_mismatch' });
    store.noteIdentityRefusal({ accountId, reason: 'disabled' });
    expect(identityEvents().slice(1)).toEqual([
      { account_id: accountId, kind: 'refused_mismatch', actor: 'sign-in' },
      { account_id: accountId, kind: 'refused_disabled', actor: 'sign-in' },
    ]);
  });
});

describe('reinvitePerson', () => {
  const bound = () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Doe' });
    store.openSession({ accountId, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    return accountId;
  };

  it('clears the binding, ends the sessions and records which admin did it; the next sign-in binds again', () => {
    const accountId = bound();
    const person = store.reinvitePerson({ username: 'jane.doe', actor: 'admin' });
    expect(person.status).toBe('invited');
    expect(store.findIdentityAccount('jane.doe@example.test')).toMatchObject({ issuer: null, subject: null, displayName: null });
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(identityEvents().at(-1)).toEqual({ account_id: accountId, kind: 'unbound', actor: 'admin' });
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane-new', displayName: 'Jane Doe' });
    expect(store.findIdentityAccount('jane.doe@example.test')?.subject).toBe('sub-jane-new');
  });

  it('lets a new account bind the subject the old account held, once the old one is re-invited (an e-mail change)', () => {
    bound();
    store.addPersonByEmail({ email: 'jane.d@example.test', actor: 'admin' });
    const fresh = store.findIdentityAccount('jane.d@example.test')!.accountId;
    expect(() => store.bindIdentity({ accountId: fresh, issuer: ISSUER, subject: 'sub-jane', displayName: null })).toThrow(IdentityMismatchError);
    store.reinvitePerson({ username: 'jane.doe', actor: 'admin' });
    store.bindIdentity({ accountId: fresh, issuer: ISSUER, subject: 'sub-jane', displayName: null });
    expect(store.findIdentityAccount('jane.d@example.test')?.subject).toBe('sub-jane');
  });

  it('changes and records nothing for a person who never signed in', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    store.reinvitePerson({ username: 'jane.doe', actor: 'admin' });
    expect(identityEvents().map((event) => (event as { kind: string }).kind)).toEqual(['added']);
  });

  it('refuses a password account, the admin from the server settings and an unknown name', () => {
    store.createPersonAccount({ username: 'member-one', passwordHash: 'scrypt$x', oneTimeExpiresAt: iso(HOUR), actor: 'admin' });
    expect(() => store.reinvitePerson({ username: 'member-one', actor: 'admin' })).toThrow(AccountRuleError);
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    expect(() => store.reinvitePerson({ username: 'admin', actor: 'admin' })).toThrow(ServerManagedAccountError);
    expect(() => store.reinvitePerson({ username: 'nobody', actor: 'admin' })).toThrow(PersonNotFoundError);
  });
});

describe('bootstrapServerAdminByEmail', () => {
  it('creates the admin from the settings with their company e-mail and no password', () => {
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    expect(store.findIdentityAccount('owner@example.test')).toMatchObject({ username: 'admin', role: 'admin', managedBy: 'server', subject: null });
    expect(accountRow('admin').password_hash).toBe(NO_PASSWORD_HASH);
  });

  it('changes nothing at a restart with the same e-mail, keeping the binding and the sessions', () => {
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    const { accountId } = store.findIdentityAccount('owner@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-owner', displayName: 'Owner' });
    store.openSession({ accountId, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    expect(store.findIdentityAccount('owner@example.test')?.subject).toBe('sub-owner');
    expect(store.findSession(TOKEN_A)).not.toBeNull();
  });

  it('on a new e-mail clears the binding and ends the admin sessions', () => {
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    const { accountId } = store.findIdentityAccount('owner@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-owner', displayName: 'Owner' });
    store.openSession({ accountId, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'new.owner@example.test' });
    expect(store.findIdentityAccount('owner@example.test')).toBeNull();
    expect(store.findIdentityAccount('new.owner@example.test')).toMatchObject({ accountId, subject: null });
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(identityEvents().map((event) => (event as { kind: string }).kind)).toEqual(['added', 'bound', 'email_changed']);
  });

  it('turns a password admin from earlier settings into a company admin, ending their sessions', () => {
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-1' });
    const admin = store.findAccountForSignIn('admin')!;
    store.openSession({ accountId: admin.id, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' });
    expect(accountRow('admin').password_hash).toBe(NO_PASSWORD_HASH);
    expect(store.findSession(TOKEN_A)).toBeNull();
    expect(store.findIdentityAccount('owner@example.test')?.accountId).toBe(admin.id);
  });

  it('refuses an e-mail that belongs to a person on the People page, changing nothing', () => {
    store.addPersonByEmail({ email: 'owner@example.test', actor: 'someone' });
    expect(() => store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' })).toThrow(AccountsSetupError);
    expect(store.findAccountForSignIn('admin')).toBeNull();
  });

  it('refuses a username used by a person created in the app', () => {
    store.addPersonByEmail({ email: 'admin@example.test', actor: 'someone' });
    expect(() => store.bootstrapServerAdminByEmail({ username: 'admin', email: 'owner@example.test' })).toThrow(AccountsSetupError);
  });
});

describe('sessions and the People list with company sign-in', () => {
  it('a session carries the display name of a bound person, and none for a password account', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    const { accountId } = store.findIdentityAccount('jane.doe@example.test')!;
    store.bindIdentity({ accountId, issuer: ISSUER, subject: 'sub-jane', displayName: 'Jane Doe' });
    store.openSession({ accountId, tokenHash: tokenHash(TOKEN_A), expiresAt: iso(12 * HOUR) });
    expect(store.findSession(TOKEN_A)).toMatchObject({ username: 'jane.doe', displayName: 'Jane Doe', signIn: 'company' });

    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-1' });
    const admin = store.findAccountForSignIn('admin')!;
    store.openSession({ accountId: admin.id, tokenHash: tokenHash('B'.repeat(43)), expiresAt: iso(12 * HOUR) });
    expect(store.findSession('B'.repeat(43))).toMatchObject({ username: 'admin', displayName: null, signIn: 'password' });
  });

  it('lists e-mail and sign-in method for every person', () => {
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-1' });
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    expect(store.listPeople().map((person) => [person.username, person.email, person.signIn, person.status])).toEqual([
      ['admin', null, 'password', 'active'],
      ['jane.doe', 'jane.doe@example.test', 'company', 'invited'],
    ]);
  });

  it('shows a disabled company person as disabled, not invited', () => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
    store.setPersonDisabled({ username: 'jane.doe', disabled: true, actor: 'admin' });
    expect(store.listPeople()[0]?.status).toBe('disabled');
    expect(store.findIdentityAccount('jane.doe@example.test')?.disabled).toBe(true);
  });
});

describe('the database rules for company identities (schema version 8)', () => {
  const raw = (sql: string, ...args: (string | number | null)[]) => () => db.prepare(sql).run(...args);

  beforeEach(() => {
    store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
  });

  it('refuses an e-mail that is not lower-case or not one address', () => {
    db.prepare(
      `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
       VALUES ('x1', 'x-one', 'member', 'app', ?, 0, NULL, NULL, ?, 'admin')`,
    ).run(NO_PASSWORD_HASH, iso(0));
    for (const email of ['Jane@example.test', 'jane', 'a@b@example.test', 'jane doe@example.test']) {
      expect(raw(`INSERT INTO account_identities (account_id, email, created_at) VALUES ('x1', ?, ?)`, email, iso(0)), email).toThrow();
    }
  });

  it('refuses an identity on an account that holds a password, and a password on an account with an identity', () => {
    store.bootstrapServerAdmin({ username: 'admin', passwordHash: 'scrypt$env-1' });
    const admin = store.findAccountForSignIn('admin')!;
    expect(raw(`INSERT INTO account_identities (account_id, email, created_at) VALUES (?, 'admin@example.test', ?)`, admin.id, iso(0))).toThrow(
      /no password/,
    );
    expect(raw(`UPDATE accounts SET password_hash = 'scrypt$guess' WHERE username = 'jane.doe'`)).toThrow(/no password/);
  });

  it('never deletes an identity, never moves it to another account, and changes the e-mail only for the server admin', () => {
    expect(raw(`DELETE FROM account_identities`)).toThrow();
    expect(raw(`UPDATE account_identities SET account_id = 'id-99'`)).toThrow();
    expect(raw(`UPDATE account_identities SET email = 'other@example.test'`)).toThrow();
  });

  it('never moves a bound identity to another subject or issuer; clearing it (a re-invite) is allowed', () => {
    db.prepare(`UPDATE account_identities SET issuer = ?, subject = 'sub-jane', bound_at = ?`).run(ISSUER, iso(0));
    expect(raw(`UPDATE account_identities SET subject = 'sub-other'`)).toThrow();
    expect(raw(`UPDATE account_identities SET issuer = 'https://other.example.test'`)).toThrow();
    expect(raw(`UPDATE account_identities SET issuer = NULL, subject = NULL, bound_at = NULL`)).not.toThrow();
  });

  it('accepts the re-invite event kind', () => {
    expect(raw(`INSERT INTO account_identity_events (account_id, kind, at, actor) VALUES ('id-1', 'unbound', ?, 'admin')`, iso(0))).not.toThrow();
  });

  it('keeps issuer, subject and the binding time together', () => {
    expect(raw(`UPDATE account_identities SET subject = 'sub-jane'`)).toThrow();
  });

  it('keeps the identity events: no change, no delete', () => {
    expect(raw(`UPDATE account_identity_events SET kind = 'bound'`)).toThrow();
    expect(raw(`DELETE FROM account_identity_events`)).toThrow();
  });
});
