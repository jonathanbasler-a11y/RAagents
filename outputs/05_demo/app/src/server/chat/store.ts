import 'server-only';
import { randomUUID } from 'node:crypto';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type {
  AgentId,
  AppendResult,
  ChatErrorCode,
  DdSetup,
  FinishTurnInput,
  InterruptTurnInput,
  LlmMessage,
  Message,
  MessageAuthor,
  MessageStatus,
  NewThreadResult,
  Provenance,
  ReconcileOptions,
  RoomId,
  StartTurnResult,
  Store,
  StoreOptions,
  Thread,
  Turn,
  TurnStatus,
  TurnTrace,
  WorkspaceId,
} from '@/shared/contracts';
import { CLASSIFICATION_IDS, DEVELOPMENT_STAGES } from '@/shared/contracts';
import { immediateTransaction, migrateChatSchema } from './schema';

// Chat persistence (contract: Store in src/shared/contracts.ts). The database holds the
// invariants itself (see schema.ts): append-only messages, threads and turns that are never
// deleted, one active thread and at most one running turn per room, and a terminal turn
// status that is set once. Every read-check-write runs in one BEGIN IMMEDIATE transaction,
// so two server processes on one file cannot interleave.

/** Thrown by startTurn and newThread while another turn runs in the room. The API answers 409 room_busy. */
export class RoomBusyError extends Error {
  readonly code = 'room_busy' as const;
  readonly runningTurnId: string;

  constructor(runningTurnId: string) {
    super(`another turn is running in this room (turn ${runningTurnId})`);
    this.name = 'RoomBusyError';
    this.runningTurnId = runningTurnId;
  }
}

/**
 * Thrown by startTurn when the server already runs as many turns as it may at once, before
 * anything is written. The API answers 429 server_busy.
 */
export class ServerBusyError extends Error {
  readonly code = 'server_busy' as const;
  readonly running: number;
  readonly limit: number;

  constructor(running: number, limit: number) {
    super(`${running} turn(s) already run on this server, the most it runs at once is ${limit}`);
    this.name = 'ServerBusyError';
    this.running = running;
    this.limit = limit;
  }
}

// Row shapes as stored. The tables are STRICT, so SQLite guarantees these column types.
interface ThreadRow {
  id: string;
  workspace_id: string;
  room: string;
  created_at: string;
  archived_at: string | null;
}

interface TurnRow {
  id: string;
  thread_id: string;
  workspace_id: string;
  room: string;
  seq: number;
  client_turn_id: string;
  status: TurnStatus;
  boot_id: string;
  route_json: string | null;
  started_at: string;
  ended_at: string | null;
  deadline_at: string;
  error_code: ChatErrorCode | null;
  correlation_id: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  turn_id: string;
  room: string;
  seq: number;
  author: MessageAuthor;
  agent_id: string | null;
  agent_name: string | null;
  agent_version: string | null;
  prompt_hash: string | null;
  model: string | null;
  provenance: Provenance;
  status: MessageStatus;
  truncated: number;
  content: string;
  error_code: ChatErrorCode | null;
  correlation_id: string | null;
  created_at: string;
}

/** What a new message row needs besides its position, which the store assigns. */
interface NewMessage {
  id: string;
  author: MessageAuthor;
  text: string;
  status: MessageStatus;
  truncated: boolean;
  agentId?: string;
  agentName?: string;
  agentVersion?: string;
  promptHash?: string | null;
  model?: string | null;
  errorCode?: ChatErrorCode | null;
  correlationId?: string | null;
}

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    roomId: row.room,
    status: row.archived_at === null ? 'active' : 'archived',
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
    roomId: row.room,
    clientTurnId: row.client_turn_id,
    status: row.status,
    bootId: row.boot_id,
    trace: row.route_json === null ? null : (JSON.parse(row.route_json) as TurnTrace),
    deadlineAt: row.deadline_at,
    startedAt: row.started_at,
    finishedAt: row.ended_at,
    errorCode: row.error_code,
    correlationId: row.correlation_id,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    seq: row.seq,
    author: row.author,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentVersion: row.agent_version,
    promptHash: row.prompt_hash,
    model: row.model,
    provenance: row.provenance,
    status: row.status,
    truncated: row.truncated === 1,
    text: row.content,
    errorCode: row.error_code,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

