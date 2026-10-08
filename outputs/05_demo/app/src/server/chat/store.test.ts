import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type {
  AppendAgentMessageInput,
  Message,
  MessageAuthor,
  StartTurnInput,
  Store,
  TurnTrace,
} from '@/shared/contracts';
import { CHAT_MIGRATIONS, migrateChatSchema } from './schema';
import { createStore, RoomBusyError, toPromptHistory } from './store';

// Every test gets a fresh folder and database file, a frozen clock it moves by hand, and
// predictable ids. Raw connections (openRaw) reach under the store to check what the
// database itself enforces.

const START = '2026-10-07T10:00:00.000Z';
const DEADLINE = '2026-10-07T10:03:00.000Z';

let dir: string;
let dbPath: string;
let clockMs: number;
let idCount: number;
const stores: Store[] = [];
const rawConnections: SqliteDatabase[] = [];

const now = () => new Date(clockMs);
const newId = () => `id-${++idCount}`;
const advance = (ms: number) => {
  clockMs += ms;
};

/** A store on this test's database file. Each call opens another connection. */
function openStore(): Store {
  const store = createStore(dbPath, { now, newId });
  stores.push(store);
  return store;
}

/** A plain connection to this test's database file, below the store. */
function openRaw(): SqliteDatabase {
  const db = openDatabase(dbPath);
  rawConnections.push(db);
  return db;
}

function turnInput(overrides: Partial<StartTurnInput> = {}): StartTurnInput {
  return {
    workspaceId: 'demo',
    roomId: 'team',
    clientTurnId: 'client-1',
    bootId: 'boot-a',
    deadlineAt: DEADLINE,
    ...overrides,
  };
}

const SOLO_TRACE: TurnTrace = {
  route: { source: 'direct', primary: 'reglead', secondaries: [], notConsulted: [], notes: [], synthesis: false },
  agents: [
    {
      agentId: 'reglead',
      agentName: 'Rosa',
      role: 'solo',
      state: 'answered',
      messageId: 'reply-1',
      model: 'model-x',
      durationMs: 1200,
    },
  ],
};

const NOBODY_TRACE: TurnTrace = {
  route: { source: 'none', secondaries: [], notConsulted: [], notes: ['No agent matched.'], synthesis: false },
  agents: [],
};

function agentReply(turnId: string, overrides: Partial<AppendAgentMessageInput> = {}): AppendAgentMessageInput {
  return {
    id: 'reply-1',
    turnId,
    agentId: 'reglead',
    agentName: 'Rosa',
    agentVersion: '1.0.0',
    promptHash: 'sha256:abc',
    model: 'model-x',
    text: 'An answer.',
    status: 'complete',
    truncated: false,
    ...overrides,
  };
}

/** Runs `action` and returns what it threw (undefined if nothing). */
function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

