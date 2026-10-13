import { afterEach, describe, expect, it } from 'vitest';
import { migrateChatSchema } from '@/server/chat/schema';
import { IN_MEMORY_DATABASE, openDatabase, type SqliteDatabase } from '@/server/db/sqlite';

// Mutation sweep, guard 9 (BUILD-LEARNINGS Part 9.11): the append-only triggers also have to
// hold against INSERT OR REPLACE. SQLite's REPLACE conflict handling deletes the old row first,
// and it runs the delete trigger only when recursive triggers are on. Without that, a REPLACE
// with an existing id silently rewrote a saved message, turn or thread. The code never does
// this; these tests keep a later change from being able to.

let db: SqliteDatabase | undefined;

afterEach(() => {
  if (db?.isOpen) db.close();
  db = undefined;
});

/** A database opened the way the app opens it, with one thread, one finished turn and one message. */
function openWithOneMessage(): SqliteDatabase {
  const opened = openDatabase(IN_MEMORY_DATABASE);
  db = opened;
  migrateChatSchema(opened);
  opened.exec(`INSERT INTO threads (id, room, created_at) VALUES ('thread-1', 'team', 'now')`);
  opened.exec(
    `INSERT INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, ended_at, deadline_at)
     VALUES ('turn-1', 'thread-1', 'demo', 'team', 1, 'client-1', 'done', 'boot', 'now', 'now', 'now')`,
  );
  opened.exec(
    `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
     VALUES ('message-1', 'thread-1', 'turn-1', 'team', 1, 'human', 'derived', 'complete', 0, 'original', 'now')`,
  );
  return opened;
}

const content = (opened: SqliteDatabase) =>
  (opened.prepare(`SELECT content FROM messages WHERE id = 'message-1'`).get() as { content: string }).content;

describe('the database opened by the app keeps its append-only rows against REPLACE', () => {
  it('turns recursive triggers on, which is what makes the delete trigger fire inside a REPLACE', () => {
    const opened = openDatabase(IN_MEMORY_DATABASE);
    db = opened;

    expect(opened.prepare('PRAGMA recursive_triggers').get()).toEqual({ recursive_triggers: 1 });
  });

  it('refuses INSERT OR REPLACE and REPLACE INTO over a saved message, which keeps its text', () => {
    const opened = openWithOneMessage();
    const replace = (verb: string, text: string) =>
      opened.exec(
        `${verb} INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
         VALUES ('message-1', 'thread-1', 'turn-1', 'team', 1, 'human', 'derived', 'complete', 0, '${text}', 'now')`,
      );

    expect(() => replace('INSERT OR REPLACE', 'rewritten')).toThrow(/append-only/);
    expect(() => replace('REPLACE', 'rewritten again')).toThrow(/append-only/);
    expect(content(opened)).toBe('original');
  });

  it('refuses a REPLACE that takes over another message place in the thread', () => {
    const opened = openWithOneMessage();

    expect(() =>
      opened.exec(
        `INSERT OR REPLACE INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
         VALUES ('message-2', 'thread-1', 'turn-1', 'team', 1, 'note', 'derived', 'complete', 0, 'takes the place', 'now')`,
      ),
    ).toThrow(/append-only/);
    expect(content(opened)).toBe('original');
  });

  it('refuses a REPLACE over a finished turn and over a thread', () => {
    const opened = openWithOneMessage();

    expect(() =>
      opened.exec(
        `INSERT OR REPLACE INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, ended_at, deadline_at)
         VALUES ('turn-1', 'thread-1', 'demo', 'team', 1, 'client-1', 'error', 'boot', 'now', 'now', 'now')`,
      ),
    ).toThrow(/never deleted/);
    expect(() =>
      opened.exec(`INSERT OR REPLACE INTO threads (id, room, created_at) VALUES ('thread-1', 'other', 'now')`),
    ).toThrow(/never deleted/);

    expect(opened.prepare(`SELECT status FROM turns WHERE id = 'turn-1'`).get()).toEqual({ status: 'done' });
    expect(opened.prepare(`SELECT room FROM threads WHERE id = 'thread-1'`).get()).toEqual({ room: 'team' });
  });

  it('still accepts a new message at a free place (positive control)', () => {
    const opened = openWithOneMessage();

    expect(() =>
      opened.exec(
        `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
         VALUES ('message-3', 'thread-1', 'turn-1', 'team', 2, 'note', 'derived', 'complete', 0, 'next', 'now')`,
      ),
    ).not.toThrow();
    expect(opened.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 });
  });
});
