import 'server-only';
import { randomUUID } from 'node:crypto';
import { immediateTransaction } from '@/server/chat/schema';
import type { SqliteDatabase } from '@/server/db/sqlite';
import {
  checkEmail,
  checkUsername,
  normalizeEmail,
  usernameFromEmail,
  type AccountManagedBy,
  type AccountRole,
  type PersonStatus,
  type PersonSummary,
  type SessionView,
} from '@/shared/accounts';
import { NO_PASSWORD_HASH } from './crypto';
import { readSession } from './session-lookup';

// The accounts of a hosted copy, in the chat database (schema version 7), so the backup keeps them with the chats.
//
// Every write is one synchronous BEGIN IMMEDIATE transaction that checks its rule again inside, and records an event. A
// password is never hashed inside a transaction: the caller hashes first (src/server/accounts/crypto.ts) and passes the
// hash, so no transaction waits on the thread pool. The database enforces the same rules again (schema.ts).
//
// The writers have one door each (tests/structure/writer-allowlist.test.ts): the People page's handler creates, resets,
// disables and enables people; the password handler changes a person's own password; the sign-in handlers open and
// close sessions and bind company identities; the server's start hook writes the admin from the server settings and the
// heartbeat.
//
// Company sign-in (schema version 8): a person added by company e-mail has an identity row and no password; the first
// sign-in binds the provider's issuer and subject to it, and every later sign-in must bring the same pair.

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

export class EmailTakenError extends Error {
  constructor() {
    super('this e-mail address is already on the People page');
    this.name = 'EmailTakenError';
  }
}