const versionOf = (db: SqliteDatabase) => db.prepare('PRAGMA user_version').get()?.user_version;
const tablesOf = (db: SqliteDatabase) =>
  db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chat-store-'));
  dbPath = join(dir, 'chat.db');
  clockMs = Date.parse(START);
  idCount = 0;
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of rawConnections.splice(0)) {
    if (db.isOpen) db.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('createStore: schema and migrations', () => {
  it('creates the chat tables in a new database and records the schema version', () => {
    openStore();
    const raw = openRaw();

    expect(tablesOf(raw)).toEqual(expect.arrayContaining(['messages', 'selection', 'threads', 'turns']));
    expect(CHAT_MIGRATIONS.length).toBeGreaterThan(0);
    expect(versionOf(raw)).toBe(CHAT_MIGRATIONS.length);
  });

  it('refuses a database written by a newer version of the app, and leaves it untouched', () => {
    const raw = openRaw();
    raw.exec('PRAGMA user_version = 99');

    expect(() => openStore()).toThrow(/newer/);
    expect(versionOf(raw)).toBe(99);
    expect(tablesOf(raw)).toEqual([]);
  });

  it('applies only the migrations a database is missing', () => {
    const raw = openRaw();
    const first = 'CREATE TABLE a (x INTEGER) STRICT';
    const second = 'CREATE TABLE b (y INTEGER) STRICT';

    migrateChatSchema(raw, [first]);
    // Running `first` again would throw "table a already exists".
    migrateChatSchema(raw, [first, second]);

    expect(versionOf(raw)).toBe(2);
    expect(tablesOf(raw)).toEqual(['a', 'b']);
  });

  it('rolls back a failed migration together with its version bump', () => {
    const raw = openRaw();
    const good = 'CREATE TABLE a (x INTEGER) STRICT';
    const bad = 'CREATE TABLE b (y INTEGER) STRICT; CREATE TABLE broken (';

    expect(() => migrateChatSchema(raw, [good, bad])).toThrow();

    expect(versionOf(raw)).toBe(1);
    expect(tablesOf(raw)).toEqual(['a']);
  });
});

describe('closing', () => {
  it('closes the database, and closing again is harmless', () => {
    const store = openStore();

    store.close();

    expect(() => store.close()).not.toThrow();
    expect(() => store.getActiveThread('demo', 'team')).toThrow();
  });
});

describe('threads', () => {
  it("creates a room's active thread on first use and returns the same thread afterwards", () => {
    const store = openStore();

    const first = store.getActiveThread('demo', 'team');
    advance(60_000);
    const again = store.getActiveThread('demo', 'team');

    expect(first).toEqual({
      id: expect.any(String),
      workspaceId: 'demo',
      roomId: 'team',
      status: 'active',
      createdAt: START,
      archivedAt: null,
    });
    expect(again).toEqual(first);
  });

  it('keeps a separate thread per room and per workspace', () => {
    const store = openStore();

    const team = store.getActiveThread('demo', 'team');
    const reglead = store.getActiveThread('demo', 'reglead');
    const otherCase = store.getActiveThread('case-2', 'team');

    expect(new Set([team.id, reglead.id, otherCase.id]).size).toBe(3);
    expect(reglead).toMatchObject({ workspaceId: 'demo', roomId: 'reglead' });
    expect(otherCase).toMatchObject({ workspaceId: 'case-2', roomId: 'team' });
  });

  it('finds the same active thread from another connection and after reopening the file', () => {
    const thread = openStore().getActiveThread('demo', 'team');

    expect(openStore().getActiveThread('demo', 'team')).toEqual(thread);
  });

  it('refuses an empty workspace or room id', () => {
    const store = openStore();

    expect(() => store.getActiveThread('', 'team')).toThrow(TypeError);
    expect(() => store.getActiveThread('demo', '  ')).toThrow(TypeError);
  });

  it('allows only one active thread per room in the database itself', () => {
    openStore().getActiveThread('demo', 'team');
    const raw = openRaw();
    const insert = raw.prepare(
      'INSERT INTO threads (id, workspace_id, room, created_at, archived_at) VALUES (?, ?, ?, ?, ?)',
    );

    expect(() => insert.run('second-active', 'demo', 'team', START, null)).toThrow(/UNIQUE/);
    // Positive control: an archived thread for the same room is fine.
    expect(() => insert.run('archived', 'demo', 'team', START, START)).not.toThrow();
  });
});

describe('starting turns', () => {
  it("starts a running turn in the room's active thread", () => {
    const store = openStore();

    const result = store.startTurn(turnInput());

    expect(result.created).toBe(true);
    expect(result.thread).toEqual(store.getActiveThread('demo', 'team'));
    expect(result.turn).toEqual({
      id: expect.any(String),
      threadId: result.thread.id,
      workspaceId: 'demo',
      roomId: 'team',
      clientTurnId: 'client-1',
      status: 'running',
      bootId: 'boot-a',
      trace: null,
      deadlineAt: DEADLINE,
      startedAt: START,
      finishedAt: null,
      errorCode: null,
      correlationId: null,
    });
    expect(store.getTurn(result.turn.id)).toEqual(result.turn);
  });

  it('returns the existing turn unchanged when the same clientTurnId is sent again', () => {
    const store = openStore();
    const first = store.startTurn(turnInput());
    advance(5_000);

    const repeat = store.startTurn(turnInput({ bootId: 'boot-b', deadlineAt: '2026-10-07T11:00:00.000Z' }));

    expect(repeat.created).toBe(false);
    expect(repeat.turn).toEqual(first.turn);
    expect(repeat.thread).toEqual(first.thread);
    expect(store.listTurns(first.thread.id)).toEqual([first.turn]);
  });

  it('returns the existing turn even when a repeat names another room, so the caller can refuse it', () => {
    const store = openStore();
    const first = store.startTurn(turnInput({ roomId: 'team' }));

    const repeat = store.startTurn(turnInput({ roomId: 'reglead' }));

    expect(repeat.created).toBe(false);
    expect(repeat.turn).toEqual(first.turn);
    expect(store.getRunningTurn('demo', 'reglead')).toBeNull();
  });

  it('throws RoomBusyError naming the running turn when another turn runs in the room', () => {
    const store = openStore();
    const first = store.startTurn(turnInput());

    const error = thrownBy(() => store.startTurn(turnInput({ clientTurnId: 'client-2' })));

    expect(error).toBeInstanceOf(RoomBusyError);
    expect(error).toMatchObject({ code: 'room_busy', runningTurnId: first.turn.id });
    expect(store.listTurns(first.thread.id)).toEqual([first.turn]);
  });

  it('lets turns run at the same time in different rooms and workspaces', () => {
    const store = openStore();
    store.startTurn(turnInput({ roomId: 'team', clientTurnId: 'client-1' }));

    const otherRoom = store.startTurn(turnInput({ roomId: 'reglead', clientTurnId: 'client-2' }));
    const otherCase = store.startTurn(turnInput({ workspaceId: 'case-2', clientTurnId: 'client-3' }));

    expect(otherRoom.created).toBe(true);
    expect(otherCase.created).toBe(true);
  });

  it('keeps the room lock in the database, where a second connection sees it', () => {
    const first = openStore().startTurn(turnInput());
    const other = openStore();

    expect(() => other.startTurn(turnInput({ clientTurnId: 'client-2' }))).toThrow(RoomBusyError);
    expect(other.startTurn(turnInput()).created).toBe(false);
    expect(other.getRunningTurn('demo', 'team')).toEqual(first.turn);
  });

  it('allows one running turn per room, and each clientTurnId once, in the database itself', () => {
    const { thread } = openStore().startTurn(turnInput());
    const raw = openRaw();
    const insert = raw.prepare(
      `INSERT INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, ended_at, deadline_at)
       VALUES (?, ?, 'demo', 'team', ?, ?, ?, 'boot-a', ?, ?, ?)`,
    );

    expect(() => insert.run('second-running', thread.id, 2, 'client-2', 'running', START, null, DEADLINE)).toThrow(
      /UNIQUE/,
    );
    expect(() => insert.run('same-client-id', thread.id, 3, 'client-1', 'done', START, START, DEADLINE)).toThrow(
      /UNIQUE/,
    );
    // Positive control: a finished turn with a new clientTurnId is fine.
    expect(() => insert.run('finished', thread.id, 4, 'client-3', 'done', START, START, DEADLINE)).not.toThrow();
  });

  it('refuses missing ids and a deadline that is not an ISO date-time with a zone, and writes nothing', () => {
    const store = openStore();

    expect(() => store.startTurn(turnInput({ clientTurnId: '' }))).toThrow(TypeError);
    expect(() => store.startTurn(turnInput({ bootId: ' ' }))).toThrow(TypeError);
    expect(() => store.startTurn(turnInput({ roomId: '' }))).toThrow(TypeError);
    expect(() => store.startTurn(turnInput({ workspaceId: '' }))).toThrow(TypeError);
    expect(() => store.startTurn(turnInput({ deadlineAt: 'soon' }))).toThrow(RangeError);
    // V8 would read "1" as 1 January 2001.
    expect(() => store.startTurn(turnInput({ deadlineAt: '1' }))).toThrow(RangeError);
    expect(() => store.startTurn(turnInput({ deadlineAt: '2026-10-07' }))).toThrow(RangeError);
    expect(() => store.startTurn(turnInput({ deadlineAt: '2026-10-07T10:03:00' }))).toThrow(RangeError);
    expect(store.getRunningTurn('demo', 'team')).toBeNull();
  });

  it('reports the running turn of a room, and null for rooms and turns it does not know', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());

    expect(store.getRunningTurn('demo', 'team')).toEqual(turn);
    expect(store.getRunningTurn('demo', 'reglead')).toBeNull();
    expect(store.getRunningTurn('case-2', 'team')).toBeNull();
    expect(store.getTurn('no-such-turn')).toBeNull();
  });
});

