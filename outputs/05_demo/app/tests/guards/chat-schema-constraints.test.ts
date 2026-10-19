import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '@/server/chat/store';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type { Store } from '@/shared/contracts';

// Mutation sweep, guards 5 and 9 (BUILD-LEARNINGS Part 9.11): what the chat database enforces
// itself. store.test.ts already proves the triggers, the room lock, the client turn id and
// most checks with raw connections. Dropping any of the four constraints below left the whole
// suite green, so each gets the same kind of test: a raw insert the database must refuse, and a
// positive control the database must accept. The code never writes such rows; these tests keep
// it that way if a later change does.

const START = '2026-10-07T10:00:00.000Z';
const DEADLINE = '2026-10-07T10:03:00.000Z';

let dir: string;
let dbPath: string;
const stores: Store[] = [];
const rawConnections: SqliteDatabase[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chat-schema-guards-'));
  dbPath = join(dir, 'chat.db');
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of rawConnections.splice(0)) {
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A store with one running turn, and a plain connection to the same file below it. */
function openWithOneTurn() {
  let count = 0;
  const store = createStore(dbPath, { now: () => new Date(START), newId: () => `id-${++count}` });
  stores.push(store);
  const { turn, thread } = store.startTurn({
    workspaceId: 'demo',
    roomId: 'team',
    clientTurnId: 'client-1',
    bootId: 'boot-a',
    deadlineAt: DEADLINE,
  });
  const raw = openDatabase(dbPath);
  rawConnections.push(raw);
  return { raw, turn, thread };
}

describe('messages: the database refuses rows the code never writes', () => {
  const insertMessage = (raw: SqliteDatabase) =>
    raw.prepare(
      `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
       VALUES (?, ?, ?, 'team', ?, ?, 'derived', 'complete', ?, 'text', ?)`,
    );

  it('refuses an author other than human, agent or note', () => {
    const { raw, turn, thread } = openWithOneTurn();
    const insert = insertMessage(raw);

    expect(() => insert.run('by-system', thread.id, turn.id, 10, 'system', 0, START)).toThrow(/CHECK/);
    expect(() => insert.run('by-note', thread.id, turn.id, 11, 'note', 0, START)).not.toThrow();
  });

  it('refuses a truncated flag other than 0 or 1', () => {
    const { raw, turn, thread } = openWithOneTurn();
    const insert = insertMessage(raw);

    expect(() => insert.run('cut-twice', thread.id, turn.id, 10, 'note', 2, START)).toThrow(/CHECK/);
    expect(() => insert.run('cut-once', thread.id, turn.id, 11, 'note', 1, START)).not.toThrow();
  });

  it('refuses two messages at the same place in a thread', () => {
    const { raw, turn, thread } = openWithOneTurn();
    const insert = insertMessage(raw);

    expect(() => insert.run('first', thread.id, turn.id, 10, 'note', 0, START)).not.toThrow();
    expect(() => insert.run('second', thread.id, turn.id, 10, 'note', 0, START)).toThrow(/UNIQUE/);
    expect(() => insert.run('third', thread.id, turn.id, 11, 'note', 0, START)).not.toThrow();
  });
});

describe('turns: the database refuses two turns at the same place in a thread', () => {
  it('refuses a second turn with the same sequence number, and accepts the next one', () => {
    const { raw, thread } = openWithOneTurn();
    const insert = raw.prepare(
      `INSERT INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, ended_at, deadline_at)
       VALUES (?, ?, 'demo', 'team', ?, ?, 'done', 'boot-a', ?, ?, ?)`,
    );

    expect(() => insert.run('turn-a', thread.id, 5, 'client-a', START, START, DEADLINE)).not.toThrow();
    expect(() => insert.run('turn-b', thread.id, 5, 'client-b', START, START, DEADLINE)).toThrow(/UNIQUE/);
    expect(() => insert.run('turn-c', thread.id, 6, 'client-c', START, START, DEADLINE)).not.toThrow();
  });
});

describe('dd_setup: the database refuses rows the code never writes', () => {
  const insertSetup = (raw: SqliteDatabase) =>
    raw.prepare('INSERT INTO dd_setup (workspace_id, stage, classifications, updated_at) VALUES (?, ?, ?, ?)');

  it('refuses a stage that is not a development stage, and accepts one that is (positive control)', () => {
    const { raw } = openWithOneTurn();
    const insert = insertSetup(raw);

    expect(() => insert.run('ws-a', 'Phase 4', '[]', START)).toThrow(/CHECK/);
    expect(() => insert.run('ws-b', 'phase 2', '[]', START)).toThrow(/CHECK/);
    expect(() => insert.run('ws-c', 'Phase 2', '["orphan"]', START)).not.toThrow();
  });

  it('refuses classifications that are not a JSON array', () => {
    const { raw } = openWithOneTurn();
    const insert = insertSetup(raw);

    expect(() => insert.run('ws-a', 'Phase 2', 'orphan', START)).toThrow(/CHECK/);
    expect(() => insert.run('ws-b', 'Phase 2', '{"orphan":true}', START)).toThrow(/CHECK/);
    expect(() => insert.run('ws-c', 'Phase 2', '"orphan"', START)).toThrow(/CHECK/);
    expect(() => insert.run('ws-d', 'Phase 2', '[]', START)).not.toThrow();
  });

  it('keeps one setup per workspace', () => {
    const { raw } = openWithOneTurn();
    const insert = insertSetup(raw);

    expect(() => insert.run('ws-a', 'Phase 2', '[]', START)).not.toThrow();
    expect(() => insert.run('ws-a', 'Filed', '[]', START)).toThrow(/UNIQUE|PRIMARY/);
  });
});
