import 'server-only';
import { chmodSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type SqliteDatabase = DatabaseSync;

export const IN_MEMORY_DATABASE = ':memory:';

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/** Folders this module creates are for the owner only; the database holds every chat message. */
const DATABASE_DIR_MODE = 0o700;
const DATABASE_FILE_MODE = 0o600;

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
 * Sets the database file (and its -wal and -shm files, while they exist) to owner-only access.
 * Returns the base names of the files it could not restrict: an absent database file, or any
 * chmod that failed (for example on a file system without permissions). Absent -wal and -shm
 * files are normal and not reported.
 */
export function restrictDatabaseFiles(filePath: string): string[] {
  const failed: string[] = [];
  for (const [path, required] of [
    [filePath, true],
    [`${filePath}-wal`, false],
    [`${filePath}-shm`, false],
  ] as const) {
    try {
      chmodSync(path, DATABASE_FILE_MODE);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (required || !missing) failed.push(basename(path));
    }
  }
  return failed;
}

/**
 * Opens (and creates if needed) a SQLite database file.
 * - creates the parent folder (mode 0700; an existing folder keeps its mode);
 * - restricts the file to its owner (mode 0600), including the -wal and -shm files;
 * - switches a file database to WAL, and throws if SQLite refuses;
 * - sets the busy timeout, enforces foreign keys and turns recursive triggers on (so that a
 *   delete trigger also fires for the delete inside INSERT OR REPLACE).
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
  if (!inMemory) mkdirSync(dirname(filePath), { recursive: true, mode: DATABASE_DIR_MODE });

  const db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    // INSERT OR REPLACE deletes the old row first, and SQLite runs a delete trigger for that only
    // with recursive triggers on. Without it the append-only triggers do not stop a REPLACE.
    db.exec('PRAGMA recursive_triggers = ON');
    if (!inMemory) {
      const row = db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: unknown } | undefined;
      if (row?.journal_mode !== 'wal') {
        throw new Error(`SQLite refused WAL mode for ${filePath} (journal_mode is ${String(row?.journal_mode)})`);
      }
      // SQLite gives the -wal and -shm files the main file's mode when it creates them later.
      const failed = restrictDatabaseFiles(filePath);
      if (failed.length > 0) console.warn(`[db] could not restrict the permissions of: ${failed.join(', ')}`);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