describe('messages', () => {
  it("saves the question as a human message in the turn's thread", () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    advance(1_000);

    const result = store.appendUserMessage({ turnId: turn.id, text: 'What does a paediatric plan need?' });

    expect(result).toEqual({
      inserted: true,
      message: {
        id: expect.any(String),
        threadId: thread.id,
        turnId: turn.id,
        seq: expect.any(Number),
        author: 'human',
        agentId: null,
        agentName: null,
        agentVersion: null,
        promptHash: null,
        model: null,
        provenance: 'derived',
        status: 'complete',
        truncated: false,
        text: 'What does a paediatric plan need?',
        errorCode: null,
        correlationId: null,
        createdAt: '2026-10-07T10:00:01.000Z',
      },
    });
    expect(store.listMessages(thread.id)).toEqual([result.message]);
  });

  it('saves the question once per turn: a repeat returns the first message unchanged', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    const first = store.appendUserMessage({ turnId: turn.id, text: 'first' });

    const repeat = store.appendUserMessage({ turnId: turn.id, text: 'second' });

    expect(repeat).toEqual({ message: first.message, inserted: false });
    expect(store.listMessages(thread.id)).toEqual([first.message]);
    // The database holds the same rule.
    const raw = openRaw();
    expect(() =>
      raw
        .prepare(
          `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
           VALUES ('second-question', ?, ?, 'team', 99, 'human', 'derived', 'complete', 0, 'again', ?)`,
        )
        .run(thread.id, turn.id, START),
    ).toThrow(/UNIQUE/);
  });

  it('refuses an empty question or note, and writes nothing', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());

    expect(() => store.appendUserMessage({ turnId: turn.id, text: '   ' })).toThrow(TypeError);
    expect(() => store.appendNote({ turnId: turn.id, text: '' })).toThrow(TypeError);
    expect(store.listMessages(thread.id)).toEqual([]);
  });

  it("saves an agent reply with a snapshot of the agent's identity and the error details", () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput({ roomId: 'reglead' }));

    const result = store.appendAgentMessage(
      agentReply(turn.id, { status: 'partial', text: 'So far', errorCode: 'llm_network', correlationId: 'corr-1' }),
    );

    expect(result).toEqual({
      inserted: true,
      message: {
        id: 'reply-1',
        threadId: thread.id,
        turnId: turn.id,
        seq: expect.any(Number),
        author: 'agent',
        agentId: 'reglead',
        agentName: 'Rosa',
        agentVersion: '1.0.0',
        promptHash: 'sha256:abc',
        model: 'model-x',
        provenance: 'derived',
        status: 'partial',
        truncated: false,
        text: 'So far',
        errorCode: 'llm_network',
        correlationId: 'corr-1',
        createdAt: START,
      },
    });
    expect(store.listMessages(thread.id)).toEqual([result.message]);
  });

  it('saves an agent reply once by id: a repeat returns the saved row unchanged', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    const first = store.appendAgentMessage(agentReply(turn.id, { text: 'Original', truncated: true }));
    advance(1_000);

    const repeat = store.appendAgentMessage(agentReply(turn.id, { text: 'Changed', status: 'error' }));

    expect(first.message).toMatchObject({
      text: 'Original',
      status: 'complete',
      truncated: true,
      errorCode: null,
      correlationId: null,
    });
    expect(repeat).toEqual({ message: first.message, inserted: false });
    expect(store.listMessages(thread.id)).toEqual([first.message]);
  });

  it('refuses a message id that already belongs to another turn or to another kind of message', () => {
    const store = openStore();
    const team = store.startTurn(turnInput({ roomId: 'team', clientTurnId: 'client-1' }));
    const solo = store.startTurn(turnInput({ roomId: 'reglead', clientTurnId: 'client-2' }));
    store.appendAgentMessage(agentReply(team.turn.id, { id: 'shared-id' }));

    expect(() => store.appendAgentMessage(agentReply(solo.turn.id, { id: 'shared-id' }))).toThrow(/shared-id/);
    expect(() => store.appendNote({ id: 'shared-id', turnId: team.turn.id, text: 'a note' })).toThrow(/shared-id/);
    expect(store.listMessages(solo.thread.id)).toEqual([]);
    expect(store.listMessages(team.thread.id).map((message) => message.id)).toEqual(['shared-id']);
  });

  it('refuses an agent reply without an agent identity or with a status outside the contract', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());

    expect(() => store.appendAgentMessage(agentReply(turn.id, { id: '' }))).toThrow(TypeError);
    expect(() => store.appendAgentMessage(agentReply(turn.id, { agentId: '' }))).toThrow(TypeError);
    expect(() => store.appendAgentMessage(agentReply(turn.id, { agentName: ' ' }))).toThrow(TypeError);
    expect(() => store.appendAgentMessage(agentReply(turn.id, { agentVersion: '' }))).toThrow(TypeError);
    expect(() => store.appendAgentMessage(agentReply(turn.id, { status: 'done' as never }))).toThrow();
    expect(store.listMessages(thread.id)).toEqual([]);
  });

  it('saves code-written notes: once when the note has an id, under a fresh id when it has none', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());

    const named = store.appendNote({ id: 'note-1', turnId: turn.id, text: 'Lena is not selected for this DD.' });
    const repeat = store.appendNote({ id: 'note-1', turnId: turn.id, text: 'different' });
    const unnamedA = store.appendNote({ turnId: turn.id, text: 'same text' });
    const unnamedB = store.appendNote({ turnId: turn.id, text: 'same text' });

    expect(named).toEqual({
      inserted: true,
      message: {
        id: 'note-1',
        threadId: thread.id,
        turnId: turn.id,
        seq: expect.any(Number),
        author: 'note',
        agentId: null,
        agentName: null,
        agentVersion: null,
        promptHash: null,
        model: null,
        provenance: 'derived',
        status: 'complete',
        truncated: false,
        text: 'Lena is not selected for this DD.',
        errorCode: null,
        correlationId: null,
        createdAt: START,
      },
    });
    expect(repeat).toEqual({ message: named.message, inserted: false });
    expect([unnamedA.inserted, unnamedB.inserted]).toEqual([true, true]);
    expect(unnamedA.message.id).not.toBe(unnamedB.message.id);
    expect(store.listMessages(thread.id)).toHaveLength(3);
  });

  it('refuses to append to a turn it does not know, and writes nothing', () => {
    const store = openStore();
    const { thread } = store.startTurn(turnInput());

    expect(() => store.appendUserMessage({ turnId: 'missing-turn', text: 'q' })).toThrow(/missing-turn/);
    expect(() => store.appendAgentMessage(agentReply('missing-turn'))).toThrow(/missing-turn/);
    expect(() => store.appendNote({ turnId: 'missing-turn', text: 'n' })).toThrow(/missing-turn/);
    expect(store.listMessages(thread.id)).toEqual([]);
  });

  it('lists messages in append order with a strictly increasing seq, even when the clock stands still or runs back', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    const question = store.appendUserMessage({ turnId: turn.id, text: 'q' }).message;
    store.appendAgentMessage(agentReply(turn.id, { id: 'reply-a' }));
    advance(-60_000);
    store.appendAgentMessage(agentReply(turn.id, { id: 'reply-b', agentId: 'clin', agentName: 'Clara' }));
    const note = store.appendNote({ turnId: turn.id, text: 'n' }).message;

    const listed = store.listMessages(thread.id);

    expect(listed.map((message) => message.id)).toEqual([question.id, 'reply-a', 'reply-b', note.id]);
    const seqs = listed.map((message) => message.seq);
    expect(seqs.every((seq, index) => index === 0 || seq > seqs[index - 1])).toBe(true);
  });

  it('lists only the messages of the thread asked for', () => {
    const store = openStore();
    const team = store.startTurn(turnInput({ roomId: 'team', clientTurnId: 'client-1' }));
    const solo = store.startTurn(turnInput({ roomId: 'reglead', clientTurnId: 'client-2' }));
    store.appendUserMessage({ turnId: team.turn.id, text: 'to the team' });
    const soloQuestion = store.appendUserMessage({ turnId: solo.turn.id, text: 'to Rosa' }).message;

    expect(store.listMessages(solo.thread.id)).toEqual([soloQuestion]);
    expect(store.listMessages('no-such-thread')).toEqual([]);
  });

  it('keeps messages append-only in the database itself', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    const { message } = store.appendUserMessage({ turnId: turn.id, text: 'original' });
    const raw = openRaw();

    expect(() => raw.prepare("UPDATE messages SET content = 'rewritten' WHERE id = ?").run(message.id)).toThrow(
      /append-only/,
    );
    expect(() => raw.prepare('DELETE FROM messages WHERE id = ?').run(message.id)).toThrow(/append-only/);
    expect(store.listMessages(thread.id)).toEqual([message]);
  });

  it('stores chat as derived data: the database refuses any other provenance', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    const insert = openRaw().prepare(
      `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, provenance, status, truncated, content, created_at)
       VALUES (?, ?, ?, 'team', ?, 'note', ?, 'complete', 0, 'text', ?)`,
    );

    expect(() => insert.run('as-primary', thread.id, turn.id, 1, 'primary', START)).toThrow(/CHECK/);
    // Positive control: the same row as derived is accepted.
    expect(() => insert.run('as-derived', thread.id, turn.id, 2, 'derived', START)).not.toThrow();
  });
});

