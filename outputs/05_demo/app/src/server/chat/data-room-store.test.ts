import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import type { NewDocument, Store } from '@/shared/contracts';
import { CHAT_MIGRATIONS, migrateChatSchema } from './schema';
import { createStore, DataRoomExistsError, DocumentNotFoundError, DuplicateDocumentError, NoDataRoomError } from './store';

// The data room in the chat database: the store's methods, and what the database itself refuses
// (documents never change, a late document cannot get in, a room has one as-of date for good).

const START = '2026-10-12T08:00:00.000Z';
const AS_OF = '2026-10-12';

let dir: string;
let dbPath: string;
let clockMs: number;
const stores: Store[] = [];
const raws: SqliteDatabase[] = [];

const now = () => new Date(clockMs);

function openStore(): Store {
  const store = createStore(dbPath, { now });
  stores.push(store);
  return store;
}

function openRaw(): SqliteDatabase {
  const db = openDatabase(dbPath);
  raws.push(db);
  return db;
}

function doc(overrides: Partial<NewDocument> = {}): NewDocument {
  return { title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', url: null, provided: true, text: 'Overview of the asset.', ...overrides };
}

const notProvided = (overrides: Partial<NewDocument> = {}) =>
  doc({ title: 'Paediatric study plan', provided: false, text: null, publishedAt: null, ...overrides });

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'data-room-store-'));
  dbPath = join(dir, 'chat.db');
  clockMs = Date.parse(START);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of raws.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('getDataRoom and createDataRoom', () => {
  it('has no data room until one is started, and each workspace has its own', () => {
    const store = openStore();

    expect(store.getDataRoom('demo')).toBeNull();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [] });

    expect(store.getDataRoom('demo')).toEqual({ workspaceId: 'demo', asOf: AS_OF, createdAt: START, documents: [] });
    expect(store.getDataRoom('case-2')).toBeNull();
  });

  it('starts the room with its documents: given ids kept, the rest numbered after them, text and flags as given', () => {
    const store = openStore();

    const room = store.createDataRoom('demo', {
      asOf: AS_OF,
      documents: [
        doc({ id: 'DR-10', title: 'Term sheet', publishedAt: '2026-07-28', origin: 'practice-pack' }),
        notProvided({ id: 'DR-09' }),
        doc({ title: 'Without an id', text: 'x' }),
      ],
    });

    expect(room.documents.map((entry) => entry.id)).toEqual(['DR-09', 'DR-10', 'DR-11']);
    const [plan, term, plain] = room.documents;
    expect(plan).toMatchObject({ provided: false, text: null, publishedAt: null, origin: 'added', addedAt: START, withdrawnAt: null, withdrawnReason: null });
    expect(term).toMatchObject({ title: 'Term sheet', origin: 'practice-pack', text: 'Overview of the asset.', publishedAt: '2026-07-28' });
    expect(plain).toMatchObject({ title: 'Without an id', origin: 'added' });
    expect(store.getDataRoom('demo')).toEqual(room);
  });

  it('keeps the documents in numeric id order, so DR-100 comes after DR-11', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-100' }), doc({ id: 'DR-11' }), doc({ id: 'DR-02' })] });

    expect(store.getDataRoom('demo')?.documents.map((entry) => entry.id)).toEqual(['DR-02', 'DR-11', 'DR-100']);
  });

  it('allows one data room per workspace: a second start is refused and changes nothing', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });

    const error = thrownBy(() => store.createDataRoom('demo', { asOf: '2026-12-01', documents: [] }));

    expect(error).toBeInstanceOf(DataRoomExistsError);
    expect(store.getDataRoom('demo')).toMatchObject({ asOf: AS_OF });
    expect(store.getDataRoom('demo')?.documents).toHaveLength(1);
  });

  it('saves the room and all its documents or nothing: one bad document undoes the lot', () => {
    const store = openStore();

    const error = thrownBy(() => store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' }), doc({ id: 'DR-02', publishedAt: '2026-10-13' })] }));

    expect(error).toBeInstanceOf(RangeError);
    expect(String((error as Error).message)).toMatch(/after the as-of date/);
    expect(store.getDataRoom('demo')).toBeNull();
    // Positive control: the same call without the late document is saved.
    expect(store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] }).documents).toHaveLength(1);
  });

  it.each(['12 October', '2026-02-30', ''])('refuses the as-of date %j', (asOf) => {
    const store = openStore();

    expect(thrownBy(() => store.createDataRoom('demo', { asOf, documents: [] }))).toBeInstanceOf(RangeError);
    expect(store.getDataRoom('demo')).toBeNull();
  });

  it('refuses two documents with the same id', () => {
    const store = openStore();

    expect(thrownBy(() => store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' }), doc({ id: 'DR-01', title: 'Other' })] }))).toBeInstanceOf(RangeError);
    expect(store.getDataRoom('demo')).toBeNull();
  });

  it('refuses an empty workspace id', () => {
    const store = openStore();

    expect(thrownBy(() => store.createDataRoom('', { asOf: AS_OF, documents: [] }))).toBeInstanceOf(TypeError);
    expect(thrownBy(() => store.getDataRoom(''))).toBeInstanceOf(TypeError);
  });

  it('survives a restart: the room is read back from the file', () => {
    openStore().createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    stores.splice(0).forEach((store) => store.close());

    expect(openStore().getDataRoom('demo')?.documents.map((entry) => entry.id)).toEqual(['DR-01']);
  });
});

