import 'server-only';
import { randomUUID } from 'node:crypto';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type {
  AgentId,
  AppendResult,
  ChatErrorCode,
  DataRoom,
  DataRoomDocument,
  DdSetup,
  Finding,
  FindingEvent,
  FinishTurnInput,
  InterruptTurnInput,
  LlmMessage,
  Message,
  MessageAuthor,
  MessageStatus,
  NewDocument,
  NewThreadResult,
  OpenQuestion,
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
import { CLASSIFICATION_IDS, DEVELOPMENT_STAGES, LOCAL_PERSON } from '@/shared/contracts';
import { neutraliseUntrusted } from '@/server/prompts/fence';
import { checkProposedFinding, type ProposalContext } from '@/shared/findings';
import { MAX_REASON_CHARS, checkAsOf, checkNewDocument, compareDocumentIds, nextDocumentId } from '@/shared/data-room';
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

/** Thrown by createDataRoom when the workspace already has a data room. The API answers 409 data_room_exists. */
export class DataRoomExistsError extends Error {
  readonly code = 'data_room_exists' as const;

  constructor(workspaceId: string) {
    super(`workspace ${workspaceId} already has a data room`);
    this.name = 'DataRoomExistsError';
  }
}

/** Thrown by addDocument and withdrawDocument when the workspace has no data room. The API answers 409 no_data_room. */
export class NoDataRoomError extends Error {
  readonly code = 'no_data_room' as const;

  constructor(workspaceId: string) {
    super(`workspace ${workspaceId} has no data room`);
    this.name = 'NoDataRoomError';
  }
}

/** Thrown by addDocument when the id is taken. */
export class DuplicateDocumentError extends Error {
  readonly code = 'duplicate_document' as const;

  constructor(documentId: string) {
    super(`the data room already has a document ${documentId}`);
    this.name = 'DuplicateDocumentError';
  }
}

/** Thrown by withdrawDocument for an id the data room does not have. The API answers 404 document_not_found. */
export class DocumentNotFoundError extends Error {
  readonly code = 'document_not_found' as const;

  constructor(documentId: string) {
    super(`the data room has no document ${documentId}`);
    this.name = 'DocumentNotFoundError';
  }
}

/** Thrown by decideFinding for a finding the register does not have. The API answers 404 finding_not_found. */
export class FindingNotFoundError extends Error {
  readonly code = 'finding_not_found' as const;

  constructor(findingId: string) {
    super(`the register has no finding ${findingId}`);
    this.name = 'FindingNotFoundError';
  }
}

/** Thrown by decideFinding for a finding a person already decided. The API answers 409 finding_decided. */
export class FindingAlreadyDecidedError extends Error {
  readonly code = 'finding_decided' as const;

  constructor(findingId: string, status: string) {
    super(`finding ${findingId} is already ${status}; a decision is made once`);
    this.name = 'FindingAlreadyDecidedError';
  }
}

/** Thrown by decideFinding when accepting a finding whose document was withdrawn. The API answers 409 finding_source_withdrawn. */
export class FindingSourceWithdrawnError extends Error {
  readonly code = 'finding_source_withdrawn' as const;

  constructor(findingId: string, documentId: string) {
    super(`finding ${findingId} cannot be accepted: ${documentId} has been withdrawn`);
    this.name = 'FindingSourceWithdrawnError';
  }
}

const MAX_DECISION_NOTE_CHARS = 300;

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

interface DocumentRow {
  workspace_id: string;
  id: string;
  title: string;
  source_type: string;
  published_at: string | null;
  url: string | null;
  provided: number;
  origin: string;
  body: string | null;
  added_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
}

function toDocument(row: DocumentRow): DataRoomDocument {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type as DataRoomDocument['sourceType'],
    publishedAt: row.published_at,
    url: row.url,
    provided: row.provided === 1,
    origin: row.origin as DataRoomDocument['origin'],
    text: row.body,
    addedAt: row.added_at,
    withdrawnAt: row.withdrawn_at,
    withdrawnReason: row.withdrawn_reason,
  };
}

