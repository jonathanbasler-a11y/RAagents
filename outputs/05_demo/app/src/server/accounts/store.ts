import 'server-only';
import { randomUUID } from 'node:crypto';
import { immediateTransaction } from '@/server/chat/schema';
import type { SqliteDatabase } from '@/server/db/sqlite';
import {
  checkUsername,
  type AccountManagedBy,
  type AccountRole,
  type PersonStatus,
  type PersonSummary,
  type SessionView,
} from '@/shared/accounts';
import { readSession } from './session-lookup';

// The accounts of a hosted copy, in the chat database (schema version 7), so the backup keeps them with the chats.
//
// Every write is one synchronous BEGIN IMMEDIATE transaction that checks its rule again inside, and records an event. A
// password is never hashed inside a transaction: the caller hashes first (src/server/accounts/crypto.ts) and passes the
// hash, so no transaction waits on the thread pool. The database enforces the same rules again (schema.ts).
//
// The writers have one door each (tests/structure/writer-allowlist.test.ts): the People page's handler creates, resets,
// disables and enables people; the password handler changes a person's own password; the sign-in handler opens and
// closes sessions; the server's start hook writes the admin from the server settings and the heartbeat.

export class AccountRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountRuleError';
  }
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`the username "${username}" is taken`);
    this.name = 'UsernameTakenError';
  }
}

export class PersonNotFoundError extends Error {
  constructor(what: string) {
    super(`there is no enabled account ${what}`);
    this.name = 'PersonNotFoundError';
  }
}

export class ServerManagedAccountError extends Error {
  constructor(username: string) {
    super(`the account "${username}" is set in the server settings, not on the People page`);
    this.name = 'ServerManagedAccountError';
  }
}

export class PasswordChangedMeanwhileError extends Error {
  constructor() {
    super('the password changed in the meantime');
    this.name = 'PasswordChangedMeanwhileError';
  }
}

export class AccountsSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountsSetupError';
  }
}

/** What sign-in needs to check a password. Holds the hash: never leaves the server. */
export interface SignInAccount {
  id: string;
  username: string;
  role: AccountRole;
  managedBy: AccountManagedBy;
  passwordHash: string;
  mustChangePassword: boolean;
  oneTimeExpiresAt: string | null;
  disabledAt: string | null;
}

/** What the start hook finds for the admin named in the server settings. */
export interface ServerAdminState {
  existing: { passwordHash: string; disabled: boolean } | null;
  /** The name belongs to a person created in the app. */
  clash: boolean;
}

export interface AccountStore {
  /** The person behind a session token, or null. */
  findSession(token: string): SessionView | null;
  findAccountForSignIn(username: string): SignInAccount | null;
  findAccountById(id: string): SignInAccount | null;
  /** Everyone, by username. */
  listPeople(): PersonSummary[];
  createPersonAccount(input: { username: string; passwordHash: string; oneTimeExpiresAt: string; actor: string }): PersonSummary;
  /** A new one-time password; ends every session of the person. */
  resetPersonPassword(input: { username: string; passwordHash: string; oneTimeExpiresAt: string; actor: string }): PersonSummary;
  /** Disabling ends every session of the person. Nothing is recorded when the person is already in that state. */
  setPersonDisabled(input: { username: string; disabled: boolean; actor: string }): PersonSummary;
  /** The new password, every old session ended and the new one opened, in one step; refused if the hash moved meanwhile. */
  changeOwnPassword(input: { accountId: string; expectedHash: string; newHash: string; newTokenHash: string; sessionExpiresAt: string }): void;
  openSession(input: { accountId: string; tokenHash: string; expiresAt: string }): void;
  /** Revokes the session if it is open. */
  closeSession(tokenHash: string): void;
  serverAdminState(username: string): ServerAdminState;
  /**
   * Makes `username` the one enabled admin from the server settings: retires any other, re-enables a former one, creates
   * it if missing (then `passwordHash` is required), and takes a new hash (ending the admin's sessions). null keeps the hash.
   */
  bootstrapServerAdmin(input: { username: string; passwordHash: string | null }): void;
  /** Rewrites the heartbeat row (a hosted copy says it is still writing the backup). */
  touchHeartbeat(): void;
}

