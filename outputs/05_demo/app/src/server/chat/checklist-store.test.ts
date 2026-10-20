import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { CHECKLIST_ITEM_IDS, LOCAL_PERSON, type Store } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { CHAT_MIGRATIONS, migrateChatSchema } from './schema';
import {
  ChecklistNeedsFindingError,
  createStore,
  FindingAlreadyTaggedError,
  FindingNotAcceptedError,
  FindingNotFoundError,
  FindingSourceWithdrawnError,
} from './store';

// The regulatory checklist and the tags in the chat database: what the store lets a person do (tag an accepted finding
// once, move an item between four states), what it refuses, and what the database refuses by itself.

const START = '2026-10-12T08:00:00.000Z';
const AS_OF = '2026-10-12';
const TEXT_01 = 'The agency has agreed that one adequate and well-controlled pivotal study is sufficient for approval.';
const TEXT_02 = 'The agency did not agree that STUDY-301 alone would suffice. A second study could be requested.';

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checklist-store-'));
  dbPath = join(dir, 'chat.db');
  clockMs = Date.parse(START);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of raws.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const AGENT = { agentId: 'reglead', agentName: 'Rosa', agentVersion: '0.2.0', model: 'model-x', promptHash: 'sha256:abc' };
const OWNER = 'Regulatory lead agent owner';

function checked(overrides: Partial<CheckedFinding> = {}): CheckedFinding {
  return {
    claim: 'The licensor says the agency agreed a single pivotal study is enough.',
    quote: 'one adequate and well-controlled pivotal study is sufficient for approval',
    documentId: 'DR-01',
    documentTitle: 'Licensor overview',
    sourceType: 'company-disclosure',
    basis: 'attributed',
    publishedAt: '2026-07-14',
    confidence: 'medium',
    confidenceReason: 'Explicit, but the seller’s own account.',
    assumptions: [],
    ...overrides,
  };
}

/** A store with a data room and three drafts: F-001 and F-003 on DR-01, F-002 on DR-02. */
function seeded(): Store {
  const store = openStore();
  store.createDataRoom('demo', {
    asOf: AS_OF,
    documents: [
      { id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT_01 },
      { id: 'DR-02', title: 'Agency minutes', sourceType: 'agency-record', publishedAt: '2026-03-20', provided: true, text: TEXT_02 },
    ],
  });
  const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'reglead', clientTurnId: 'c1', bootId: 'boot-1', deadlineAt: '2026-10-12T08:03:00.000Z' });
  store.proposeFindings('demo', {
    turnId: turn.id,
    agent: AGENT,
    owner: OWNER,
    findings: [
      checked(),
      checked({ claim: 'The agency did not agree a single study.', quote: 'did not agree that STUDY-301 alone would suffice', documentId: 'DR-02', documentTitle: 'Agency minutes', sourceType: 'agency-record', basis: 'primary-record', publishedAt: '2026-03-20' }),
      checked({ claim: 'The licensor says the study is sufficient.', quote: 'The agency has agreed that one adequate' }),
    ],
    refused: [],
  });
  return store;
}

const accept = (store: Store, id: string, tag?: Parameters<Store['decideFinding']>[4]) => store.decideFinding('demo', id, 'accepted', null, tag);