describe('finishing turns', () => {
  it('moves a running turn to its terminal status with the trace and error details, and frees the room', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());
    advance(2_000);

    const finished = store.finishTurn({
      turnId: turn.id,
      status: 'partial',
      trace: SOLO_TRACE,
      errorCode: 'out_of_time',
      correlationId: 'corr-9',
    });

    expect(finished).toEqual({
      ...turn,
      status: 'partial',
      trace: SOLO_TRACE,
      finishedAt: '2026-10-07T10:00:02.000Z',
      errorCode: 'out_of_time',
      correlationId: 'corr-9',
    });
    expect(store.getTurn(turn.id)).toEqual(finished);
    expect(store.getRunningTurn('demo', 'team')).toBeNull();
    expect(store.startTurn(turnInput({ clientTurnId: 'client-2' })).created).toBe(true);
  });

  it('sets the terminal status exactly once: finishing again returns the turn unchanged', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());
    const first = store.finishTurn({ turnId: turn.id, status: 'done', trace: SOLO_TRACE });
    advance(5_000);

    const again = store.finishTurn({
      turnId: turn.id,
      status: 'error',
      trace: NOBODY_TRACE,
      errorCode: 'internal',
      correlationId: 'corr-2',
    });

    expect(first).toMatchObject({ status: 'done', trace: SOLO_TRACE, errorCode: null, correlationId: null });
    expect(again).toEqual(first);
    expect(store.getTurn(turn.id)).toEqual(first);
  });

  it('keeps a finished turn unchangeable in the database itself', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());
    const finished = store.finishTurn({ turnId: turn.id, status: 'done', trace: null });
    const raw = openRaw();

    expect(() =>
      raw.prepare("UPDATE turns SET status = 'running', ended_at = NULL WHERE id = ?").run(turn.id),
    ).toThrow(/finished/);
    expect(() => raw.prepare("UPDATE turns SET error_code = 'internal' WHERE id = ?").run(turn.id)).toThrow(
      /finished/,
    );
    expect(() => raw.prepare('DELETE FROM turns WHERE id = ?').run(turn.id)).toThrow();
    expect(store.getTurn(turn.id)).toEqual(finished);
  });

  it('refuses, in the database, a turn status outside the contract or a finished turn without an end time', () => {
    const { thread } = openStore().startTurn(turnInput());
    const insert = openRaw().prepare(
      `INSERT INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, ended_at, deadline_at)
       VALUES (?, ?, 'demo', 'reglead', ?, ?, ?, 'boot-a', ?, ?, ?)`,
    );

    expect(() => insert.run('odd-status', thread.id, 2, 'client-2', 'paused', START, START, DEADLINE)).toThrow(
      /CHECK/,
    );
    expect(() => insert.run('no-end', thread.id, 3, 'client-3', 'done', START, null, DEADLINE)).toThrow(/CHECK/);
    expect(() => insert.run('running-ended', thread.id, 4, 'client-4', 'running', START, START, DEADLINE)).toThrow(
      /CHECK/,
    );
    // Positive control: a coherent finished turn is accepted.
    expect(() => insert.run('coherent', thread.id, 5, 'client-5', 'done', START, START, DEADLINE)).not.toThrow();
  });

  it('refuses the statuses reserved for others: running, and interrupted (reconcile only)', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());

    expect(() => store.finishTurn({ turnId: turn.id, status: 'interrupted' as never, trace: null })).toThrow(
      TypeError,
    );
    expect(() => store.finishTurn({ turnId: turn.id, status: 'running' as never, trace: null })).toThrow(TypeError);
    expect(store.getTurn(turn.id)).toEqual(turn);
  });

  it('refuses to finish a turn it does not know', () => {
    const store = openStore();

    expect(() => store.finishTurn({ turnId: 'missing-turn', status: 'done', trace: null })).toThrow(/missing-turn/);
  });

  it('saves the trace of a running turn as soon as it is known, and keeps it when finishing without one', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());

    store.saveTurnTrace(turn.id, SOLO_TRACE);
    const running = store.getTurn(turn.id);
    const finished = store.finishTurn({
      turnId: turn.id,
      status: 'error',
      trace: null,
      errorCode: 'llm_auth',
      correlationId: 'corr-3',
    });

    expect(running).toMatchObject({ status: 'running', trace: SOLO_TRACE });
    expect(finished.trace).toEqual(SOLO_TRACE);
  });

  it('ignores a trace for a turn that has finished, and refuses one for a turn it does not know', () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput());
    const finished = store.finishTurn({ turnId: turn.id, status: 'done', trace: SOLO_TRACE });

    store.saveTurnTrace(turn.id, NOBODY_TRACE);

    expect(store.getTurn(turn.id)).toEqual(finished);
    expect(() => store.saveTurnTrace('missing-turn', SOLO_TRACE)).toThrow(/missing-turn/);
  });

  it("lists a thread's turns oldest first, even when the clock runs back", () => {
    const store = openStore();
    const first = store.startTurn(turnInput({ clientTurnId: 'client-1' }));
    store.finishTurn({ turnId: first.turn.id, status: 'done', trace: null });
    advance(-60_000);
    const second = store.startTurn(turnInput({ clientTurnId: 'client-2' }));

    expect(store.listTurns(first.thread.id).map((turn) => turn.id)).toEqual([first.turn.id, second.turn.id]);
    expect(store.listTurns('no-such-thread')).toEqual([]);
  });

  it('still saves a reply that arrives after its turn finished, so paid-for text is not lost', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());
    store.finishTurn({ turnId: turn.id, status: 'partial', trace: null, errorCode: 'out_of_time' });

    const late = store.appendAgentMessage(agentReply(turn.id, { status: 'partial', text: 'Late text' }));

    expect(late.inserted).toBe(true);
    expect(store.listMessages(thread.id)).toEqual([late.message]);
  });
});

