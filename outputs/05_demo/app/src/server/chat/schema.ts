import 'server-only';
import type { SqliteDatabase } from '@/server/db/sqlite';
import { PROPOSAL_REFUSAL_CODES } from '@/shared/contracts';

// The reasons an open question can carry come from the contract, so the list in the database cannot drift from it.
const REASON_CODES_SQL = PROPOSAL_REFUSAL_CODES.map((code) => `'${code}'`).join(', ');

/**
 * The chat schema, one entry per version: entry i takes a database from version i to
 * version i + 1 (PRAGMA user_version). Never edit an entry that has shipped; append one.
 */
export const CHAT_MIGRATIONS: readonly string[] = [
  // Version 1.
  `
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'demo',
    room TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT
  ) STRICT;

  CREATE UNIQUE INDEX threads_one_active_per_room ON threads (workspace_id, room) WHERE archived_at IS NULL;

  -- "New conversation" archives a thread; nothing is ever deleted.
  CREATE TRIGGER threads_never_go BEFORE DELETE ON threads
  BEGIN
    SELECT RAISE(ABORT, 'threads are archived, never deleted');
  END;

  CREATE TABLE turns (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads (id),
    workspace_id TEXT NOT NULL,
    room TEXT NOT NULL,
    seq INTEGER NOT NULL,
    client_turn_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'partial', 'error', 'interrupted')),
    boot_id TEXT NOT NULL,
    route_json TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    deadline_at TEXT NOT NULL,
    error_code TEXT,
    correlation_id TEXT,
    -- Exactly the finished turns have an end time.
    CHECK ((status = 'running') = (ended_at IS NULL))
  ) STRICT;

  -- The room lock: at most one running turn per room.
  CREATE UNIQUE INDEX turns_one_running_per_room ON turns (workspace_id, room) WHERE status = 'running';
  CREATE UNIQUE INDEX turns_in_order ON turns (thread_id, seq);

  -- A terminal status is set once: a finished turn never changes.
  CREATE TRIGGER finished_turns_never_change BEFORE UPDATE ON turns WHEN OLD.status <> 'running'
  BEGIN
    SELECT RAISE(ABORT, 'a finished turn never changes');
  END;
  CREATE TRIGGER turns_never_go BEFORE DELETE ON turns
  BEGIN
    SELECT RAISE(ABORT, 'turns are never deleted');
  END;

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads (id),
    turn_id TEXT NOT NULL REFERENCES turns (id),
    room TEXT NOT NULL,
    seq INTEGER NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('human', 'agent', 'note')),
    agent_id TEXT,
    agent_name TEXT,
    agent_version TEXT,
    prompt_hash TEXT,
    model TEXT,
    -- Chat is derived data: it never enters an evidence corpus.
    provenance TEXT NOT NULL CHECK (provenance = 'derived'),
    status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'error')),
    truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
    content TEXT NOT NULL,
    error_code TEXT,
    correlation_id TEXT,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX messages_in_order ON messages (thread_id, seq);
  CREATE UNIQUE INDEX messages_one_question_per_turn ON messages (turn_id) WHERE author = 'human';

  -- Append-only: a saved message is never changed or removed.
  CREATE TRIGGER messages_never_change BEFORE UPDATE ON messages
  BEGIN
    SELECT RAISE(ABORT, 'messages are append-only');
  END;
  CREATE TRIGGER messages_never_go BEFORE DELETE ON messages
  BEGIN
    SELECT RAISE(ABORT, 'messages are append-only');
  END;

  -- "Selected for this DD": one switch per agent and workspace.
  CREATE TABLE selection (
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, agent_id)
  ) STRICT;

  -- Workspaces that saved a selection. Without a row here the caller uses its defaults,
  -- which keeps a saved empty selection apart from no saved selection.
  CREATE TABLE selection_saves (
    workspace_id TEXT PRIMARY KEY,
    saved_at TEXT NOT NULL
  ) STRICT;
  `,
  // Version 2: the DD setup (development stage and asset classifications) per workspace. The stage is
  // one of the four development stages. SQLite cannot check each element of the classification list
  // against a table, so the store validates the ids and the database checks that it is a JSON array.
  `
  CREATE TABLE dd_setup (
    workspace_id TEXT PRIMARY KEY,
    stage TEXT NOT NULL CHECK (stage IN ('Phase 1', 'Phase 2', 'Phase 3', 'Filed')),
    classifications TEXT NOT NULL CHECK (json_valid(classifications) AND json_type(classifications) = 'array'),
    updated_at TEXT NOT NULL
  ) STRICT;
  `,
  // Version 3: the data room. One room per workspace with a fixed as-of date; documents that never change
  // (only a withdrawal, once, with a reason). SQLite cannot compare dates across tables in a CHECK, so a
  // trigger refuses a document dated after the room's as-of date; the store checks the same rule first, to
  // give a readable message. The text is capped at 12000 characters here as well as in the app.
  `
  CREATE TABLE data_rooms (
    workspace_id TEXT PRIMARY KEY,
    as_of TEXT NOT NULL CHECK (as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE data_room_documents (
    workspace_id TEXT NOT NULL REFERENCES data_rooms (workspace_id),
    id TEXT NOT NULL CHECK (id GLOB 'DR-[0-9][0-9]' OR id GLOB 'DR-[0-9][0-9][0-9]'),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    source_type TEXT NOT NULL CHECK (source_type IN ('company-disclosure', 'agency-record', 'registry', 'publication')),
    published_at TEXT CHECK (published_at IS NULL OR published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    url TEXT CHECK (url IS NULL OR length(url) <= 500),
    provided INTEGER NOT NULL CHECK (provided IN (0, 1)),
    origin TEXT NOT NULL CHECK (origin IN ('practice-pack', 'added')),
    body TEXT,
    added_at TEXT NOT NULL,
    withdrawn_at TEXT,
    withdrawn_reason TEXT,
    PRIMARY KEY (workspace_id, id),
    CHECK (
      (provided = 1 AND body IS NOT NULL AND published_at IS NOT NULL AND length(body) BETWEEN 1 AND 12000)
      OR (provided = 0 AND body IS NULL)
    ),
    CHECK (
      (withdrawn_at IS NULL AND withdrawn_reason IS NULL)
      OR (withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL AND length(withdrawn_reason) BETWEEN 1 AND 300)
    )
  ) STRICT;

  CREATE TRIGGER data_room_documents_as_of
  BEFORE INSERT ON data_room_documents
  WHEN NEW.published_at IS NOT NULL
    AND NEW.published_at > (SELECT as_of FROM data_rooms WHERE workspace_id = NEW.workspace_id)
  BEGIN
    SELECT RAISE(ABORT, 'a document dated after the data room as-of date cannot be added');
  END;

  CREATE TRIGGER data_room_documents_no_update
  BEFORE UPDATE ON data_room_documents
  WHEN NOT (
    OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL
    AND NEW.workspace_id IS OLD.workspace_id AND NEW.id IS OLD.id AND NEW.title IS OLD.title
    AND NEW.source_type IS OLD.source_type AND NEW.published_at IS OLD.published_at AND NEW.url IS OLD.url
    AND NEW.provided IS OLD.provided AND NEW.origin IS OLD.origin AND NEW.body IS OLD.body AND NEW.added_at IS OLD.added_at
  )
  BEGIN
    SELECT RAISE(ABORT, 'a data room document cannot be changed, only withdrawn');
  END;

  CREATE TRIGGER data_room_documents_no_delete
  BEFORE DELETE ON data_room_documents
  BEGIN
    SELECT RAISE(ABORT, 'a data room document cannot be deleted');
  END;

  CREATE TRIGGER data_rooms_no_update
  BEFORE UPDATE ON data_rooms
  BEGIN
    SELECT RAISE(ABORT, 'a data room cannot be changed');
  END;

  CREATE TRIGGER data_rooms_no_delete
  BEFORE DELETE ON data_rooms
  BEGIN
    SELECT RAISE(ABORT, 'a data room cannot be deleted');
  END;
  `,
  // Version 4: the findings register. An agent's claim enters only as a draft; a person decides it once; a finding is
  // never edited or deleted; every proposal and decision is an event in an append-only trail. A claim that did not
  // become a finding is an open question. Accepting a finding whose document has been withdrawn is refused by a trigger.
  `
  CREATE TABLE findings (
    workspace_id TEXT NOT NULL REFERENCES data_rooms (workspace_id),
    id TEXT NOT NULL CHECK (id GLOB 'F-[0-9][0-9][0-9]*'),
    claim TEXT NOT NULL CHECK (length(claim) BETWEEN 1 AND 600),
    quote TEXT NOT NULL CHECK (length(quote) BETWEEN 15 AND 600),
    document_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('company-disclosure', 'agency-record', 'registry', 'publication')),
    basis TEXT NOT NULL CHECK (basis IN ('attributed', 'primary-record')),
    published_at TEXT NOT NULL CHECK (published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    as_of TEXT NOT NULL CHECK (as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    confidence_reason TEXT NOT NULL CHECK (length(confidence_reason) BETWEEN 1 AND 300),
    assumptions TEXT NOT NULL CHECK (json_valid(assumptions) AND json_type(assumptions) = 'array'),
    owner TEXT NOT NULL CHECK (length(owner) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected')),
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    model TEXT,
    prompt_hash TEXT,
    turn_id TEXT NOT NULL REFERENCES turns (id),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 1 AND 300),
    PRIMARY KEY (workspace_id, id),
    FOREIGN KEY (workspace_id, document_id) REFERENCES data_room_documents (workspace_id, id),
    CHECK ((basis = 'attributed') = (source_type = 'company-disclosure')),
    CHECK (
      (status = 'draft' AND decided_at IS NULL AND decided_by IS NULL AND decision_note IS NULL)
      OR (status <> 'draft' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
    )
  ) STRICT;

  CREATE TRIGGER findings_only_drafts
  BEFORE INSERT ON findings
  WHEN NEW.status <> 'draft'
  BEGIN
    SELECT RAISE(ABORT, 'only a draft can be put in the register: a person decides a finding');
  END;

  CREATE TRIGGER findings_decide_once
  BEFORE UPDATE ON findings
  WHEN NOT (
    OLD.status = 'draft' AND NEW.status IN ('accepted', 'rejected')
    AND NEW.workspace_id IS OLD.workspace_id AND NEW.id IS OLD.id AND NEW.claim IS OLD.claim AND NEW.quote IS OLD.quote
    AND NEW.document_id IS OLD.document_id AND NEW.source_type IS OLD.source_type AND NEW.basis IS OLD.basis
    AND NEW.published_at IS OLD.published_at AND NEW.as_of IS OLD.as_of AND NEW.confidence IS OLD.confidence
    AND NEW.confidence_reason IS OLD.confidence_reason AND NEW.assumptions IS OLD.assumptions AND NEW.owner IS OLD.owner
    AND NEW.agent_id IS OLD.agent_id AND NEW.agent_name IS OLD.agent_name AND NEW.agent_version IS OLD.agent_version
    AND NEW.model IS OLD.model AND NEW.prompt_hash IS OLD.prompt_hash AND NEW.turn_id IS OLD.turn_id
    AND NEW.created_at IS OLD.created_at
  )
  BEGIN
    SELECT RAISE(ABORT, 'a finding cannot be changed, only decided once');
  END;

  CREATE TRIGGER findings_not_accepted_when_withdrawn
  BEFORE UPDATE ON findings
  WHEN NEW.status = 'accepted'
    AND (SELECT withdrawn_at FROM data_room_documents WHERE workspace_id = NEW.workspace_id AND id = NEW.document_id) IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'a finding whose document was withdrawn cannot be accepted');
  END;

  CREATE TRIGGER findings_no_delete
  BEFORE DELETE ON findings
  BEGIN
    SELECT RAISE(ABORT, 'a finding cannot be deleted');
  END;

  CREATE TABLE finding_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('proposed', 'accepted', 'rejected')),
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    note TEXT,
    FOREIGN KEY (workspace_id, finding_id) REFERENCES findings (workspace_id, id)
  ) STRICT;

  CREATE TRIGGER finding_events_no_update
  BEFORE UPDATE ON finding_events
  BEGIN
    SELECT RAISE(ABORT, 'a finding event cannot be changed');
  END;

  CREATE TRIGGER finding_events_no_delete
  BEFORE DELETE ON finding_events
  BEGIN
    SELECT RAISE(ABORT, 'a finding event cannot be deleted');
  END;

  CREATE TABLE open_questions (
    workspace_id TEXT NOT NULL REFERENCES data_rooms (workspace_id),
    id TEXT NOT NULL CHECK (id GLOB 'Q-[0-9][0-9][0-9]*'),
    claim TEXT NOT NULL CHECK (length(claim) BETWEEN 1 AND 600),
    reason_code TEXT NOT NULL CHECK (reason_code IN (${REASON_CODES_SQL})),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
    document_id TEXT,
    turn_id TEXT NOT NULL REFERENCES turns (id),
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id)
  ) STRICT;

  CREATE TRIGGER open_questions_no_update
  BEFORE UPDATE ON open_questions
  BEGIN
    SELECT RAISE(ABORT, 'an open question cannot be changed');
  END;

  CREATE TRIGGER open_questions_no_delete
  BEFORE DELETE ON open_questions
  BEGIN
    SELECT RAISE(ABORT, 'an open question cannot be deleted');
  END;
  `,
];