describe('addDocument', () => {
  it('gives the next free id, marks it added, and shows it in the room', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-03' })] });
    clockMs += 60_000;

    const added = store.addDocument('demo', doc({ title: 'Second', url: 'https://example.org/second' }));

    expect(added).toMatchObject({ id: 'DR-04', title: 'Second', origin: 'added', url: 'https://example.org/second', addedAt: '2026-10-12T08:01:00.000Z' });
    expect(store.getDataRoom('demo')?.documents.map((entry) => entry.id)).toEqual(['DR-03', 'DR-04']);
  });

  it('never reuses an id, not even one whose document was withdrawn', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    store.withdrawDocument('demo', 'DR-01', 'wrong file');

    expect(store.addDocument('demo', doc()).id).toBe('DR-02');
  });

  it('refuses a document dated after the as-of date, and saves nothing', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [] });

    const error = thrownBy(() => store.addDocument('demo', doc({ publishedAt: '2026-10-13' })));

    expect(error).toBeInstanceOf(RangeError);
    expect(store.getDataRoom('demo')?.documents).toEqual([]);
    // Positive control: dated on the as-of date it is accepted.
    expect(store.addDocument('demo', doc({ publishedAt: AS_OF })).id).toBe('DR-01');
  });

  it('refuses an invalid document with a RangeError that says what is wrong', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [] });

    const error = thrownBy(() => store.addDocument('demo', doc({ title: '   ' })));

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/title/);
  });

  it('needs a data room', () => {
    const store = openStore();

    expect(thrownBy(() => store.addDocument('demo', doc()))).toBeInstanceOf(NoDataRoomError);
  });

  it('refuses an id that is already taken', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-05' })] });

    expect(thrownBy(() => store.addDocument('demo', doc({ id: 'DR-05' })))).toBeInstanceOf(DuplicateDocumentError);
    expect(store.getDataRoom('demo')?.documents).toHaveLength(1);
  });

  it('accepts a listed document that is not provided', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [] });

    expect(store.addDocument('demo', notProvided())).toMatchObject({ provided: false, text: null, publishedAt: null });
  });
});