describe('tagFinding', () => {
  it('tags an accepted finding once, stamped with the time and the local person', () => {
    const store = seeded();
    accept(store, 'F-001');
    clockMs += 5_000;

    const tag = store.tagFinding('demo', 'F-001', { checklistItem: 'regions', category: 'risk' });

    expect(tag).toEqual({ findingId: 'F-001', checklistItem: 'regions', category: 'risk', taggedAt: new Date(clockMs).toISOString(), taggedBy: LOCAL_PERSON });
    expect(store.listFindingTags('demo')).toEqual([tag]);
  });

  it('refuses a draft and a rejected finding: only an accepted one can be tagged', () => {
    const store = seeded();
    store.decideFinding('demo', 'F-002', 'rejected', null);

    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'regions', category: 'risk' })).toThrow(FindingNotAcceptedError);
    expect(() => store.tagFinding('demo', 'F-002', { checklistItem: 'regions', category: 'risk' })).toThrow(FindingNotAcceptedError);
    expect(store.listFindingTags('demo')).toEqual([]);
  });

  it('names a finding that is not there, and refuses a second tag whatever it says', () => {
    const store = seeded();
    accept(store, 'F-001', { checklistItem: 'guidance', category: 'neutral' });

    expect(() => store.tagFinding('demo', 'F-099', { checklistItem: 'regions', category: 'risk' })).toThrow(FindingNotFoundError);
    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'guidance', category: 'neutral' })).toThrow(FindingAlreadyTaggedError);
    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'regions', category: 'risk' })).toThrow(FindingAlreadyTaggedError);
    expect(store.listFindingTags('demo').map((tag) => [tag.findingId, tag.checklistItem, tag.category])).toEqual([['F-001', 'guidance', 'neutral']]);
  });

  it('refuses an unknown item or category, and a missing one', () => {
    const store = seeded();
    accept(store, 'F-001');

    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'everything', category: 'risk' } as never)).toThrow(RangeError);
    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'regions', category: 'good' } as never)).toThrow(RangeError);
    expect(() => store.tagFinding('demo', 'F-001', {} as never)).toThrow(RangeError);
    expect(store.listFindingTags('demo')).toEqual([]);
  });
});

describe('decideFinding with a tag', () => {
  it('accepts and tags in one step', () => {
    const store = seeded();

    const finding = accept(store, 'F-001', { checklistItem: 'designations', category: 'positive' });

    expect(finding.status).toBe('accepted');
    expect(store.listFindingTags('demo').map((tag) => [tag.findingId, tag.checklistItem, tag.category, tag.taggedBy])).toEqual([['F-001', 'designations', 'positive', LOCAL_PERSON]]);
  });

  it('accepts with no tag, leaving the finding untagged to be tagged later', () => {
    const store = seeded();

    accept(store, 'F-001');

    expect(store.listFindingTags('demo')).toEqual([]);
    expect(() => store.tagFinding('demo', 'F-001', { checklistItem: 'regions', category: 'risk' })).not.toThrow();
  });

  it('does nothing at all when the tag is bad: the finding stays a draft', () => {
    const store = seeded();

    expect(() => accept(store, 'F-001', { checklistItem: 'nope', category: 'risk' } as never)).toThrow(RangeError);

    expect(store.listFindings('demo')[0].status).toBe('draft');
    expect(store.listFindingEvents('demo').map((event) => event.kind)).toEqual(['proposed', 'proposed', 'proposed']);
    expect(store.listFindingTags('demo')).toEqual([]);
  });

  it('does not tag when the acceptance itself is refused (the document was withdrawn)', () => {
    const store = seeded();
    store.withdrawDocument('demo', 'DR-01', 'wrong version');

    expect(() => accept(store, 'F-001', { checklistItem: 'regions', category: 'risk' })).toThrow(FindingSourceWithdrawnError);

    expect(store.listFindingTags('demo')).toEqual([]);
    expect(store.listFindings('demo')[0].status).toBe('draft');
  });

  it('refuses a tag on a rejection: a rejected finding is about nothing', () => {
    const store = seeded();

    expect(() => store.decideFinding('demo', 'F-001', 'rejected', null, { checklistItem: 'regions', category: 'risk' })).toThrow(RangeError);

    expect(store.listFindings('demo')[0].status).toBe('draft');
  });
});