/**
 * Runs `work` inside BEGIN IMMEDIATE ... COMMIT and rolls back if it throws.
 * IMMEDIATE takes the write lock up front, so a read-check-write sequence cannot interleave
 * with another connection (another server process) writing the same file.
 * Not re-entrant: never call it from inside `work`.
 */
export function immediateTransaction<T>(db: SqliteDatabase, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function schemaVersion(db: SqliteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get();
  const version = row?.user_version;
  if (typeof version !== 'number') throw new Error('could not read the chat database schema version');
  return version;
}

/**
 * Brings the database up to the newest version. Each step runs in its own transaction
 * together with its user_version bump, so a failed step leaves the previous version intact.
 * Throws, changing nothing, when the file is newer than this code.
 */
export function migrateChatSchema(db: SqliteDatabase, migrations: readonly string[] = CHAT_MIGRATIONS): void {
  const latest = migrations.length;
  for (;;) {
    const upToDate = immediateTransaction(db, () => {
      // Read inside the transaction: another process may have migrated in the meantime.
      const current = schemaVersion(db);
      if (current > latest) {
        throw new Error(
          `the chat database has schema version ${current}, newer than this app's version ${latest}; refusing to use it`,
        );
      }
      if (current === latest) return true;
      db.exec(migrations[current]);
      db.exec(`PRAGMA user_version = ${current + 1}`);
      return false;
    });
    if (upToDate) return;
  }
}
