import 'server-only';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type SqliteDatabase = DatabaseSync;

export const IN_MEMORY_DATABASE = ':memory:';

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenDatabaseOptions {
  /** How long a connection waits for a lock before failing with SQLITE_BUSY. Default 5000 ms. */
  busyTimeoutMs?: number;
}

type SqliteModule = typeof import('node:sqlite');

// node:sqlite is loaded at run time through process.getBuiltinModule, never through an
// import statement, so the bundler never tries to resolve it. Only the type import above
// names the module, and type imports are erased before bundling.
function loadSqlite(): SqliteModule {
  const sqlite: SqliteModule | undefined =
    typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:sqlite') : undefined;
  if (!sqlite?.DatabaseSync) {
    throw new Error(
      `node:sqlite is not available in this runtime (Node ${process.version}). The app needs Node 24 or newer.`,
    );
  }
  return sqlite;
}

/**
 * Opens (and creates if needed) a SQLite database file.
 * - creates the parent folder;
 * - switches a file database to WAL, and throws if SQLite refuses;
 * - sets the busy timeout and enforces foreign keys.
 * Pass IN_MEMORY_DATABASE for a throwaway database (no WAL, nothing on disk).
 * The caller owns the connection and closes it.
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  if (filePath.trim() === '') {
    throw new TypeError(`openDatabase needs a file path or "${IN_MEMORY_DATABASE}"`);
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(`busyTimeoutMs must be a non-negative integer; got ${busyTimeoutMs}`);
  }

  const { DatabaseSync } = loadSqlite();
  const inMemory = filePath === IN_MEMORY_DATABASE;
  if (!inMemory) mkdirSync(dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    if (!inMemory) {
      const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: unknown } | undefined;
      if (row?.journal_mode !== 'wal') {
        throw new Error(`SQLite refused WAL mode for ${filePath} (journal_mode is ${String(row?.journal_mode)})`);
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