describe('the checklist', () => {
  it('starts with every item not checked, in order, with nobody having touched it', () => {
    const store = seeded();

    const list = store.listChecklist('demo');

    expect(list.map((entry) => entry.item)).toEqual([...CHECKLIST_ITEM_IDS]);
    expect(list.every((entry) => entry.state === 'not_checked' && entry.reason === null && entry.changedAt === null && entry.changedBy === null)).toBe(true);
    expect(store.listChecklistEvents('demo')).toEqual([]);
  });

  it('marks an item checked only when an accepted finding is tagged to it', () => {
    const store = seeded();

    expect(() => store.setChecklistState('demo', 'regions', 'checked', null)).toThrow(ChecklistNeedsFindingError);
    accept(store, 'F-001', { checklistItem: 'guidance', category: 'neutral' });
    expect(() => store.setChecklistState('demo', 'regions', 'checked', null)).toThrow(ChecklistNeedsFindingError);
    store.decideFinding('demo', 'F-002', 'rejected', null);
    expect(() => store.setChecklistState('demo', 'regions', 'checked', null)).toThrow(ChecklistNeedsFindingError);
    expect(store.listChecklist('demo').find((entry) => entry.item === 'regions')?.state).toBe('not_checked');

    const entry = store.setChecklistState('demo', 'guidance', 'checked', 'Read against the minutes.');
    expect(entry).toMatchObject({ item: 'guidance', state: 'checked', reason: 'Read against the minutes.', changedBy: LOCAL_PERSON });
  });

  it('does not count a draft, a rejected finding or a finding tagged to another item', () => {
    const store = seeded();
    store.decideFinding('demo', 'F-002', 'rejected', null);
    accept(store, 'F-003', { checklistItem: 'designations', category: 'positive' });

    for (const item of CHECKLIST_ITEM_IDS.filter((id) => id !== 'designations')) {
      expect(() => store.setChecklistState('demo', item, 'checked', null), item).toThrow(ChecklistNeedsFindingError);
    }
    expect(store.setChecklistState('demo', 'designations', 'checked', null).state).toBe('checked');
  });

  it('takes "not applicable" and "could not check" with a reason, and without needing a finding', () => {
    const store = seeded();

    const na = store.setChecklistState('demo', 'designations', 'not_applicable', '  Not an orphan product.  ');
    const cnc = store.setChecklistState('demo', 'regions', 'could_not_check', 'The Japan filing plan was not provided.');

    expect(na).toMatchObject({ state: 'not_applicable', reason: 'Not an orphan product.' });
    expect(cnc).toMatchObject({ state: 'could_not_check', reason: 'The Japan filing plan was not provided.' });
    expect(() => store.setChecklistState('demo', 'guidance', 'not_applicable', null)).toThrow(RangeError);
    expect(() => store.setChecklistState('demo', 'guidance', 'could_not_check', '   ')).toThrow(RangeError);
  });

  it('stores the reason trimmed, in the checklist and in the event, not as it was typed', () => {
    const store = seeded();

    store.setChecklistState('demo', 'designations', 'not_applicable', '   Not an orphan product.   ');

    expect(store.listChecklist('demo').find((entry) => entry.item === 'designations')?.reason).toBe('Not an orphan product.');
    expect(store.listChecklistEvents('demo')[0].reason).toBe('Not an orphan product.');
  });

  it('keeps the four states apart in the list', () => {
    const store = seeded();
    accept(store, 'F-001', { checklistItem: 'guidance', category: 'neutral' });
    store.setChecklistState('demo', 'guidance', 'checked', null);
    store.setChecklistState('demo', 'designations', 'not_applicable', 'Not an orphan product.');
    store.setChecklistState('demo', 'regions', 'could_not_check', 'Plan not provided.');

    expect(store.listChecklist('demo').map((entry) => [entry.item, entry.state])).toEqual([
      ['guidance', 'checked'],
      ['designations', 'not_applicable'],
      ['regions', 'could_not_check'],
      ['bottlenecks', 'not_checked'],
      ['ptrs-inputs', 'not_checked'],
      ['hta-handover', 'not_checked'],
    ]);
  });

  it('lets a person take a mark back: not checked, with the reason dropped', () => {
    const store = seeded();
    store.setChecklistState('demo', 'regions', 'could_not_check', 'Plan not provided.');

    const back = store.setChecklistState('demo', 'regions', 'not_checked', null);

    expect(back).toMatchObject({ state: 'not_checked', reason: null });
    expect(store.listChecklist('demo').find((entry) => entry.item === 'regions')).toMatchObject({ state: 'not_checked', reason: null });
  });

  it('records every change as an event, oldest first, and never rewrites one', () => {
    const store = seeded();
    store.setChecklistState('demo', 'regions', 'could_not_check', 'Plan not provided.');
    clockMs += 1_000;
    store.setChecklistState('demo', 'regions', 'not_applicable', 'Single-region asset.');
    clockMs += 1_000;
    store.setChecklistState('demo', 'regions', 'not_checked', null);

    expect(store.listChecklistEvents('demo').map((event) => [event.item, event.state, event.reason, event.by])).toEqual([
      ['regions', 'could_not_check', 'Plan not provided.', LOCAL_PERSON],
      ['regions', 'not_applicable', 'Single-region asset.', LOCAL_PERSON],
      ['regions', 'not_checked', null, LOCAL_PERSON],
    ]);
  });

  it('writes nothing when a change is refused', () => {
    const store = seeded();

    expect(() => store.setChecklistState('demo', 'regions', 'checked', null)).toThrow(ChecklistNeedsFindingError);
    expect(() => store.setChecklistState('demo', 'nonsense' as never, 'checked', null)).toThrow(RangeError);
    expect(() => store.setChecklistState('demo', 'regions', 'done' as never, null)).toThrow(RangeError);

    expect(store.listChecklistEvents('demo')).toEqual([]);
  });

  it('keeps each workspace apart', () => {
    const store = seeded();
    store.setChecklistState('demo', 'regions', 'could_not_check', 'Plan not provided.');

    expect(store.listChecklist('other').every((entry) => entry.state === 'not_checked')).toBe(true);
    expect(store.listFindingTags('other')).toEqual([]);
  });
});