interface FindingRow {
  workspace_id: string;
  id: string;
  claim: string;
  quote: string;
  document_id: string;
  document_title: string;
  source_type: string;
  basis: string;
  published_at: string;
  as_of: string;
  confidence: string;
  confidence_reason: string;
  assumptions: string;
  owner: string;
  status: string;
  agent_id: string;
  agent_name: string;
  agent_version: string;
  model: string | null;
  prompt_hash: string | null;
  turn_id: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    claim: row.claim,
    quote: row.quote,
    documentId: row.document_id,
    documentTitle: row.document_title,
    sourceType: row.source_type as Finding['sourceType'],
    basis: row.basis as Finding['basis'],
    publishedAt: row.published_at,
    asOf: row.as_of,
    confidence: row.confidence as Finding['confidence'],
    confidenceReason: row.confidence_reason,
    assumptions: JSON.parse(row.assumptions) as string[],
    owner: row.owner,
    status: row.status as Finding['status'],
    draftedBy: {
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentVersion: row.agent_version,
      model: row.model,
      promptHash: row.prompt_hash,
      turnId: row.turn_id,
    },
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
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
    dataRoomOf: db.prepare('SELECT as_of, created_at FROM data_rooms WHERE workspace_id = ?'),
    insertDataRoom: db.prepare('INSERT INTO data_rooms (workspace_id, as_of, created_at) VALUES (?, ?, ?)'),
    documentsOf: db.prepare('SELECT * FROM data_room_documents WHERE workspace_id = ?'),
    documentById: db.prepare('SELECT * FROM data_room_documents WHERE workspace_id = ? AND id = ?'),
    insertDocument: db.prepare(
      `INSERT INTO data_room_documents (workspace_id, id, title, source_type, published_at, url, provided, origin, body, added_at)
       VALUES (:workspace_id, :id, :title, :source_type, :published_at, :url, :provided, :origin, :body, :added_at)`,
    ),
    withdrawDocument: db.prepare(
      `UPDATE data_room_documents SET withdrawn_at = :now, withdrawn_reason = :reason
       WHERE workspace_id = :workspace_id AND id = :id AND withdrawn_at IS NULL`,
    ),
    findingsOf: db.prepare(
      `SELECT f.*, d.title AS document_title FROM findings f
       JOIN data_room_documents d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
       WHERE f.workspace_id = ? ORDER BY CAST(SUBSTR(f.id, 3) AS INTEGER)`,
    ),
    findingById: db.prepare(
      `SELECT f.*, d.title AS document_title FROM findings f
       JOIN data_room_documents d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
       WHERE f.workspace_id = ? AND f.id = ?`,
    ),
    nextFindingNumber: db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) + 1 AS next FROM findings WHERE workspace_id = ?"),
    insertFinding: db.prepare(
      `INSERT INTO findings (workspace_id, id, claim, quote, document_id, source_type, basis, published_at, as_of, confidence, confidence_reason,
         assumptions, owner, status, agent_id, agent_name, agent_version, model, prompt_hash, turn_id, created_at)
       VALUES (:workspace_id, :id, :claim, :quote, :document_id, :source_type, :basis, :published_at, :as_of, :confidence, :confidence_reason,
         :assumptions, :owner, 'draft', :agent_id, :agent_name, :agent_version, :model, :prompt_hash, :turn_id, :created_at)`,
    ),
    updateFindingDecision: db.prepare(
      `UPDATE findings SET status = :status, decided_at = :at, decided_by = :by, decision_note = :note
       WHERE workspace_id = :workspace_id AND id = :id AND status = 'draft'`,
    ),
    insertFindingEvent: db.prepare('INSERT INTO finding_events (workspace_id, finding_id, kind, at, actor, note) VALUES (?, ?, ?, ?, ?, ?)'),
    findingEventsOf: db.prepare('SELECT id, finding_id, kind, at, actor, note FROM finding_events WHERE workspace_id = ? ORDER BY id'),
    openQuestionsOf: db.prepare("SELECT * FROM open_questions WHERE workspace_id = ? ORDER BY CAST(SUBSTR(id, 3) AS INTEGER)"),
    nextQuestionNumber: db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) + 1 AS next FROM open_questions WHERE workspace_id = ?"),
    insertOpenQuestion: db.prepare(
      `INSERT INTO open_questions (workspace_id, id, claim, reason_code, reason, document_id, turn_id, agent_id, agent_name, created_at)
       VALUES (:workspace_id, :id, :claim, :reason_code, :reason, :document_id, :turn_id, :agent_id, :agent_name, :created_at)`,
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
  function readDataRoom(workspaceId: WorkspaceId): DataRoom | null {
    const room = sql.dataRoomOf.get(workspaceId) as { as_of: string; created_at: string } | undefined;
    if (!room) return null;
    const documents = (sql.documentsOf.all(workspaceId) as unknown as DocumentRow[]).map(toDocument).sort(compareDocumentIds);
    return { workspaceId, asOf: room.as_of, createdAt: room.created_at, documents };
  }

  function readDocument(workspaceId: WorkspaceId, documentId: string): DataRoomDocument | null {
    const row = sql.documentById.get(workspaceId, documentId) as DocumentRow | undefined;
    return row ? toDocument(row) : null;
  }

  /** Checks one document against the room's as-of date and writes it. The caller holds the transaction. */
  function writeDocument(workspaceId: WorkspaceId, asOf: string, input: NewDocument, id: string, at: string): void {
    const checked = checkNewDocument({ ...input, id }, asOf, input.origin ?? 'added');
    if (!checked.ok) throw new RangeError(`${id}: ${checked.message}`);
    const document = checked.document;
    sql.insertDocument.run({
      workspace_id: workspaceId,
      id,
      title: document.title,
      source_type: document.sourceType,
      published_at: document.publishedAt,
      url: document.url,
      provided: document.provided ? 1 : 0,
      origin: document.origin,
      body: document.text,
      added_at: at,
    });
  }

  const toQuestion = (row: Record<string, unknown>): OpenQuestion => ({
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    claim: row.claim as string,
    reasonCode: row.reason_code as OpenQuestion['reasonCode'],
    reason: row.reason as string,
    documentId: (row.document_id as string | null) ?? null,
    raisedBy: { agentId: row.agent_id as string, agentName: row.agent_name as string, turnId: row.turn_id as string },
    createdAt: row.created_at as string,
  });

  const readFinding = (workspaceId: WorkspaceId, id: string): Finding | null => {
    const row = sql.findingById.get(workspaceId, id) as FindingRow | undefined;
    return row ? toFinding(row) : null;
  };

  const numbered = (prefix: string, next: unknown) => `${prefix}-${String(Number(next)).padStart(3, '0')}`;

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

    getDataRoom(workspaceId) {
      requireNonEmpty('workspaceId', workspaceId);
      return readDataRoom(workspaceId);
    },

    createDataRoom(workspaceId, input) {
      requireNonEmpty('workspaceId', workspaceId);
      const asOf = checkAsOf(input.asOf);
      if (!asOf.ok) throw new RangeError(asOf.message);
      const at = timestamp();
      // One transaction: the room and all its documents are saved together or not at all.
      return immediateTransaction(db, () => {
        if (sql.dataRoomOf.get(workspaceId)) throw new DataRoomExistsError(workspaceId);
        const given = input.documents.flatMap((document) => (document.id === undefined ? [] : [document.id]));
        if (new Set(given).size !== given.length) throw new RangeError('documents lists the same id twice');
        sql.insertDataRoom.run(workspaceId, asOf.asOf, at);
        const used = [...given];
        for (const document of input.documents) {
          const id = document.id ?? nextDocumentId(used);
          if (document.id === undefined) used.push(id);
          writeDocument(workspaceId, asOf.asOf, document, id, at);
        }
        return mustExist(readDataRoom(workspaceId) ?? undefined, 'the data room just created');
      });
    },

    addDocument(workspaceId, input) {
      requireNonEmpty('workspaceId', workspaceId);
      const at = timestamp();
      return immediateTransaction(db, () => {
        const room = sql.dataRoomOf.get(workspaceId) as { as_of: string } | undefined;
        if (!room) throw new NoDataRoomError(workspaceId);
        const existing = (sql.documentsOf.all(workspaceId) as unknown as DocumentRow[]).map((row) => row.id);
        const id = input.id ?? nextDocumentId(existing);
        if (existing.includes(id)) throw new DuplicateDocumentError(id);
        writeDocument(workspaceId, room.as_of, input, id, at);
        return mustExist(readDocument(workspaceId, id) ?? undefined, 'the document just added');
      });
    },

    withdrawDocument(workspaceId, documentId, reason) {
      requireNonEmpty('workspaceId', workspaceId);
      const why = typeof reason === 'string' ? reason.trim() : '';
      if (why === '' || why.length > MAX_REASON_CHARS) {
        throw new RangeError(`the reason must be 1 to ${MAX_REASON_CHARS} characters`);
      }
      const at = timestamp();
      return immediateTransaction(db, () => {
        if (!sql.dataRoomOf.get(workspaceId)) throw new NoDataRoomError(workspaceId);
        const document = readDocument(workspaceId, documentId);
        if (!document) throw new DocumentNotFoundError(documentId);
        if (document.withdrawnAt !== null) return document;
        sql.withdrawDocument.run({ workspace_id: workspaceId, id: documentId, now: at, reason: why });
        return mustExist(readDocument(workspaceId, documentId) ?? undefined, 'the document just withdrawn');
      });
    },

    listFindings(workspaceId) {
      requireNonEmpty('workspaceId', workspaceId);
      return (sql.findingsOf.all(workspaceId) as unknown as FindingRow[]).map(toFinding);
    },

    listOpenQuestions(workspaceId) {
      requireNonEmpty('workspaceId', workspaceId);
      return (sql.openQuestionsOf.all(workspaceId) as Record<string, unknown>[]).map(toQuestion);
    },

    listFindingEvents(workspaceId) {
      requireNonEmpty('workspaceId', workspaceId);
      return (sql.findingEventsOf.all(workspaceId) as Array<Record<string, unknown>>).map(
        (row): FindingEvent => ({
          id: Number(row.id),
          findingId: row.finding_id as string,
          kind: row.kind as FindingEvent['kind'],
          at: row.at as string,
          by: row.actor as string,
          note: (row.note as string | null) ?? null,
        }),
      );
    },

    proposeFindings(workspaceId, input) {
      requireNonEmpty('workspaceId', workspaceId);
      requireNonEmpty('owner', input.owner);
      requireNonEmpty('agent.agentId', input.agent.agentId);
      requireNonEmpty('agent.agentName', input.agent.agentName);
      requireNonEmpty('agent.agentVersion', input.agent.agentVersion);
      const at = timestamp();
      // One transaction: every draft, every open question and every event, or nothing.
      return immediateTransaction(db, () => {
        const room = readDataRoom(workspaceId);
        if (room === null) throw new NoDataRoomError(workspaceId);
        if (!sql.turnById.get(input.turnId)) throw new RangeError(`turn ${input.turnId} does not exist`);

        // The second wall: the same checker the proposal turn used, against the room as it is now. Every document
        // of the room counts as shown here; which ones the agent really saw was decided by the turn.
        const context: ProposalContext = {
          asOf: room.asOf,
          documents: new Map(
            room.documents.map((document) => [
              document.id,
              {
                sourceType: document.sourceType,
                title: document.title,
                publishedAt: document.publishedAt,
                withdrawn: document.withdrawnAt !== null,
                texts: document.text === null ? [] : [document.text, neutraliseUntrusted(document.text)],
              },
            ]),
          ),
          shownIds: new Set(room.documents.map((document) => document.id)),
        };

        const findingIds: string[] = [];
        let next = Number((sql.nextFindingNumber.get(workspaceId) as { next: number }).next);
        for (const proposed of input.findings) {
          const result = checkProposedFinding(proposed, context);
          if (!result.ok) throw new RangeError(`${proposed.documentId}: ${result.message}`);
          const finding = result.finding;
          const id = numbered('F', next);
          next += 1;
          sql.insertFinding.run({
            workspace_id: workspaceId,
            id,
            claim: finding.claim,
            quote: finding.quote,
            document_id: finding.documentId,
            source_type: finding.sourceType,
            basis: finding.basis,
            published_at: finding.publishedAt,
            as_of: room.asOf,
            confidence: finding.confidence,
            confidence_reason: finding.confidenceReason,
            assumptions: JSON.stringify(finding.assumptions),
            owner: input.owner.trim(),
            agent_id: input.agent.agentId,
            agent_name: input.agent.agentName,
            agent_version: input.agent.agentVersion,
            model: input.agent.model,
            prompt_hash: input.agent.promptHash,
            turn_id: input.turnId,
            created_at: at,
          });
          sql.insertFindingEvent.run(workspaceId, id, 'proposed', at, `agent:${input.agent.agentId}`, null);
          findingIds.push(id);
        }

        const questionIds: string[] = [];
        let nextQuestion = Number((sql.nextQuestionNumber.get(workspaceId) as { next: number }).next);
        for (const refusal of input.refused) {
          const id = numbered('Q', nextQuestion);
          nextQuestion += 1;
          sql.insertOpenQuestion.run({
            workspace_id: workspaceId,
            id,
            claim: refusal.claim.trim().slice(0, 600) || '(no claim given)',
            reason_code: refusal.code,
            reason: refusal.message.trim().slice(0, 300) || 'No reason was given.',
            document_id: refusal.documentId,
            turn_id: input.turnId,
            agent_id: input.agent.agentId,
            agent_name: input.agent.agentName,
            created_at: at,
          });
          questionIds.push(id);
        }

        const questions = (sql.openQuestionsOf.all(workspaceId) as Record<string, unknown>[]).map(toQuestion);
        return {
          findings: findingIds.map((id) => mustExist(readFinding(workspaceId, id) ?? undefined, `finding ${id}`)),
          openQuestions: questions.filter((question) => questionIds.includes(question.id)),
        };
      });
    },

    decideFinding(workspaceId, findingId, decision, note) {
      requireNonEmpty('workspaceId', workspaceId);
      if (decision !== 'accepted' && decision !== 'rejected') throw new RangeError('a decision is accepted or rejected');
      const trimmed = typeof note === 'string' ? note.trim() : '';
      if (trimmed.length > MAX_DECISION_NOTE_CHARS) throw new RangeError(`the note is longer than ${MAX_DECISION_NOTE_CHARS} characters`);
      const at = timestamp();
      return immediateTransaction(db, () => {
        const finding = readFinding(workspaceId, findingId);
        if (finding === null) throw new FindingNotFoundError(findingId);
        if (finding.status !== 'draft') throw new FindingAlreadyDecidedError(findingId, finding.status);
        if (decision === 'accepted' && readDocument(workspaceId, finding.documentId)?.withdrawnAt) {
          throw new FindingSourceWithdrawnError(findingId, finding.documentId);
        }
        sql.updateFindingDecision.run({ workspace_id: workspaceId, id: findingId, status: decision, at, by: LOCAL_PERSON, note: trimmed === '' ? null : trimmed });
        sql.insertFindingEvent.run(workspaceId, findingId, decision, at, LOCAL_PERSON, trimmed === '' ? null : trimmed);
        return mustExist(readFinding(workspaceId, findingId) ?? undefined, `finding ${findingId}`);
      });
    },

    close() {
      if (db.isOpen) db.close();
    },
  };
}