describe('new conversation (newThread)', () => {
  it('archives the active thread and opens an empty one, keeping everything already said', () => {
    const store = openStore();
    const { turn, thread: old } = store.startTurn(turnInput());
    const question = store.appendUserMessage({ turnId: turn.id, text: 'q' }).message;
    const finished = store.finishTurn({ turnId: turn.id, status: 'done', trace: null });
    advance(10_000);

    const result = store.newThread('demo', 'team');

    expect(result.archived).toEqual({ ...old, status: 'archived', archivedAt: '2026-10-07T10:00:10.000Z' });
    expect(result.thread).toEqual({
      id: expect.any(String),
      workspaceId: 'demo',
      roomId: 'team',
      status: 'active',
      createdAt: '2026-10-07T10:00:10.000Z',
      archivedAt: null,
    });
    expect(result.thread.id).not.toBe(old.id);
    expect(store.getActiveThread('demo', 'team')).toEqual(result.thread);
    expect(store.listMessages(result.thread.id)).toEqual([]);
    expect(store.listMessages(old.id)).toEqual([question]);
    expect(store.listTurns(old.id)).toEqual([finished]);
  });

  it('opens a thread when the room never had one', () => {
    const store = openStore();

    const result = store.newThread('demo', 'reglead');

    expect(result.archived).toBeNull();
    expect(store.getActiveThread('demo', 'reglead')).toEqual(result.thread);
  });

  it('starts the next turn in the new thread', () => {
    const store = openStore();
    const first = store.startTurn(turnInput({ clientTurnId: 'client-1' }));
    store.finishTurn({ turnId: first.turn.id, status: 'done', trace: null });
    const { thread } = store.newThread('demo', 'team');

    const next = store.startTurn(turnInput({ clientTurnId: 'client-2' }));

    expect(next.thread).toEqual(thread);
    expect(next.turn.threadId).toBe(thread.id);
  });

  it('throws RoomBusyError while a turn runs in the room, and changes nothing', () => {
    const store = openStore();
    const { turn, thread } = store.startTurn(turnInput());

    const error = thrownBy(() => store.newThread('demo', 'team'));

    expect(error).toBeInstanceOf(RoomBusyError);
    expect(error).toMatchObject({ code: 'room_busy', runningTurnId: turn.id });
    expect(store.getActiveThread('demo', 'team')).toEqual(thread);
  });

  it('archives only the room asked for, even while another room is busy', () => {
    const store = openStore();
    const reglead = store.getActiveThread('demo', 'reglead');
    store.startTurn(turnInput({ roomId: 'clin' }));

    store.newThread('demo', 'team');

    expect(store.getActiveThread('demo', 'reglead')).toEqual(reglead);
  });

  it('refuses an empty workspace or room id', () => {
    const store = openStore();

    expect(() => store.newThread('', 'team')).toThrow(TypeError);
    expect(() => store.newThread('demo', '')).toThrow(TypeError);
  });

  it('never deletes a thread, in the database itself', () => {
    const store = openStore();
    const archived = store.getActiveThread('demo', 'team');
    const { thread: active } = store.newThread('demo', 'team');
    const remove = openRaw().prepare('DELETE FROM threads WHERE id = ?');

    expect(() => remove.run(archived.id)).toThrow(/never deleted/);
    expect(() => remove.run(active.id)).toThrow(/never deleted/);
    expect(store.getActiveThread('demo', 'team')).toEqual(active);
  });
});

