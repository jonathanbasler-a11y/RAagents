import 'server-only';
import { createHash } from 'node:crypto';
import { defaultChatDbPath } from '@/server/db/paths';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type { AccountManagedBy, AccountRole, SessionView } from '@/shared/accounts';

// The read side of sign-in, for the proxy (src/proxy.ts): one primary-key read per request, never a write. It holds its
// own connection, opened on first use, so the proxy never loads the chat store. The tables are created by the server's
// start hook (src/instrumentation.ts) before the first request; until then every lookup refuses.
//
// The connection is shared through globalThis with the account store (src/server/accounts/runtime.ts), so a process opens
// it once even when Next.js loads this module in several bundles. WAL lets readers see each committed write at once.

const DB_KEY = Symbol.for('hybrid-team-chat.accounts-db');

type DbHolder = { [DB_KEY]?: { path: string; db: SqliteDatabase } };

/** The SHA-256 (hex) the database keeps instead of a session token. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The shape of a session token: 32 bytes as base64url. Anything else is never looked up. */
export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The only session query. A session counts while it is not revoked, not expired and its account is enabled. */
const SESSION_SQL = `
  SELECT a.id AS account_id, a.username, a.role, a.managed_by, a.must_change_password, s.expires_at
  FROM account_sessions s JOIN accounts a ON a.id = s.account_id
  WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.disabled_at IS NULL`;

interface SessionRow {
  account_id: string;
  username: string;
  role: AccountRole;
  managed_by: AccountManagedBy;
  must_change_password: number;
  expires_at: string;
}

/** The person behind a session token, or null. */
export function readSession(db: SqliteDatabase, token: string, nowIso: string): SessionView | null {
  if (!isSessionToken(token)) return null;
  const row = db.prepare(SESSION_SQL).get(tokenHash(token), nowIso) as SessionRow | undefined;
  if (row === undefined) return null;
  return {
    accountId: row.account_id,
    username: row.username,
    role: row.role,
    managedBy: row.managed_by,
    mustChangePassword: row.must_change_password === 1,
    expiresAt: row.expires_at,
  };
}

/** This process's connection to the chat database for accounts; reopened when the file changes (tests). No migration here. */
export function accountsDb(file: string = defaultChatDbPath()): SqliteDatabase {
  const holder = globalThis as DbHolder;
  const held = holder[DB_KEY];
  if (held !== undefined && held.path === file && held.db.isOpen) return held.db;
  if (held?.db.isOpen) held.db.close();
  const db = openDatabase(file);
  holder[DB_KEY] = { path: file, db };
  return db;
}

/** Closes the shared connection (tests; the next use opens it again). */
export function closeAccountsDb(): void {
  const holder = globalThis as DbHolder;
  const held = holder[DB_KEY];
  if (held?.db.isOpen) held.db.close();
  delete holder[DB_KEY];
}

let lastWarnedAt = Number.NEGATIVE_INFINITY;

/**
 * For the proxy: the person behind the session cookie, or null. Any error (tables not there yet, a locked or missing file)
 * is null, so the request is refused; one log line a minute at most says why.
 */
export function findSessionForProxy(token: string | null, now: Date, log: Pick<Console, 'warn'> = console): SessionView | null {
  if (token === null || !isSessionToken(token)) return null;
  try {
    return readSession(accountsDb(), token, now.toISOString());
  } catch (error) {
    if (now.getTime() - lastWarnedAt >= 60_000) {
      lastWarnedAt = now.getTime();
      log.warn(`[accounts] could not read the sessions, so the request was refused: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