describe('what the database refuses by itself', () => {
  function raw(): SqliteDatabase {
    const store = seeded();
    accept(store, 'F-001', { checklistItem: 'guidance', category: 'neutral' });
    store.decideFinding('demo', 'F-002', 'rejected', null);
    return openRaw();
  }

  const insertTag = (db: SqliteDatabase, values: Record<string, string> = {}) => {
    const row = { workspace_id: 'demo', finding_id: 'F-003', checklist_item: 'regions', category: 'risk', tagged_at: START, tagged_by: 'x', ...values };
    db.prepare('INSERT INTO finding_tags (workspace_id, finding_id, checklist_item, category, tagged_at, tagged_by) VALUES (:workspace_id, :finding_id, :checklist_item, :category, :tagged_at, :tagged_by)').run(row);
  };

  const insertState = (db: SqliteDatabase, values: Record<string, string | null> = {}) => {
    const row = { workspace_id: 'demo', item: 'regions', state: 'could_not_check', reason: 'why', changed_at: START, changed_by: 'x', ...values };
    db.prepare('INSERT INTO checklist_states (workspace_id, item, state, reason, changed_at, changed_by) VALUES (:workspace_id, :item, :state, :reason, :changed_at, :changed_by)').run(row);
  };

  it('accepts an accepted finding’s tag and a well-formed state (positive controls)', () => {
    const db = raw();
    db.exec("UPDATE findings SET status = 'accepted', decided_at = 'x', decided_by = 'y' WHERE id = 'F-003'");

    expect(() => insertTag(db)).not.toThrow();
    expect(() => insertState(db)).not.toThrow();
  });

  it.each([
    ['a tag on a draft', { finding_id: 'F-003' }, /only an accepted finding can be tagged/],
    ['a tag on a rejected finding', { finding_id: 'F-002' }, /only an accepted finding can be tagged/],
    ['a tag on a finding that does not exist', { finding_id: 'F-077' }, /only an accepted finding can be tagged/],
    ['a tag with an unknown item', { finding_id: 'F-001', checklist_item: 'everything' }, /CHECK/],
    ['a tag with an unknown category', { finding_id: 'F-001', category: 'good' }, /CHECK/],
    ['a second tag on one finding', { finding_id: 'F-001' }, /UNIQUE|PRIMARY/],
  ])('refuses %s', (_label, values, message) => {
    expect(() => insertTag(raw(), values)).toThrow(message);
  });

  it('refuses any change or delete of a tag', () => {
    const db = raw();

    expect(() => db.exec("UPDATE finding_tags SET category = 'risk' WHERE finding_id = 'F-001'")).toThrow(/cannot be changed/);
    expect(() => db.exec("UPDATE finding_tags SET checklist_item = 'regions' WHERE finding_id = 'F-001'")).toThrow(/cannot be changed/);
    expect(() => db.exec("DELETE FROM finding_tags WHERE finding_id = 'F-001'")).toThrow(/cannot be deleted/);
  });

  it.each([
    ['checked with no finding behind the item', { item: 'regions', state: 'checked', reason: null }, /accepted finding is tagged/],
    ['checked on an item only a rejected or draft finding is tagged to', { item: 'bottlenecks', state: 'checked', reason: null }, /accepted finding is tagged/],
    ['not applicable with no reason', { state: 'not_applicable', reason: null }, /CHECK/],
    ['could not check with no reason', { state: 'could_not_check', reason: null }, /CHECK/],
    ['not checked with a reason', { state: 'not_checked', reason: 'because' }, /CHECK/],
    ['an empty reason', { reason: '' }, /CHECK/],
    ['a reason over 300 characters', { reason: 'x'.repeat(301) }, /CHECK/],
    ['an unknown state', { state: 'done' }, /CHECK/],
    ['an unknown item', { item: 'everything' }, /CHECK/],
  ])('refuses %s', (_label, values, message) => {
    expect(() => insertState(raw(), values)).toThrow(message);
  });

  it('lets "checked" in for the item an accepted finding is tagged to, and refuses to move another item there', () => {
    const db = raw();

    expect(() => insertState(db, { item: 'guidance', state: 'checked', reason: null })).not.toThrow();
    insertState(db, { item: 'regions' });
    expect(() => db.exec("UPDATE checklist_states SET state = 'checked', reason = NULL WHERE item = 'regions'")).toThrow(/accepted finding is tagged/);
  });

  it('refuses to delete a state or to change or delete an event', () => {
    const store = seeded();
    store.setChecklistState('demo', 'regions', 'could_not_check', 'Plan not provided.');
    const db = openRaw();

    expect(() => db.exec("DELETE FROM checklist_states WHERE item = 'regions'")).toThrow(/cannot be deleted/);
    expect(() => db.exec("UPDATE checklist_events SET state = 'checked'")).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM checklist_events')).toThrow(/cannot be deleted/);
  });
});

describe('upgrading a version 4 database', () => {
  it('adds the tables and keeps the findings that were accepted before there were tags', () => {
    const db = openRaw();
    migrateChatSchema(db, CHAT_MIGRATIONS.slice(0, 4));
    expect(CHAT_MIGRATIONS.length).toBeGreaterThanOrEqual(5);
    db.close();

    const store = openStore();

    expect(store.listFindingTags('demo')).toEqual([]);
    expect(store.listChecklist('demo').every((entry) => entry.state === 'not_checked')).toBe(true);
  });

  it('lets an older accepted finding be tagged afterwards', () => {
    const store = seeded();
    accept(store, 'F-001');
    store.close();

    const again = openStore();

    expect(again.tagFinding('demo', 'F-001', { checklistItem: 'bottlenecks', category: 'risk' }).checklistItem).toBe('bottlenecks');
  });
});
