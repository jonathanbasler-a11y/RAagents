import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_MIGRATIONS, migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';

// The account tables (schema version 7) refuse, on their own, what the account store refuses first: a malformed name or
// hash, a one-time password without an expiry, a second admin from the server settings, a changed identity, a deleted
// account, a session for a disabled account, a session revoked twice, a rewritten event. Each refusal is raw SQL with a
// positive control beside it, so a test can only pass because the database refused.

let db: SqliteDatabase | undefined;

afterEach(() => {
  if (db?.isOpen) db.close();
  db = undefined;
});

function open(): SqliteDatabase {
  const opened = openDatabase(IN_MEMORY_DATABASE);
  db = opened;
  migrateChatSchema(opened);
  return opened;
}

const T0 = '2026-10-29T10:00:00.000Z';
const LATER = '2026-11-05T10:00:00.000Z';
const HASH = 'a'.repeat(64);

interface AccountRow {
  id: string;
  username: string;
  role: string;
  managed_by: string;
  password_hash: string | null;
  must_change_password: number;
  one_time_expires_at: string | null;
  disabled_at: string | null;
  created_by: string;
}

const MEMBER: AccountRow = {
  id: 'acc-member',
  username: 'member-one',
  role: 'member',
  managed_by: 'app',
  password_hash: 'scrypt$n=1024,r=8,p=1$salt$key',
  must_change_password: 1,
  one_time_expires_at: LATER,
  disabled_at: null,
  created_by: 'admin',
};

const SERVER_ADMIN: AccountRow = {
  ...MEMBER,
  id: 'acc-admin',
  username: 'admin',
  role: 'admin',
  managed_by: 'server',
  must_change_password: 0,
  one_time_expires_at: null,
  created_by: 'server',
};

function insertAccount(opened: SqliteDatabase, row: AccountRow, verb = 'INSERT'): void {
  opened
    .prepare(
      `${verb} INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.username, row.role, row.managed_by, row.password_hash, row.must_change_password, row.one_time_expires_at, row.disabled_at, T0, row.created_by);
}

function insertSession(opened: SqliteDatabase, tokenHash = HASH, accountId = MEMBER.id, verb = 'INSERT', expiresAt = LATER): void {
  opened
    .prepare(`${verb} INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(tokenHash, accountId, T0, expiresAt);
}

describe('accounts', () => {
  it('takes a member waiting for their own password and the admin from the server settings', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    insertAccount(opened, SERVER_ADMIN);
    expect(opened.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 2 });
  });

  it('refuses a username the app would refuse', () => {
    const opened = open();
    for (const username of ['Member', 'a', 'x'.repeat(33), 'with space', '-lead', 'a/b', 'émile']) {
      expect(() => insertAccount(opened, { ...MEMBER, username }), username).toThrow(/CHECK/);
    }
    insertAccount(opened, { ...MEMBER, username: 'a.b_c-1' });
  });

  it('refuses an unknown role or origin', () => {
    const opened = open();
    expect(() => insertAccount(opened, { ...MEMBER, role: 'owner' })).toThrow(/CHECK/);
    expect(() => insertAccount(opened, { ...MEMBER, managed_by: 'elsewhere' })).toThrow(/CHECK/);
  });

  it('refuses a missing password hash or one that is not scrypt', () => {
    const opened = open();
    expect(() => insertAccount(opened, { ...MEMBER, password_hash: null })).toThrow(/NOT NULL/);
    expect(() => insertAccount(opened, { ...MEMBER, password_hash: 'plain text' })).toThrow(/CHECK/);
  });

  it('ties a one-time password to its expiry, both ways', () => {
    const opened = open();
    expect(() => insertAccount(opened, { ...MEMBER, must_change_password: 1, one_time_expires_at: null })).toThrow(/CHECK/);
    expect(() => insertAccount(opened, { ...MEMBER, must_change_password: 0, one_time_expires_at: LATER })).toThrow(/CHECK/);
    expect(() => insertAccount(opened, { ...MEMBER, must_change_password: 2 })).toThrow(/CHECK/);
    insertAccount(opened, { ...MEMBER, must_change_password: 0, one_time_expires_at: null });
  });

  it('keeps the admin from the server settings an admin without a one-time password', () => {
    const opened = open();
    expect(() => insertAccount(opened, { ...SERVER_ADMIN, role: 'member' })).toThrow(/CHECK/);
    expect(() => insertAccount(opened, { ...SERVER_ADMIN, must_change_password: 1, one_time_expires_at: LATER })).toThrow(/CHECK/);
  });

  it('refuses a blank creator', () => {
    const opened = open();
    expect(() => insertAccount(opened, { ...MEMBER, created_by: '' })).toThrow(/CHECK/);
  });

  it('refuses a second account with the same name', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    expect(() => insertAccount(opened, { ...MEMBER, id: 'acc-other' })).toThrow(/UNIQUE/);
  });

  it('allows at most one enabled admin from the server settings; a former one stays, disabled', () => {
    const opened = open();
    insertAccount(opened, SERVER_ADMIN);
    expect(() => insertAccount(opened, { ...SERVER_ADMIN, id: 'acc-admin-2', username: 'owner' })).toThrow(/UNIQUE/);
    insertAccount(opened, { ...SERVER_ADMIN, id: 'acc-admin-old', username: 'old-admin', disabled_at: T0 });
  });

  it('never changes the name, role, origin or creation of an account', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    for (const change of [`username = 'someone-else'`, `role = 'admin'`, `managed_by = 'server'`, `created_at = 'x'`, `created_by = 'x'`, `id = 'acc-2'`]) {
      expect(() => opened.exec(`UPDATE accounts SET ${change} WHERE id = '${MEMBER.id}'`), change).toThrow(/never change/);
    }
    opened.exec(`UPDATE accounts SET password_hash = 'scrypt$new', must_change_password = 0, one_time_expires_at = NULL, disabled_at = '${T0}' WHERE id = '${MEMBER.id}'`);
  });

  it('never deletes an account, also not through REPLACE', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    expect(() => opened.exec(`DELETE FROM accounts WHERE id = '${MEMBER.id}'`)).toThrow(/never deleted/);
    expect(() => insertAccount(opened, { ...MEMBER, password_hash: 'scrypt$replaced' }, 'INSERT OR REPLACE')).toThrow(/never deleted/);
  });
});