/** The provider's subject does not match the one bound to the account, or is bound to another account. */
export class IdentityMismatchError extends Error {
  constructor() {
    super('this company identity does not match the one bound to the account');
    this.name = 'IdentityMismatchError';
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

/** What company sign-in needs to know about the account behind an e-mail address. */
export interface IdentityAccount {
  accountId: string;
  username: string;
  role: AccountRole;
  managedBy: AccountManagedBy;
  disabled: boolean;
  email: string;
  /** Null until the first sign-in binds the provider's issuer and subject. */
  issuer: string | null;
  subject: string | null;
  displayName: string | null;
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
  /** The account behind a company e-mail address (compared lower-cased), or null when it is not on the list. */
  findIdentityAccount(email: string): IdentityAccount | null;
  /** A member who signs in with the company account: no password, invited until the first sign-in. */
  addPersonByEmail(input: { email: string; actor: string }): PersonSummary;
  /** Binds the first sign-in's issuer and subject, once; later sign-ins must match and only refresh the display name. */
  bindIdentity(input: { accountId: string; issuer: string; subject: string; displayName: string | null }): void;
  /**
   * Clears the company identity bound to a person the admin added (their identity changed at the provider), ends their
   * sessions and records the admin; their next sign-in binds again. Nothing changes for a person who never signed in.
   */
  reinvitePerson(input: { username: string; actor: string }): PersonSummary;
  /** Records a refused company sign-in on the account. */
  noteIdentityRefusal(input: { accountId: string; reason: 'identity_mismatch' | 'disabled' }): void;
  /**
   * Makes `username` the one enabled admin from the server settings, signing in with the company account `email`: as
   * bootstrapServerAdmin, without a password. A new e-mail clears the binding and ends the admin's sessions.
   */
  bootstrapServerAdminByEmail(input: { username: string; email: string }): void;
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
type IdentityEventKind = 'added' | 'bound' | 'unbound' | 'email_changed' | 'refused_mismatch' | 'refused_disabled';

interface IdentityRow {
  account_id: string;
  email: string;
  issuer: string | null;
  subject: string | null;
  display_name: string | null;
}

/** The actor recorded for what the server itself does at start. */
const SERVER_ACTOR = 'server';
/** The actor recorded for a refused company sign-in. */
const SIGN_IN_ACTOR = 'sign-in';
const MAX_DISPLAY_NAME_CHARS = 120;

/** A display name the database can hold: one line, trimmed, at most 120 characters; null when nothing is left. */
function displayNameOf(value: string | null): string | null {
  if (value === null) return null;
  const line = [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_DISPLAY_NAME_CHARS).join('');
  return line === '' ? null : line.trimEnd();
}

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

  const recordIdentity = (accountId: string, kind: IdentityEventKind, actor: string) =>
    db.prepare('INSERT INTO account_identity_events (account_id, kind, at, actor) VALUES (?, ?, ?, ?)').run(accountId, kind, nowIso(), actor);

  const identityOf = (accountId: string) =>
    db.prepare('SELECT account_id, email, issuer, subject, display_name FROM account_identities WHERE account_id = ?').get(accountId) as
      | IdentityRow
      | undefined;
  const identityByEmail = (email: string) =>
    db.prepare('SELECT account_id, email, issuer, subject, display_name FROM account_identities WHERE email = ?').get(email) as
      | IdentityRow
      | undefined;
  const insertIdentity = (accountId: string, email: string) =>
    db.prepare('INSERT INTO account_identities (account_id, email, created_at) VALUES (?, ?, ?)').run(accountId, email, nowIso());

  /** Retires every enabled server admin except `username`: the database allows one at a time. */
  const retireOtherServerAdmins = (username: string) => {
    const others = db
      .prepare(`SELECT * FROM accounts WHERE managed_by = 'server' AND disabled_at IS NULL AND username <> ?`)
      .all(username) as unknown as AccountRow[];
    for (const other of others) {
      db.prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(nowIso(), other.id);
      revokeSessionsOf(other.id);
      record(other.id, 'disabled', SERVER_ACTOR);
    }
  };

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
    const identity = identityOf(row.id);
    let status: PersonStatus = 'active';
    if (row.disabled_at !== null) status = 'disabled';
    else if (identity !== undefined && identity.subject === null) status = 'invited';
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
      signIn: identity === undefined ? 'password' : 'company',
      email: identity?.email ?? null,
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
        retireOtherServerAdmins(username);
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

    findIdentityAccount(email) {
      const identity = identityByEmail(normalizeEmail(email));
      if (identity === undefined) return null;
      const row = byId(identity.account_id) as AccountRow;
      return {
        accountId: row.id,
        username: row.username,
        role: row.role,
        managedBy: row.managed_by,
        disabled: row.disabled_at !== null,
        email: identity.email,
        issuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.display_name,
      };
    },

    addPersonByEmail({ email, actor }) {
      const normalized = normalizeEmail(email);
      const check = checkEmail(normalized);
      if (!check.ok) throw new AccountRuleError(check.message);
      return immediateTransaction(db, () => {
        if (identityByEmail(normalized) !== undefined) throw new EmailTakenError();
        const username = usernameFromEmail(normalized, (name) => byName(name) !== undefined);
        const id = newId();
        db.prepare(
          `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
           VALUES (?, ?, 'member', 'app', ?, 0, NULL, NULL, ?, ?)`,
        ).run(id, username, NO_PASSWORD_HASH, nowIso(), actor);
        record(id, 'created', actor);
        insertIdentity(id, normalized);
        recordIdentity(id, 'added', actor);
        return summarize(byId(id) as AccountRow);
      });
    },

    bindIdentity({ accountId, issuer, subject, displayName }) {
      const name = displayNameOf(displayName);
      immediateTransaction(db, () => {
        const identity = identityOf(accountId);
        if (identity === undefined) throw new PersonNotFoundError('with a company identity');
        if (identity.subject === null) {
          const holder = db.prepare('SELECT account_id FROM account_identities WHERE issuer = ? AND subject = ?').get(issuer, subject);
          if (holder !== undefined) throw new IdentityMismatchError();
          db.prepare('UPDATE account_identities SET issuer = ?, subject = ?, bound_at = ?, display_name = ? WHERE account_id = ?').run(
            issuer,
            subject,
            nowIso(),
            name,
            accountId,
          );
          recordIdentity(accountId, 'bound', (byId(accountId) as AccountRow).username);
          return;
        }
        if (identity.issuer !== issuer || identity.subject !== subject) throw new IdentityMismatchError();
        if (identity.display_name !== name) db.prepare('UPDATE account_identities SET display_name = ? WHERE account_id = ?').run(name, accountId);
      });
    },

    reinvitePerson({ username, actor }) {
      return immediateTransaction(db, () => {
        const row = appPerson(username);
        const identity = identityOf(row.id);
        if (identity === undefined) throw new AccountRuleError('This person signs in with a password: there is no company identity to clear.');
        if (identity.subject === null) return summarize(row);
        db.prepare('UPDATE account_identities SET issuer = NULL, subject = NULL, bound_at = NULL, display_name = NULL WHERE account_id = ?').run(row.id);
        revokeSessionsOf(row.id);
        recordIdentity(row.id, 'unbound', actor);
        return summarize(byId(row.id) as AccountRow);
      });
    },

    noteIdentityRefusal({ accountId, reason }) {
      recordIdentity(accountId, reason === 'identity_mismatch' ? 'refused_mismatch' : 'refused_disabled', SIGN_IN_ACTOR);
    },

    bootstrapServerAdminByEmail({ username, email }) {
      const normalized = normalizeEmail(email);
      immediateTransaction(db, () => {
        const named = byName(username);
        if (named !== undefined && named.managed_by === 'app') {
          throw new AccountsSetupError(
            `the admin username "${username}" belongs to a person created in the app; set another RAAGENTS_ADMIN_USERNAME`,
          );
        }
        const holder = identityByEmail(normalized);
        if (holder !== undefined && holder.account_id !== named?.id) {
          // The address itself stays out of the message: it goes to the log.
          throw new AccountsSetupError('the e-mail in RAAGENTS_ADMIN_EMAIL belongs to a person on the People page; disable them or set another');
        }
        retireOtherServerAdmins(username);
        if (named === undefined) {
          const id = newId();
          db.prepare(
            `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
             VALUES (?, ?, 'admin', 'server', ?, 0, NULL, NULL, ?, ?)`,
          ).run(id, username, NO_PASSWORD_HASH, nowIso(), SERVER_ACTOR);
          record(id, 'created', SERVER_ACTOR);
          insertIdentity(id, normalized);
          recordIdentity(id, 'added', SERVER_ACTOR);
          return;
        }
        if (named.disabled_at !== null) {
          db.prepare('UPDATE accounts SET disabled_at = NULL WHERE id = ?').run(named.id);
          record(named.id, 'enabled', SERVER_ACTOR);
        }
        if (named.password_hash !== NO_PASSWORD_HASH) {
          // An admin from earlier password settings: the password goes, and so do the sessions it opened.
          db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(NO_PASSWORD_HASH, named.id);
          revokeSessionsOf(named.id);
          record(named.id, 'password_changed', SERVER_ACTOR);
        }
        const identity = identityOf(named.id);
        if (identity === undefined) {
          insertIdentity(named.id, normalized);
          recordIdentity(named.id, 'added', SERVER_ACTOR);
        } else if (identity.email !== normalized) {
          db.prepare(
            'UPDATE account_identities SET email = ?, issuer = NULL, subject = NULL, bound_at = NULL, display_name = NULL WHERE account_id = ?',
          ).run(normalized, named.id);
          revokeSessionsOf(named.id);
          recordIdentity(named.id, 'email_changed', SERVER_ACTOR);
        }
      });
    },
  };
}