function requireNonEmpty(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

/** A DD setup the store may save: a known stage and a list of unique, known classifications. */
function checkDdSetup(value: DdSetup): DdSetup {
  const { stage, classifications } = (value ?? {}) as Partial<DdSetup>;
  if (typeof stage !== 'string' || !(DEVELOPMENT_STAGES as readonly string[]).includes(stage)) {
    throw new RangeError(`stage must be one of ${DEVELOPMENT_STAGES.join(', ')}`);
  }
  if (!Array.isArray(classifications)) throw new RangeError('classifications must be a list');
  for (const id of classifications) {
    if (typeof id !== 'string' || !(CLASSIFICATION_IDS as readonly string[]).includes(id)) {
      throw new RangeError(`unknown classification ${String(id)}`);
    }
  }
  if (new Set(classifications).size !== classifications.length) throw new RangeError('classifications lists the same id twice');
  return { stage, classifications: [...classifications] };
}

/** What the turn runner may finish a turn with. `interrupted` is reserved for reconcileStaleTurns. */
const RUNNER_TERMINAL_STATUSES: readonly string[] = ['done', 'partial', 'error'] satisfies FinishTurnInput['status'][];

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO 8601 date-time with a zone, rewritten as UTC `toISOString()` text. Stored
 * instants share one format, so SQL can compare them as text.
 */
function normalizeInstant(name: string, value: unknown): string {
  const ms = typeof value === 'string' && ISO_DATE_TIME.test(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) {
    throw new RangeError(`${name} must be an ISO 8601 date-time with a zone, such as 2026-10-07T10:03:00.000Z`);
  }
  return new Date(ms).toISOString();
}

/** Prompt history built from a thread's saved messages. */
export interface PromptHistory {
  /** Oldest first. Starts with a user message, the roles alternate, and no message is empty. */
  messages: LlmMessage[];
  /** Valid messages left out (by `limit`, or because history may not open with a reply), for an "earlier messages not included" note. */
  omitted: number;
}

export interface PromptHistoryOptions {
  /** Keep at most this many of the newest messages, counted after merging. */
  limit?: number;
}

/**
 * Turns a thread's saved messages (oldest first, as listMessages returns them) into
 * history for a 1:1 prompt:
 * - questions become user messages and agent replies assistant messages; notes are left out;
 * - error replies and messages with no text are dropped; partial and cut-off replies are kept;
 * - messages in a row from the same side are merged, with a blank line between them;
 * - with `limit`, only the newest messages are kept;
 * - the result never starts with an assistant message.
 * The turn's own question, once saved, is the last user message: do not add it a second time.
 */
export function toPromptHistory(messages: readonly Message[], options: PromptHistoryOptions = {}): PromptHistory {
  const { limit } = options;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new RangeError(`limit must be a whole number of messages, 0 or more; got ${limit}`);
  }

  const merged: LlmMessage[] = [];
  for (const message of messages) {
    if (message.author === 'note' || message.status === 'error' || message.text.trim() === '') continue;
    const role = message.author === 'human' ? 'user' : 'assistant';
    const previous = merged.at(-1);
    if (previous?.role === role) previous.content = `${previous.content}\n\n${message.text}`;
    else merged.push({ role, content: message.text });
  }

  let start = limit === undefined ? 0 : Math.max(0, merged.length - limit);
  if (merged[start]?.role === 'assistant') start += 1;
  return { messages: merged.slice(start), omitted: start };
}