describe('account sessions', () => {
  it('take a session that holds only a SHA-256 of the token', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    insertSession(opened);
    expect(opened.prepare('SELECT count(*) AS n FROM account_sessions').get()).toEqual({ n: 1 });
  });

  it('refuse anything but 64 lower-case hex characters as the token hash', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    for (const hash of ['abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(65)]) {
      expect(() => insertSession(opened, hash), hash).toThrow(/CHECK/);
    }
  });

  it('refuse a session that ends when it starts, or belongs to no account', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    expect(() => insertSession(opened, HASH, MEMBER.id, 'INSERT', T0)).toThrow(/CHECK/);
    expect(() => insertSession(opened, HASH, 'acc-nobody')).toThrow(/FOREIGN KEY/);
  });

  it('refuse a session for a disabled account', () => {
    const opened = open();
    insertAccount(opened, { ...MEMBER, disabled_at: T0 });
    expect(() => insertSession(opened)).toThrow(/disabled account/);
  });

  it('can only be revoked, once', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    insertSession(opened);
    opened.exec(`UPDATE account_sessions SET revoked_at = '${T0}' WHERE token_hash = '${HASH}'`);
    expect(() => opened.exec(`UPDATE account_sessions SET revoked_at = '${LATER}' WHERE token_hash = '${HASH}'`)).toThrow(/revoked, once/);
    expect(() => opened.exec(`UPDATE account_sessions SET revoked_at = NULL WHERE token_hash = '${HASH}'`)).toThrow(/revoked, once/);
  });

  it('never extend, move or delete a session, also not through REPLACE', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    insertAccount(opened, SERVER_ADMIN);
    insertSession(opened);
    expect(() => opened.exec(`UPDATE account_sessions SET expires_at = '2027-01-01' WHERE token_hash = '${HASH}'`)).toThrow(/revoked, once/);
    expect(() => opened.exec(`UPDATE account_sessions SET account_id = '${SERVER_ADMIN.id}' WHERE token_hash = '${HASH}'`)).toThrow(/revoked, once/);
    expect(() => opened.exec(`DELETE FROM account_sessions WHERE token_hash = '${HASH}'`)).toThrow(/never deleted/);
    expect(() => insertSession(opened, HASH, SERVER_ADMIN.id, 'INSERT OR REPLACE')).toThrow(/never deleted/);
  });
});

describe('account events', () => {
  function insertEvent(opened: SqliteDatabase, kind: string, actor = 'admin'): void {
    opened.prepare(`INSERT INTO account_events (account_id, kind, at, actor) VALUES (?, ?, ?, ?)`).run(MEMBER.id, kind, T0, actor);
  }

  it('take the kinds of event the store records', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    for (const kind of ['created', 'password_reset', 'password_changed', 'disabled', 'enabled', 'signed_in', 'signed_out']) insertEvent(opened, kind);
    expect(opened.prepare('SELECT count(*) AS n FROM account_events').get()).toEqual({ n: 7 });
  });

  it('refuse an unknown kind or a blank actor', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    expect(() => insertEvent(opened, 'logged_in')).toThrow(/CHECK/);
    expect(() => insertEvent(opened, 'created', '')).toThrow(/CHECK/);
  });

  it('are never changed or deleted', () => {
    const opened = open();
    insertAccount(opened, MEMBER);
    insertEvent(opened, 'created');
    expect(() => opened.exec(`UPDATE account_events SET kind = 'disabled'`)).toThrow(/cannot be changed/);
    expect(() => opened.exec(`DELETE FROM account_events`)).toThrow(/cannot be deleted/);
  });
});

describe('host heartbeat', () => {
  it('has exactly one row slot, which can be rewritten', () => {
    const opened = open();
    opened.exec(`INSERT INTO host_heartbeat (id, at) VALUES (1, '${T0}')`);
    opened.exec(`UPDATE host_heartbeat SET at = '${LATER}' WHERE id = 1`);
    expect(() => opened.exec(`INSERT INTO host_heartbeat (id, at) VALUES (2, '${T0}')`)).toThrow(/CHECK/);
  });
});

describe('migration to version 7', () => {
  it('keeps the chat data of a version-6 database and adds the empty account tables', () => {
    const opened = openDatabase(IN_MEMORY_DATABASE);
    db = opened;
    migrateChatSchema(opened, CHAT_MIGRATIONS.slice(0, 6));
    opened.exec(`INSERT INTO threads (id, room, created_at) VALUES ('thread-1', 'team', 'now')`);

    migrateChatSchema(opened);

    expect(opened.prepare('PRAGMA user_version').get()).toEqual({ user_version: CHAT_MIGRATIONS.length });
    expect(opened.prepare(`SELECT id FROM threads`).all()).toEqual([{ id: 'thread-1' }]);
    expect(opened.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 0 });
  });
});