describe('reconcileStaleTurns', () => {
  it('marks running turns from another boot as interrupted, frees their rooms and says how many changed', () => {
    const before = openStore();
    const stale = before.startTurn(turnInput({ bootId: 'boot-old', clientTurnId: 'client-1' }));
    const staleSolo = before.startTurn(turnInput({ bootId: 'boot-old', roomId: 'reglead', clientTurnId: 'client-2' }));
    const done = before.startTurn(turnInput({ bootId: 'boot-old', roomId: 'clin', clientTurnId: 'client-3' }));
    const doneTurn = before.finishTurn({ turnId: done.turn.id, status: 'done', trace: null });
    advance(1_000);
    const after = openStore();

    const changed = after.reconcileStaleTurns('boot-new');

    expect(changed).toBe(2);
    expect(after.getTurn(stale.turn.id)).toEqual({
      ...stale.turn,
      status: 'interrupted',
      finishedAt: '2026-10-07T10:00:01.000Z',
    });
    expect(after.getTurn(staleSolo.turn.id)?.status).toBe('interrupted');
    expect(after.getTurn(done.turn.id)).toEqual(doneTurn);
    expect(after.getRunningTurn('demo', 'team')).toBeNull();
    expect(after.startTurn(turnInput({ bootId: 'boot-new', clientTurnId: 'client-4' })).created).toBe(true);
  });

  it("leaves the current boot's turns running while they are within their deadline", () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput({ bootId: 'boot-a' }));
    advance(170_000);

    expect(store.reconcileStaleTurns('boot-a')).toBe(0);
    expect(store.getTurn(turn.id)).toEqual(turn);
  });

  it("marks a current boot's turn that is past its deadline as interrupted, out of time", () => {
    const store = openStore();
    const { turn } = store.startTurn(turnInput({ bootId: 'boot-a' }));
    advance(180_001);

    expect(store.reconcileStaleTurns('boot-a')).toBe(1);
    expect(store.getTurn(turn.id)).toEqual({
      ...turn,
      status: 'interrupted',
      finishedAt: '2026-10-07T10:03:00.001Z',
      errorCode: 'out_of_time',
    });
  });

  it('compares deadlines as instants, whatever zone offset they arrived with', () => {
    const store = openStore();
    // 12:03 at +02:00 is 10:03 UTC. Compared as raw text it would sort after 10:05 and never expire.
    const { turn } = store.startTurn(turnInput({ deadlineAt: '2026-10-07T12:03:00+02:00' }));
    advance(5 * 60_000);

    expect(turn.deadlineAt).toBe('2026-10-07T10:03:00.000Z');
    expect(store.reconcileStaleTurns('boot-a')).toBe(1);
    expect(store.getTurn(turn.id)?.status).toBe('interrupted');
  });

  it('refuses an empty boot id', () => {
    const store = openStore();

    expect(() => store.reconcileStaleTurns(' ')).toThrow(TypeError);
  });
});

