import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { closeAccountsDb, findSessionForProxy, isSessionToken, readSession, tokenHash } from './session-lookup';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const TOKEN = 'A'.repeat(43);

const dirs: string[] = [];
const writers: SqliteDatabase[] = [];

afterEach(() => {
  closeAccountsDb();
  vi.unstubAllEnvs();
  for (const db of writers.splice(0)) if (db.isOpen) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A database file with one member and one session, through a connection of its own (as a route handler would write). */
function databaseWithSession(options: { expiresAt?: string; revoked?: boolean; disabled?: boolean; migrate?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-lookup-'));
  dirs.push(dir);
  const file = path.join(dir, 'chat.db');
  const writer = openDatabase(file);
  writers.push(writer);
  if (options.migrate === false) return { file, writer };
  migrateChatSchema(writer);
  writer
    .prepare(
      `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
       VALUES ('acc-1', 'member-one', 'member', 'app', 'scrypt$x', 0, NULL, ?, '2026-10-29T08:00:00.000Z', 'admin')`,
    )
    .run(options.disabled ? '2026-10-29T09:00:00.000Z' : null);
  if (options.disabled) return { file, writer };
  writer
    .prepare(`INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at, revoked_at) VALUES (?, 'acc-1', ?, ?, ?)`)
    .run(tokenHash(TOKEN), '2026-10-29T10:00:00.000Z', options.expiresAt ?? '2026-10-29T22:00:00.000Z', options.revoked ? '2026-10-29T11:00:00.000Z' : null);
  return { file, writer };
}

describe('readSession', () => {
  it('returns the person behind a valid session', () => {
    const { writer } = databaseWithSession();
    expect(readSession(writer, TOKEN, NOW.toISOString())).toEqual({
      accountId: 'acc-1',
      username: 'member-one',
      role: 'member',
      managedBy: 'app',
      mustChangePassword: false,
      expiresAt: '2026-10-29T22:00:00.000Z',
    });
  });

  it('returns nothing for a revoked, expired or unknown session', () => {
    expect(readSession(databaseWithSession({ revoked: true }).writer, TOKEN, NOW.toISOString())).toBeNull();
    expect(readSession(databaseWithSession({ expiresAt: NOW.toISOString() }).writer, TOKEN, NOW.toISOString())).toBeNull();
    expect(readSession(databaseWithSession().writer, 'B'.repeat(43), NOW.toISOString())).toBeNull();
  });

  it('returns nothing for the session of a disabled account', () => {
    const { writer } = databaseWithSession();
    writer.exec(`UPDATE accounts SET disabled_at = '2026-10-29T11:30:00.000Z' WHERE id = 'acc-1'`);
    expect(readSession(writer, TOKEN, NOW.toISOString())).toBeNull();
  });
});

describe('findSessionForProxy', () => {
  it('reads the database named by CHAT_DB_PATH', () => {
    const { file } = databaseWithSession();
    vi.stubEnv('CHAT_DB_PATH', file);
    expect(findSessionForProxy(TOKEN, NOW)?.username).toBe('member-one');
  });

  it('sees a revocation written through another connection on the very next read', () => {
    const { file, writer } = databaseWithSession();
    vi.stubEnv('CHAT_DB_PATH', file);
    expect(findSessionForProxy(TOKEN, NOW)).not.toBeNull();
    writer.prepare(`UPDATE account_sessions SET revoked_at = ? WHERE token_hash = ?`).run(NOW.toISOString(), tokenHash(TOKEN));
    expect(findSessionForProxy(TOKEN, NOW)).toBeNull();
  });

  it('refuses, without throwing, while the account tables do not exist yet', () => {
    const { file } = databaseWithSession({ migrate: false });
    vi.stubEnv('CHAT_DB_PATH', file);
    const log = { warn: vi.fn() };
    expect(findSessionForProxy(TOKEN, NOW, log)).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('does not touch the database for a missing or malformed cookie', () => {
    vi.stubEnv('CHAT_DB_PATH', '/nonexistent/folder/chat.db');
    expect(findSessionForProxy(null, NOW)).toBeNull();
    expect(findSessionForProxy('not-a-token', NOW)).toBeNull();
  });

  it('opens the new file when CHAT_DB_PATH changes', () => {
    const first = databaseWithSession();
    vi.stubEnv('CHAT_DB_PATH', first.file);
    expect(findSessionForProxy(TOKEN, NOW)).not.toBeNull();
    const second = databaseWithSession({ revoked: true });
    vi.stubEnv('CHAT_DB_PATH', second.file);
    expect(findSessionForProxy(TOKEN, NOW)).toBeNull();
  });
});

describe('session tokens', () => {
  it('are 43 base64url characters, and the database keeps only their SHA-256', () => {
    expect(isSessionToken(TOKEN)).toBe(true);
    expect(isSessionToken('A'.repeat(42))).toBe(false);
    expect(isSessionToken(`${'A'.repeat(42)}=`)).toBe(false);
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