describe('withdrawDocument', () => {
  it('marks the document withdrawn with the time and the reason, and keeps its text', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    clockMs += 5_000;

    const withdrawn = store.withdrawDocument('demo', 'DR-01', '  pasted into the wrong room  ');

    expect(withdrawn).toMatchObject({ id: 'DR-01', withdrawnAt: '2026-10-12T08:00:05.000Z', withdrawnReason: 'pasted into the wrong room', text: 'Overview of the asset.' });
    expect(store.getDataRoom('demo')?.documents[0]).toEqual(withdrawn);
  });

  it('answers a second withdrawal with the first, unchanged', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    const first = store.withdrawDocument('demo', 'DR-01', 'first reason');
    clockMs += 5_000;

    expect(store.withdrawDocument('demo', 'DR-01', 'second reason')).toEqual(first);
  });

  it('refuses an empty or over-long reason, and withdraws nothing', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });

    expect(thrownBy(() => store.withdrawDocument('demo', 'DR-01', '   '))).toBeInstanceOf(RangeError);
    expect(thrownBy(() => store.withdrawDocument('demo', 'DR-01', 'x'.repeat(301)))).toBeInstanceOf(RangeError);
    expect(store.getDataRoom('demo')?.documents[0].withdrawnAt).toBeNull();
    // Positive control: a reason of exactly 300 characters is accepted.
    expect(store.withdrawDocument('demo', 'DR-01', 'x'.repeat(300)).withdrawnAt).not.toBeNull();
  });

  it('names a missing document and a missing room', () => {
    const store = openStore();

    expect(thrownBy(() => store.withdrawDocument('demo', 'DR-01', 'why'))).toBeInstanceOf(NoDataRoomError);
    store.createDataRoom('demo', { asOf: AS_OF, documents: [] });
    expect(thrownBy(() => store.withdrawDocument('demo', 'DR-01', 'why'))).toBeInstanceOf(DocumentNotFoundError);
  });

  it('can hide a listed document that was never provided', () => {
    const store = openStore();
    store.createDataRoom('demo', { asOf: AS_OF, documents: [notProvided({ id: 'DR-09' })] });

    expect(store.withdrawDocument('demo', 'DR-09', 'not needed').withdrawnAt).not.toBeNull();
  });
});