describe('selection', () => {
  it('has no saved selection for a workspace that never saved one, so the caller uses its defaults', () => {
    const store = openStore();

    expect(store.getSelection('demo')).toBeNull();
  });

  it('returns the saved selection sorted by agent id, per workspace', () => {
    const store = openStore();

    store.setSelection('demo', ['reglead', 'clin', 'orc']);

    expect(store.getSelection('demo')).toEqual(['clin', 'orc', 'reglead']);
    expect(store.getSelection('case-2')).toBeNull();
  });

  it('replaces the previous selection: agents left out are switched off', () => {
    const store = openStore();
    store.setSelection('demo', ['reglead', 'clin', 'orc']);
    advance(1_000);

    store.setSelection('demo', ['orc', 'label']);

    expect(store.getSelection('demo')).toEqual(['label', 'orc']);
  });

  it('keeps a saved empty selection apart from no saved selection', () => {
    const store = openStore();

    store.setSelection('demo', []);

    expect(store.getSelection('demo')).toEqual([]);
  });

  it('collapses repeated ids, and refuses empty ones without touching the saved selection', () => {
    const store = openStore();

    store.setSelection('demo', ['orc', 'orc', 'clin']);

    expect(store.getSelection('demo')).toEqual(['clin', 'orc']);
    expect(() => store.setSelection('demo', ['orc', ''])).toThrow(TypeError);
    expect(() => store.setSelection('', ['orc'])).toThrow(TypeError);
    expect(store.getSelection('demo')).toEqual(['clin', 'orc']);
  });

  it('keeps the selection across connections and restarts', () => {
    openStore().setSelection('demo', ['orc', 'clin']);

    expect(openStore().getSelection('demo')).toEqual(['clin', 'orc']);
  });
});

