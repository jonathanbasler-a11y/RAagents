import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_MEMORY_DATABASE, openDatabase, restrictDatabaseFiles, type SqliteDatabase } from './sqlite';

const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('openDatabase', () => {
  let dir: string;
  const opened: SqliteDatabase[] = [];
  const open = (...args: Parameters<typeof openDatabase>) => {
    const db = openDatabase(...args);
    opened.push(db);
    return db;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sqlite-test-'));
  });

  afterEach(() => {
    for (const db of opened.splice(0)) {
      if (db.isOpen) db.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the parent folders of a file database', () => {
    const file = join(dir, 'nested', 'deeper', 'chat.db');

    open(file);

    expect(existsSync(file)).toBe(true);
  });

  it('switches a file database to WAL', () => {
    const db = open(join(dir, 'chat.db'));

    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });

  it('sets a 5 second busy timeout by default, or the one asked for', () => {
    const byDefault = open(join(dir, 'a.db'));
    const custom = open(join(dir, 'b.db'), { busyTimeoutMs: 250 });

    expect(byDefault.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    expect(custom.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 250 });
  });

  it('refuses a busy timeout that is not a non-negative integer', () => {
    expect(() => open(join(dir, 'c.db'), { busyTimeoutMs: -1 })).toThrow(RangeError);
    expect(() => open(join(dir, 'd.db'), { busyTimeoutMs: 1.5 })).toThrow(RangeError);
  });

  it('enforces foreign keys', () => {
    const db = open(join(dir, 'chat.db'));

    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('keeps data across connections to the same file', () => {
    const file = join(dir, 'chat.db');
    const writer = open(file);
    writer.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)');
    writer.prepare('INSERT INTO notes (text) VALUES (?)').run('kept');
    writer.close();

    const reader = open(file);

    expect(reader.prepare('SELECT text FROM notes').all()).toEqual([{ text: 'kept' }]);
  });

  it('opens an in-memory database without touching the file system', () => {
    const db = open(IN_MEMORY_DATABASE);

    expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
    expect(existsSync(IN_MEMORY_DATABASE)).toBe(false);
  });

  it('refuses an empty path, which SQLite would open as a throwaway temporary database', () => {
    expect(() => open('')).toThrow(/file path/);
    expect(() => open('   ')).toThrow(/file path/);
  });

  it('fails loudly when the runtime has no node:sqlite', () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as never);

    expect(() => open(join(dir, 'chat.db'))).toThrow(/node:sqlite is not available/);
  });
});

// File modes mean nothing on Windows.
describe.skipIf(process.platform === 'win32')('openDatabase: file permissions', () => {
  let dir: string;
  const opened: SqliteDatabase[] = [];
  const open = (file: string) => {
    const db = openDatabase(file);
    opened.push(db);
    return db;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sqlite-perm-'));
  });

  afterEach(() => {
    for (const db of opened.splice(0)) {
      if (db.isOpen) db.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database folder, and the folders above it that it creates, readable by its owner only (0700)', () => {
    const file = join(dir, 'data', 'nested', 'chat.db');

    open(file);

    expect(modeOf(join(dir, 'data'))).toBe(0o700);
    expect(modeOf(join(dir, 'data', 'nested'))).toBe(0o700);
  });

  it('leaves the mode of a folder that already exists alone', () => {
    const existing = join(dir, 'shared');
    mkdirSync(existing);
    chmodSync(existing, 0o755);

    open(join(existing, 'chat.db'));

    expect(modeOf(existing)).toBe(0o755);
  });

  it('restricts the database file to its owner (0600), whatever the umask gave it', () => {
    const file = join(dir, 'chat.db');

    open(file);

    expect(modeOf(file)).toBe(0o600);
  });

  it('tightens a database file that already exists with a looser mode', () => {
    const file = join(dir, 'chat.db');
    open(file).close();
    chmodSync(file, 0o644);

    open(file);

    expect(modeOf(file)).toBe(0o600);
  });

  it('restricts the -wal and -shm files too while they exist', () => {
    const file = join(dir, 'chat.db');
    const db = open(file);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO notes DEFAULT VALUES').run();

    expect(existsSync(`${file}-wal`)).toBe(true);
    expect(modeOf(`${file}-wal`)).toBe(0o600);
    // A second connection recreates nothing, but still tightens what is there.
    chmodSync(`${file}-wal`, 0o644);
    if (existsSync(`${file}-shm`)) chmodSync(`${file}-shm`, 0o644);
    open(file);
    expect(modeOf(`${file}-wal`)).toBe(0o600);
    if (existsSync(`${file}-shm`)) expect(modeOf(`${file}-shm`)).toBe(0o600);
  });

  it('does not create files for an in-memory database', () => {
    open(IN_MEMORY_DATABASE);

    expect(existsSync(IN_MEMORY_DATABASE)).toBe(false);
    expect(existsSync(`${IN_MEMORY_DATABASE}-wal`)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('restrictDatabaseFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sqlite-restrict-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets 0600 on the file and on the -wal and -shm files that exist, and returns nothing failed', () => {
    const file = join(dir, 'chat.db');
    for (const path of [file, `${file}-wal`]) writeFileSync(path, 'x', { mode: 0o644 });

    expect(restrictDatabaseFiles(file)).toEqual([]);
    expect(modeOf(file)).toBe(0o600);
    expect(modeOf(`${file}-wal`)).toBe(0o600);
    expect(existsSync(`${file}-shm`)).toBe(false);
  });

  it('reports a database file it could not restrict instead of hiding it', () => {
    // A missing main file cannot be restricted. The -wal and -shm files may legitimately be absent.
    expect(restrictDatabaseFiles(join(dir, 'missing.db'))).toEqual(['missing.db']);
  });
});