interface AccountRow {
  id: string;
  username: string;
  role: AccountRole;
  managed_by: AccountManagedBy;
  password_hash: string;
  must_change_password: number;
  one_time_expires_at: string | null;
  disabled_at: string | null;
  created_at: string;
  created_by: string;
}

type EventKind = 'created' | 'password_reset' | 'password_changed' | 'disabled' | 'enabled' | 'signed_in' | 'signed_out';

/** The actor recorded for what the server itself does at start. */
const SERVER_ACTOR = 'server';

export interface AccountStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

export function createAccountStore(db: SqliteDatabase, options: AccountStoreOptions = {}): AccountStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const nowIso = () => now().toISOString();

  const byName = (username: string) => db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow | undefined;
  const byId = (id: string) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;

  const record = (accountId: string, kind: EventKind, actor: string) =>
    db.prepare('INSERT INTO account_events (account_id, kind, at, actor) VALUES (?, ?, ?, ?)').run(accountId, kind, nowIso(), actor);

  const revokeSessionsOf = (accountId: string) =>
    db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').run(nowIso(), accountId);

  const insertSession = (accountId: string, tokenHash: string, expiresAt: string) =>
    db
      .prepare('INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, accountId, nowIso(), expiresAt);

  const toSignIn = (row: AccountRow): SignInAccount => ({
    id: row.id,
    username: row.username,
    role: row.role,
    managedBy: row.managed_by,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password === 1,
    oneTimeExpiresAt: row.one_time_expires_at,
    disabledAt: row.disabled_at,
  });

  const summarize = (row: AccountRow): PersonSummary => {
    const at = nowIso();
    let status: PersonStatus = 'active';
    if (row.disabled_at !== null) status = 'disabled';
    else if (row.must_change_password === 1) status = (row.one_time_expires_at ?? '') > at ? 'waiting' : 'expired';
    const lastSignIn = db
      .prepare(`SELECT max(at) AS at FROM account_events WHERE account_id = ? AND kind = 'signed_in'`)
      .get(row.id) as { at: string | null };
    const open = db
      .prepare('SELECT count(*) AS n FROM account_sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?')
      .get(row.id, at) as { n: number };
    return {
      username: row.username,
      role: row.role,
      managedBy: row.managed_by,
      status,
      oneTimeExpiresAt: row.one_time_expires_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      lastSignInAt: lastSignIn.at,
      openSessions: open.n,
    };
  };

  /** The person a People-page action is about: they exist and were created in the app. */
  const appPerson = (username: string): AccountRow => {
    const row = byName(username);
    if (row === undefined) throw new PersonNotFoundError(`named "${username}"`);
    if (row.managed_by === 'server') throw new ServerManagedAccountError(username);
    return row;
  };

  return {
    findSession(token) {
      return readSession(db, token, nowIso());
    },

    findAccountForSignIn(username) {
      const row = byName(username);
      return row === undefined ? null : toSignIn(row);
    },

    findAccountById(id) {
      const row = byId(id);
      return row === undefined ? null : toSignIn(row);
    },

    listPeople() {
      const rows = db.prepare('SELECT * FROM accounts ORDER BY username').all() as unknown as AccountRow[];
      return rows.map(summarize);
    },

    createPersonAccount({ username, passwordHash, oneTimeExpiresAt, actor }) {
      const check = checkUsername(username);
      if (!check.ok) throw new AccountRuleError(check.message);
      return immediateTransaction(db, () => {
        if (byName(username) !== undefined) throw new UsernameTakenError(username);
        const id = newId();
        db.prepare(
          `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
           VALUES (?, ?, 'member', 'app', ?, 1, ?, NULL, ?, ?)`,
        ).run(id, username, passwordHash, oneTimeExpiresAt, nowIso(), actor);
        record(id, 'created', actor);
        return summarize(byId(id) as AccountRow);
      });
    },

    resetPersonPassword({ username, passwordHash, oneTimeExpiresAt, actor }) {
      return immediateTransaction(db, () => {
        const row = appPerson(username);
        db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 1, one_time_expires_at = ? WHERE id = ?').run(
          passwordHash,
          oneTimeExpiresAt,
          row.id,
        );
        revokeSessionsOf(row.id);
        record(row.id, 'password_reset', actor);
        return summarize(byId(row.id) as AccountRow);
      });
    },

    setPersonDisabled({ username, disabled, actor }) {
      return immediateTransaction(db, () => {
        const row = appPerson(username);
        if ((row.disabled_at !== null) === disabled) return summarize(row);
        if (disabled) {
          db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(nowIso(), row.id);
          revokeSessionsOf(row.id);
          record(row.id, 'disabled', actor);
        } else {
          db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(row.id);
          record(row.id, 'enabled', actor);
        }
        return summarize(byId(row.id) as AccountRow);
      });
    },

    changeOwnPassword({ accountId, expectedHash, newHash, newTokenHash, sessionExpiresAt }) {
      immediateTransaction(db, () => {
        const row = byId(accountId);
        if (row === undefined || row.disabled_at !== null) throw new PersonNotFoundError(`with this id`);
        if (row.managed_by === 'server') throw new ServerManagedAccountError(row.username);
        if (row.password_hash !== expectedHash) throw new PasswordChangedMeanwhileError();
        db.prepare('UPDATE accounts SET password_hash = ?, must_change_password = 0, one_time_expires_at = NULL WHERE id = ?').run(newHash, accountId);
        revokeSessionsOf(accountId);
        insertSession(accountId, newTokenHash, sessionExpiresAt);
        record(accountId, 'password_changed', row.username);
      });
    },

    openSession({ accountId, tokenHash, expiresAt }) {
      immediateTransaction(db, () => {
        const row = byId(accountId);
        if (row === undefined) throw new PersonNotFoundError('with this id');
        // The database refuses a session for a disabled account (account_sessions_need_enabled_account).
        insertSession(accountId, tokenHash, expiresAt);
        record(accountId, 'signed_in', row.username);
      });
    },

    closeSession(tokenHash) {
      immediateTransaction(db, () => {
        const open = db
          .prepare(
            `SELECT s.account_id, a.username FROM account_sessions s JOIN accounts a ON a.id = s.account_id
             WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
          )
          .get(tokenHash) as { account_id: string; username: string } | undefined;
        if (open === undefined) return;
        db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash);
        record(open.account_id, 'signed_out', open.username);
      });
    },

    serverAdminState(username) {
      const row = byName(username);
      if (row === undefined) return { existing: null, clash: false };
      if (row.managed_by === 'app') return { existing: null, clash: true };
      return { existing: { passwordHash: row.password_hash, disabled: row.disabled_at !== null }, clash: false };
    },

    bootstrapServerAdmin({ username, passwordHash }) {
      immediateTransaction(db, () => {
        const named = byName(username);
        if (named !== undefined && named.managed_by === 'app') {
          throw new AccountsSetupError(
            `the admin username "${username}" belongs to a person created in the app; set another RAAGENTS_ADMIN_USERNAME`,
          );
        }
        // Retire any other enabled admin from earlier settings first: the database allows one at a time.
        const others = db
          .prepare(`SELECT * FROM accounts WHERE managed_by = 'server' AND disabled_at IS NULL AND username <> ?`)
          .all(username) as unknown as AccountRow[];
        for (const other of others) {
          db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(nowIso(), other.id);
          revokeSessionsOf(other.id);
          record(other.id, 'disabled', SERVER_ACTOR);
        }
        if (named === undefined) {
          if (passwordHash === null) throw new AccountsSetupError('the admin from the server settings does not exist yet, so a password hash is needed');
          const id = newId();
          db.prepare(
            `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
             VALUES (?, ?, 'admin', 'server', ?, 0, NULL, NULL, ?, ?)`,
          ).run(id, username, passwordHash, nowIso(), SERVER_ACTOR);
          record(id, 'created', SERVER_ACTOR);
          return;
        }
        if (named.disabled_at !== null) {
          db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(named.id);
          record(named.id, 'enabled', SERVER_ACTOR);
        }
        if (passwordHash !== null && passwordHash !== named.password_hash) {
          db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(passwordHash, named.id);
          revokeSessionsOf(named.id);
          record(named.id, 'password_changed', SERVER_ACTOR);
        }
      });
    },

    touchHeartbeat() {
      db.prepare('INSERT INTO host_heartbeat (id, at) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at').run(nowIso());
    },
  };
}