describe('toPromptHistory', () => {
  let seq = 0;
  /** A saved message as the store returns it, with every field filled in. */
  function saved(author: MessageAuthor, text: string, overrides: Partial<Message> = {}): Message {
    seq += 1;
    const agent = author === 'agent';
    return {
      id: `m-${seq}`,
      threadId: 'thread-1',
      turnId: `turn-${seq}`,
      seq,
      author,
      agentId: agent ? 'reglead' : null,
      agentName: agent ? 'Rosa' : null,
      agentVersion: agent ? '1.0.0' : null,
      promptHash: agent ? 'sha256:abc' : null,
      model: agent ? 'model-x' : null,
      provenance: 'derived',
      status: 'complete',
      truncated: false,
      text,
      errorCode: null,
      correlationId: null,
      createdAt: START,
      ...overrides,
    };
  }

  it('turns questions into user messages and replies into assistant messages, oldest first', () => {
    const history = toPromptHistory([saved('human', 'Q1'), saved('agent', 'A1'), saved('human', 'Q2')]);

    expect(history).toEqual({
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
      omitted: 0,
    });
  });

  it('drops notes, error replies and messages with no text', () => {
    const history = toPromptHistory([
      saved('human', 'Q1'),
      saved('note', 'Lena is not selected for this DD.'),
      saved('agent', 'text before the failure', { status: 'error', errorCode: 'llm_outage' }),
      saved('agent', '   '),
      saved('agent', 'A1'),
    ]);

    expect(history.messages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);
  });

  it('keeps partial and cut-off replies, whose text is still usable', () => {
    const history = toPromptHistory([
      saved('human', 'Q1'),
      saved('agent', 'half an answer', { status: 'partial', errorCode: 'llm_network' }),
      saved('human', 'Q2'),
      saved('agent', 'a long answer', { truncated: true }),
    ]);

    expect(history.messages.map((message) => message.content)).toEqual(['Q1', 'half an answer', 'Q2', 'a long answer']);
  });

  it('merges messages in a row from the same side, so roles always alternate', () => {
    const history = toPromptHistory([
      saved('human', 'Q1'),
      saved('agent', '', { status: 'error', errorCode: 'llm_timeout' }),
      saved('human', 'Q2'),
      saved('agent', 'A from one agent'),
      saved('agent', 'A from another agent'),
    ]);

    expect(history.messages).toEqual([
      { role: 'user', content: 'Q1\n\nQ2' },
      { role: 'assistant', content: 'A from one agent\n\nA from another agent' },
    ]);
  });

  it('never starts with an assistant message', () => {
    const history = toPromptHistory([saved('agent', 'a reply without its question'), saved('human', 'Q1')]);

    expect(history).toEqual({ messages: [{ role: 'user', content: 'Q1' }], omitted: 1 });
  });

  it('keeps the newest messages up to the limit and says how many it left out', () => {
    const thread = [
      saved('human', 'Q1'),
      saved('agent', 'A1'),
      saved('human', 'Q2'),
      saved('agent', 'A2'),
      saved('human', 'Q3'),
    ];

    const lastThree = toPromptHistory(thread, { limit: 3 });
    // The newest two would start with an assistant message, so only the question is kept.
    const lastTwo = toPromptHistory(thread, { limit: 2 });

    expect(lastThree).toEqual({
      messages: [
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
      ],
      omitted: 2,
    });
    expect(lastTwo).toEqual({ messages: [{ role: 'user', content: 'Q3' }], omitted: 4 });
    expect(toPromptHistory(thread, { limit: 10 }).omitted).toBe(0);
  });

  it('refuses a limit that is not a whole number of messages', () => {
    const thread = [saved('human', 'Q1')];

    expect(() => toPromptHistory(thread, { limit: -1 })).toThrow(RangeError);
    expect(() => toPromptHistory(thread, { limit: 2.5 })).toThrow(RangeError);
    expect(toPromptHistory(thread, { limit: 0 })).toEqual({ messages: [], omitted: 1 });
  });
});

describe('append-only (structural)', () => {
  // Matches SQL that rewrites or removes saved messages. Trigger definitions such as
  // "BEFORE UPDATE ON messages" do not match.
  const REWRITES_MESSAGES =
    /\bUPDATE\s+(?:OR\s+\w+\s+)?["'`[]?messages\b|\bDELETE\s+FROM\s+["'`[]?messages\b|\bREPLACE\s+INTO\s+["'`[]?messages\b|\bINSERT\s+INTO\s+["'`[]?messages\b[^`'";]*\bON\s+CONFLICT\b[^`'";]*\bDO\s+UPDATE\b/i;

  it('recognises the statements it forbids (positive control)', () => {
    expect('UPDATE messages SET content = ?').toMatch(REWRITES_MESSAGES);
    expect('update or ignore "messages" set status = 1').toMatch(REWRITES_MESSAGES);
    expect('DELETE FROM messages WHERE id = ?').toMatch(REWRITES_MESSAGES);
    expect('INSERT OR REPLACE INTO messages (id) VALUES (?)').toMatch(REWRITES_MESSAGES);
    expect('INSERT INTO messages (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET content = 1').toMatch(
      REWRITES_MESSAGES,
    );
    expect('CREATE TRIGGER t BEFORE UPDATE ON messages').not.toMatch(REWRITES_MESSAGES);
    expect('INSERT INTO messages (id) VALUES (?)').not.toMatch(REWRITES_MESSAGES);
  });

  it('finds no statement in the chat store code that rewrites or deletes messages', () => {
    const folder = new URL('.', import.meta.url);
    const sources = readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

    const offending = sources.flatMap((name) => {
      const found = REWRITES_MESSAGES.exec(readFileSync(new URL(name, folder), 'utf8'));
      return found ? [`${name}: ${found[0]}`] : [];
    });

    expect(sources).toEqual(expect.arrayContaining(['schema.ts', 'store.ts']));
    expect(offending).toEqual([]);
  });
});