describe('what the database refuses by itself', () => {
  function seeded(): SqliteDatabase {
    openStore().createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    return openRaw();
  }

  const insertDocument = (db: SqliteDatabase, values: Partial<Record<string, string | number | null>> = {}) => {
    const row = {
      workspace_id: 'demo', id: 'DR-02', title: 'T', source_type: 'company-disclosure', published_at: '2026-07-01', url: null,
      provided: 1, origin: 'added', body: 'text', added_at: START, ...values,
    };
    db.prepare(
      `INSERT INTO data_room_documents (workspace_id, id, title, source_type, published_at, url, provided, origin, body, added_at)
       VALUES (:workspace_id, :id, :title, :source_type, :published_at, :url, :provided, :origin, :body, :added_at)`,
    ).run(row);
  };

  it('accepts a well-formed row (positive control for the refusals below)', () => {
    const db = seeded();

    expect(() => insertDocument(db)).not.toThrow();
    expect(() => insertDocument(db, { id: 'DR-03', provided: 0, body: null, published_at: null })).not.toThrow();
  });

  it.each([
    ['a document dated after the as-of date', { published_at: '2026-10-13' }, /after the data room as-of date/],
    ['an id that does not fit', { id: 'X-1' }, /CHECK/],
    ['an empty title', { title: '' }, /CHECK/],
    ['an unknown source type', { source_type: 'rumour' }, /CHECK/],
    ['an unknown origin', { origin: 'imported' }, /CHECK/],
    ['a provided document with no text', { body: null }, /CHECK/],
    ['a provided document with no date', { published_at: null }, /CHECK/],
    ['a provided document with empty text', { body: '' }, /CHECK/],
    ['text over the limit', { body: 'x'.repeat(12_001) }, /CHECK/],
    ['a document that is not provided but has text', { provided: 0, published_at: null, body: 'text' }, /CHECK/],
    // '2026-1-1' sorts before the as-of date, so only the shape check can stop it.
    ['a date that is not a date', { published_at: '2026-1-1' }, /CHECK/],
    ['a document for a workspace with no data room', { workspace_id: 'other' }, /FOREIGN KEY/],
  ])('refuses %s', (_label, values, message) => {
    const db = seeded();

    expect(() => insertDocument(db, values)).toThrow(message);
  });

  it('refuses a duplicate id', () => {
    const db = seeded();

    expect(() => insertDocument(db, { id: 'DR-01' })).toThrow(/UNIQUE|PRIMARY/);
  });

  it('refuses any change to a saved document, any delete, and a replace that would sidestep both', () => {
    const db = seeded();

    expect(() => db.exec("UPDATE data_room_documents SET body = 'changed' WHERE id = 'DR-01'")).toThrow(/only withdrawn/);
    expect(() => db.exec("UPDATE data_room_documents SET title = 'changed' WHERE id = 'DR-01'")).toThrow(/only withdrawn/);
    expect(() => db.exec("UPDATE data_room_documents SET published_at = '2026-01-01' WHERE id = 'DR-01'")).toThrow(/only withdrawn/);
    expect(() => db.exec("DELETE FROM data_room_documents WHERE id = 'DR-01'")).toThrow(/cannot be deleted/);
    expect(() => insertDocument(db, { id: 'DR-01', body: 'replaced' })).toThrow();
    expect(() => db.exec("INSERT OR REPLACE INTO data_room_documents (workspace_id, id, title, source_type, published_at, provided, origin, body, added_at) VALUES ('demo','DR-01','T','company-disclosure','2026-07-01',1,'added','replaced','x')")).toThrow();
    expect(db.prepare("SELECT body FROM data_room_documents WHERE id = 'DR-01'").get()?.body).toBe('Overview of the asset.');
  });

  it('allows the one change a document can have, withdrawing it, once, with a reason', () => {
    const db = seeded();

    expect(() => db.exec("UPDATE data_room_documents SET withdrawn_at = 'x' WHERE id = 'DR-01'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE data_room_documents SET withdrawn_at = '2026-10-12T09:00:00.000Z', withdrawn_reason = 'why' WHERE id = 'DR-01'")).not.toThrow();
    expect(() => db.exec("UPDATE data_room_documents SET withdrawn_reason = 'another' WHERE id = 'DR-01'")).toThrow(/only withdrawn/);
    expect(() => db.exec("UPDATE data_room_documents SET withdrawn_at = NULL, withdrawn_reason = NULL WHERE id = 'DR-01'")).toThrow(/only withdrawn/);
  });

  it('never lets the as-of date change or the room go', () => {
    const db = seeded();

    expect(() => db.exec("UPDATE data_rooms SET as_of = '2030-01-01'")).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM data_rooms')).toThrow(/cannot be deleted/);
    expect(() => db.exec("INSERT OR REPLACE INTO data_rooms (workspace_id, as_of, created_at) VALUES ('demo', '2030-01-01', 'x')")).toThrow();
    expect(db.prepare('SELECT as_of FROM data_rooms').get()?.as_of).toBe(AS_OF);
  });

  it('refuses an as-of date that is not a date', () => {
    const db = openRaw();
    migrateChatSchema(db);

    expect(() => db.exec("INSERT INTO data_rooms (workspace_id, as_of, created_at) VALUES ('x', 'soon', 'now')")).toThrow(/CHECK/);
  });
});

describe('upgrading a database that has no data room yet', () => {
  it('adds the tables and keeps what was there', () => {
    const raw = openRaw();
    migrateChatSchema(raw, CHAT_MIGRATIONS.slice(0, 2));
    raw.exec("INSERT INTO dd_setup (workspace_id, stage, classifications, updated_at) VALUES ('demo', 'Phase 3', '[]', 'x')");
    expect(CHAT_MIGRATIONS.length).toBeGreaterThanOrEqual(3);

    const store = openStore();

    expect(store.getDdSetup('demo')).toEqual({ stage: 'Phase 3', classifications: [] });
    expect(store.getDataRoom('demo')).toBeNull();
    expect(store.createDataRoom('demo', { asOf: AS_OF, documents: [] }).documents).toEqual([]);
  });
});
