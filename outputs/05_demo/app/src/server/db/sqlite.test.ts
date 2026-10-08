import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from './sqlite';

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