/** Opens (creating if needed) the chat database at dbPath, applies the schema and returns the store. */
export function createStore(dbPath: string, options: StoreOptions = {}): Store {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());
  const ownBootId = options.bootId;
  const timestamp = () => now().toISOString();

  const db: SqliteDatabase = openDatabase(dbPath);
  try {
    migrateChatSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const sql = {
    activeThread: db.prepare('SELECT * FROM threads WHERE workspace_id = ? AND room = ? AND archived_at IS NULL'),
    insertThread: db.prepare('INSERT INTO threads (id, workspace_id, room, created_at) VALUES (?, ?, ?, ?)'),
    archiveThread: db.prepare('UPDATE threads SET archived_at = ? WHERE id = ? AND archived_at IS NULL'),
    threadById: db.prepare('SELECT * FROM threads WHERE id = ?'),
    turnById: db.prepare('SELECT * FROM turns WHERE id = ?'),
    turnByClientTurnId: db.prepare('SELECT * FROM turns WHERE client_turn_id = ?'),
    runningTurn: db.prepare("SELECT * FROM turns WHERE workspace_id = ? AND room = ? AND status = 'running'"),
    // Every room and workspace: the cap is per server, and one server has one database.
    runningTurnCount: db.prepare("SELECT COUNT(*) AS n FROM turns WHERE status = 'running'"),
    turnsOfThread: db.prepare('SELECT * FROM turns WHERE thread_id = ? ORDER BY seq'),
    nextTurnSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM turns WHERE thread_id = ?'),
    insertTurn: db.prepare(
      `INSERT INTO turns (id, thread_id, workspace_id, room, seq, client_turn_id, status, boot_id, started_at, deadline_at)
       VALUES (:id, :thread_id, :workspace_id, :room, :seq, :client_turn_id, 'running', :boot_id, :started_at, :deadline_at)`,
    ),
    saveRunningTrace: db.prepare("UPDATE turns SET route_json = ? WHERE id = ? AND status = 'running'"),
    finishRunningTurn: db.prepare(
      `UPDATE turns
       SET status = :status, route_json = COALESCE(:route_json, route_json), ended_at = :ended_at,
           error_code = :error_code, correlation_id = :correlation_id
       WHERE id = :id AND status = 'running'`,
    ),
    // Stored instants are all toISOString() text, so `<` compares them as instants.
    interruptStaleTurns: db.prepare(
      `UPDATE turns
       SET status = 'interrupted', ended_at = :now,
           error_code = CASE WHEN boot_id = :boot_id THEN 'out_of_time' ELSE error_code END
       WHERE status = 'running' AND (boot_id <> :boot_id OR deadline_at < :now)`,
    ),
    // A turn past its deadline and the runner's grace has a stuck runner, whichever process it belongs to.
    interruptOverdueTurns: db.prepare(
      `UPDATE turns
       SET status = 'interrupted', ended_at = :now, error_code = 'out_of_time'
       WHERE status = 'running' AND deadline_at < :cutoff`,
    ),
    interruptOwnTurn: db.prepare(
      `UPDATE turns
       SET status = 'interrupted', ended_at = :ended_at, error_code = :error_code, correlation_id = :correlation_id
       WHERE id = :id AND status = 'running' AND boot_id = :boot_id`,
    ),
    selectionSaved: db.prepare('SELECT 1 AS saved FROM selection_saves WHERE workspace_id = ?'),
    selectedAgents: db.prepare(
      'SELECT agent_id FROM selection WHERE workspace_id = ? AND selected = 1 ORDER BY agent_id',
    ),
    switchOffOthers: db.prepare(
      `UPDATE selection SET selected = 0, updated_at = :now
       WHERE workspace_id = :workspace_id AND selected = 1
         AND agent_id NOT IN (SELECT value FROM json_each(:agent_ids))`,
    ),
    switchOn: db.prepare(
      `INSERT INTO selection (workspace_id, agent_id, selected, updated_at)
       VALUES (:workspace_id, :agent_id, 1, :now)
       ON CONFLICT (workspace_id, agent_id) DO UPDATE SET selected = 1, updated_at = excluded.updated_at
       WHERE selection.selected = 0`,
    ),
    markSelectionSaved: db.prepare(
      `INSERT INTO selection_saves (workspace_id, saved_at) VALUES (:workspace_id, :now)
       ON CONFLICT (workspace_id) DO UPDATE SET saved_at = excluded.saved_at`,
    ),
    ddSetupOf: db.prepare('SELECT stage, classifications FROM dd_setup WHERE workspace_id = ?'),
    upsertDdSetup: db.prepare(
      `INSERT INTO dd_setup (workspace_id, stage, classifications, updated_at)
       VALUES (:workspace_id, :stage, :classifications, :now)
       ON CONFLICT (workspace_id) DO UPDATE
         SET stage = excluded.stage, classifications = excluded.classifications, updated_at = excluded.updated_at`,
    ),
    messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    questionOfTurn: db.prepare("SELECT * FROM messages WHERE turn_id = ? AND author = 'human'"),
    messagesOfThread: db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY seq'),
    nextMessageSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE thread_id = ?'),
    insertMessage: db.prepare(
      `INSERT INTO messages (id, thread_id, turn_id, room, seq, author, agent_id, agent_name, agent_version,
         prompt_hash, model, provenance, status, truncated, content, error_code, correlation_id, created_at)
       VALUES (:id, :thread_id, :turn_id, :room, :seq, :author, :agent_id, :agent_name, :agent_version,
         :prompt_hash, :model, 'derived', :status, :truncated, :content, :error_code, :correlation_id, :created_at)`,
    ),
  };

  const threadRow = (id: string) => sql.threadById.get(id) as ThreadRow | undefined;
  const activeThreadRow = (workspaceId: WorkspaceId, roomId: RoomId) =>
    sql.activeThread.get(workspaceId, roomId) as ThreadRow | undefined;
  const turnRow = (id: string) => sql.turnById.get(id) as TurnRow | undefined;
  const runningTurnRow = (workspaceId: WorkspaceId, roomId: RoomId) =>
    sql.runningTurn.get(workspaceId, roomId) as TurnRow | undefined;
  const messageRow = (id: string) => sql.messageById.get(id) as MessageRow | undefined;

  function mustExist<T>(row: T | undefined, what: string): T {
    if (row === undefined) throw new Error(`${what} is missing from the chat database`);
    return row;
  }

  function requireTurn(turnId: string): TurnRow {
    const row = turnRow(turnId);
    if (!row) throw new Error(`turn ${turnId} does not exist`);
    return row;
  }

  /** The saved message with this id, if it is the same kind of message in the same turn; throws if the id is taken otherwise. */
  function sameMessage(id: string, turnId: string, author: MessageAuthor): MessageRow | undefined {
    const row = messageRow(id);
    if (row && (row.turn_id !== turnId || row.author !== author)) {
      throw new Error(`message id ${id} is already used by another message`);
    }
    return row;
  }

  /** Call inside a transaction. */
  function activeThreadOrCreate(workspaceId: WorkspaceId, roomId: RoomId): ThreadRow {
    const found = activeThreadRow(workspaceId, roomId);
    if (found) return found;
    const id = newId();
    sql.insertThread.run(id, workspaceId, roomId, timestamp());
    return mustExist(threadRow(id), `thread ${id}`);
  }

  /** Call inside a transaction. Places the message after every message already in the turn's thread. */
  function insertMessage(turn: TurnRow, message: NewMessage): AppendResult {
    const { next } = sql.nextMessageSeq.get(turn.thread_id) as { next: number };
    sql.insertMessage.run({
      id: message.id,
      thread_id: turn.thread_id,
      turn_id: turn.id,
      room: turn.room,
      seq: next,
      author: message.author,
      agent_id: message.agentId ?? null,
      agent_name: message.agentName ?? null,
      agent_version: message.agentVersion ?? null,
      prompt_hash: message.promptHash ?? null,
      model: message.model ?? null,
      status: message.status,
      truncated: message.truncated ? 1 : 0,
      content: message.text,
      error_code: message.errorCode ?? null,
      correlation_id: message.correlationId ?? null,
      created_at: timestamp(),
    });
    return { message: toMessage(mustExist(messageRow(message.id), `message ${message.id}`)), inserted: true };
  }

  const unchanged = (row: MessageRow): AppendResult => ({ message: toMessage(row), inserted: false });

  /** The saved selection sorted by agent id, or null if the workspace never saved one. */
  function readSelection(workspaceId: WorkspaceId): AgentId[] | null {
    if (!sql.selectionSaved.get(workspaceId)) return null;
    return (sql.selectedAgents.all(workspaceId) as unknown as { agent_id: string }[]).map((row) => row.agent_id);
  }

  /** Replaces the selection. Call inside a transaction. Validates every id before the first write. */
  function writeSelection(workspaceId: WorkspaceId, agentIds: AgentId[], at: string): void {
    if (!Array.isArray(agentIds)) throw new TypeError('agentIds must be an array');
    agentIds.forEach((agentId, index) => requireNonEmpty(`agentIds[${index}]`, agentId));
    const selected = [...new Set(agentIds)];
    sql.switchOffOthers.run({ workspace_id: workspaceId, agent_ids: JSON.stringify(selected), now: at });
    for (const agentId of selected) sql.switchOn.run({ workspace_id: workspaceId, agent_id: agentId, now: at });
    sql.markSelectionSaved.run({ workspace_id: workspaceId, now: at });
  }

  /** The saved setup. Classification ids the code does not know (a hand-edited file) are left out. */
  function readDdSetup(workspaceId: WorkspaceId): DdSetup | null {
    const row = sql.ddSetupOf.get(workspaceId) as { stage: string; classifications: string } | undefined;
    if (!row) return null;
    const known = (JSON.parse(row.classifications) as unknown[]).filter((id): id is DdSetup['classifications'][number] =>
      (CLASSIFICATION_IDS as readonly unknown[]).includes(id),
    );
    return { stage: row.stage as DdSetup['stage'], classifications: known };
  }

  return {
    getActiveThread(workspaceId, roomId) {
      requireNonEmpty('workspaceId', workspaceId);
      requireNonEmpty('roomId', roomId);
      const found = activeThreadRow(workspaceId, roomId);
      if (found) return toThread(found);
      return toThread(immediateTransaction(db, () => activeThreadOrCreate(workspaceId, roomId)));
    },

    newThread(workspaceId, roomId) {
      requireNonEmpty('workspaceId', workspaceId);
      requireNonEmpty('roomId', roomId);
      return immediateTransaction(db, (): NewThreadResult => {
        const running = runningTurnRow(workspaceId, roomId);
        if (running) throw new RoomBusyError(running.id);
        // Archiving keeps the thread, its turns and its messages; nothing is deleted.
        const active = activeThreadRow(workspaceId, roomId);
        if (active) sql.archiveThread.run(timestamp(), active.id);
        const thread = activeThreadOrCreate(workspaceId, roomId);
        const archived = active ? mustExist(threadRow(active.id), `thread ${active.id}`) : undefined;
        return { thread: toThread(thread), archived: archived ? toThread(archived) : null };
      });
    },

    startTurn(input) {
      requireNonEmpty('workspaceId', input.workspaceId);
      requireNonEmpty('roomId', input.roomId);
      requireNonEmpty('clientTurnId', input.clientTurnId);
      requireNonEmpty('bootId', input.bootId);
      const deadlineAt = normalizeInstant('deadlineAt', input.deadlineAt);
      const { maxRunningTurns } = input;
      if (maxRunningTurns !== undefined && (!Number.isInteger(maxRunningTurns) || maxRunningTurns < 1)) {
        throw new RangeError(`maxRunningTurns must be a whole number, 1 or more; got ${maxRunningTurns}`);
      }

      return immediateTransaction(db, (): StartTurnResult => {
        const existing = sql.turnByClientTurnId.get(input.clientTurnId) as TurnRow | undefined;
        if (existing) {
          const thread = mustExist(threadRow(existing.thread_id), `thread ${existing.thread_id}`);
          return { created: false, turn: toTurn(existing), thread: toThread(thread) };
        }
        const running = runningTurnRow(input.workspaceId, input.roomId);
        if (running) throw new RoomBusyError(running.id);
        if (maxRunningTurns !== undefined) {
          // Before the thread is created: a refused turn writes nothing.
          const { n } = sql.runningTurnCount.get() as { n: number };
          if (n >= maxRunningTurns) throw new ServerBusyError(Number(n), maxRunningTurns);
        }

        const thread = activeThreadOrCreate(input.workspaceId, input.roomId);
        const id = newId();
        const { next } = sql.nextTurnSeq.get(thread.id) as { next: number };
        sql.insertTurn.run({
          id,
          thread_id: thread.id,
          workspace_id: input.workspaceId,
          room: input.roomId,
          seq: next,
          client_turn_id: input.clientTurnId,
          boot_id: input.bootId,
          started_at: timestamp(),
          deadline_at: deadlineAt,
        });
        return { created: true, turn: toTurn(mustExist(turnRow(id), `turn ${id}`)), thread: toThread(thread) };
      });
    },

    saveTurnTrace(turnId, trace) {
      requireNonEmpty('turnId', turnId);
      const json = JSON.stringify(trace);
      immediateTransaction(db, () => {
        const turn = requireTurn(turnId);
        // A finished turn keeps the trace it finished with.
        if (turn.status === 'running') sql.saveRunningTrace.run(json, turn.id);
      });
    },

    appendUserMessage(input) {
      requireNonEmpty('turnId', input.turnId);
      requireNonEmpty('text', input.text);
      return immediateTransaction(db, () => {
        const turn = requireTurn(input.turnId);
        const saved = sql.questionOfTurn.get(turn.id) as MessageRow | undefined;
        if (saved) return unchanged(saved);
        return insertMessage(turn, {
          id: newId(),
          author: 'human',
          text: input.text,
          status: 'complete',
          truncated: false,
        });
      });
    },

    appendAgentMessage(input) {
      requireNonEmpty('id', input.id);
      requireNonEmpty('turnId', input.turnId);
      requireNonEmpty('agentId', input.agentId);
      requireNonEmpty('agentName', input.agentName);
      requireNonEmpty('agentVersion', input.agentVersion);
      if (typeof input.text !== 'string') throw new TypeError('text must be a string');
      return immediateTransaction(db, () => {
        const saved = sameMessage(input.id, input.turnId, 'agent');
        if (saved) return unchanged(saved);
        return insertMessage(requireTurn(input.turnId), {
          id: input.id,
          author: 'agent',
          text: input.text,
          status: input.status,
          truncated: input.truncated,
          agentId: input.agentId,
          agentName: input.agentName,
          agentVersion: input.agentVersion,
          promptHash: input.promptHash,
          model: input.model,
          errorCode: input.errorCode,
          correlationId: input.correlationId,
        });
      });
    },

    appendNote(input) {
      requireNonEmpty('turnId', input.turnId);
      requireNonEmpty('text', input.text);
      if (input.id !== undefined) requireNonEmpty('id', input.id);
      return immediateTransaction(db, () => {
        const saved = input.id === undefined ? undefined : sameMessage(input.id, input.turnId, 'note');
        if (saved) return unchanged(saved);
        return insertMessage(requireTurn(input.turnId), {
          id: input.id ?? newId(),
          author: 'note',
          text: input.text,
          status: 'complete',
          truncated: false,
        });
      });
    },

    finishTurn(input) {
      requireNonEmpty('turnId', input.turnId);
      if (!RUNNER_TERMINAL_STATUSES.includes(input.status)) {
        throw new TypeError(`finishTurn sets done, partial or error; got ${String(input.status)}`);
      }
      const traceJson = input.trace == null ? null : JSON.stringify(input.trace);
      return immediateTransaction(db, () => {
        const turn = requireTurn(input.turnId);
        if (turn.status !== 'running') return toTurn(turn);
        sql.finishRunningTurn.run({
          id: turn.id,
          status: input.status,
          // Finishing without a trace keeps the one saved while the turn ran.
          route_json: traceJson,
          ended_at: timestamp(),
          error_code: input.errorCode ?? null,
          correlation_id: input.correlationId ?? null,
        });
        return toTurn(mustExist(turnRow(turn.id), `turn ${turn.id}`));
      });
    },

    interruptTurn(input: InterruptTurnInput) {
      requireNonEmpty('turnId', input.turnId);
      requireNonEmpty('errorCode', input.errorCode);
      requireNonEmpty('correlationId', input.correlationId);
      if (ownBootId === undefined) {
        throw new Error('interruptTurn needs a store opened with a boot id (StoreOptions.bootId): it ends only this process\'s turns');
      }
      return immediateTransaction(db, () => {
        const turn = requireTurn(input.turnId);
        // A finished turn, or one that belongs to another process, is returned as it is.
        if (turn.status !== 'running' || turn.boot_id !== ownBootId) return toTurn(turn);
        sql.interruptOwnTurn.run({
          id: turn.id,
          boot_id: ownBootId,
          ended_at: timestamp(),
          error_code: input.errorCode,
          correlation_id: input.correlationId,
        });
        return toTurn(mustExist(turnRow(turn.id), `turn ${turn.id}`));
      });
    },

    getTurn(turnId) {
      const row = turnRow(turnId);
      return row ? toTurn(row) : null;
    },

    getRunningTurn(workspaceId, roomId) {
      const row = runningTurnRow(workspaceId, roomId);
      return row ? toTurn(row) : null;
    },

    listMessages(threadId) {
      return (sql.messagesOfThread.all(threadId) as unknown as MessageRow[]).map(toMessage);
    },

    listTurns(threadId) {
      return (sql.turnsOfThread.all(threadId) as unknown as TurnRow[]).map(toTurn);
    },

    reconcileStaleTurns(bootId, reconcileOptions?: ReconcileOptions) {
      requireNonEmpty('bootId', bootId);
      const graceMs = reconcileOptions?.graceMs;
      if (graceMs !== undefined) {
        if (!Number.isFinite(graceMs) || graceMs < 0) {
          throw new RangeError(`graceMs must be a number of milliseconds, 0 or more; got ${graceMs}`);
        }
        // At runtime only the overdue turns: another boot's turn within its deadline may be a live process's.
        const cutoff = new Date(now().getTime() - graceMs).toISOString();
        return Number(sql.interruptOverdueTurns.run({ now: timestamp(), cutoff }).changes);
      }
      // One statement, so it is atomic on its own. A turn left by an earlier process can
      // never finish; a turn of this process past its deadline has a stuck runner.
      const { changes } = sql.interruptStaleTurns.run({ boot_id: bootId, now: timestamp() });
      return Number(changes);
    },

    getSelection: readSelection,

    setSelection(workspaceId, agentIds) {
      requireNonEmpty('workspaceId', workspaceId);
      const now = timestamp();
      immediateTransaction(db, () => writeSelection(workspaceId, agentIds, now));
    },

    getDdSetup(workspaceId) {
      requireNonEmpty('workspaceId', workspaceId);
      return readDdSetup(workspaceId);
    },

    updateDdSetup(workspaceId, change) {
      requireNonEmpty('workspaceId', workspaceId);
      const now = timestamp();
      // One transaction: the setup and the selection that goes with it are saved together or not at all.
      // The setup is written first on purpose: a selection the store refuses must undo it, which only
      // the transaction can do.
      return immediateTransaction(db, () => {
        const next = change({ setup: readDdSetup(workspaceId), selection: readSelection(workspaceId) });
        const setup = checkDdSetup(next.setup);
        sql.upsertDdSetup.run({ workspace_id: workspaceId, stage: setup.stage, classifications: JSON.stringify(setup.classifications), now });
        writeSelection(workspaceId, next.selection, now);
        return { setup, selection: [...new Set(next.selection)] };
      });
    },

    close() {
      if (db.isOpen) db.close();
    },
  };
}
