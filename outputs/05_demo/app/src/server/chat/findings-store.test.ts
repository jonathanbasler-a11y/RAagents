import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { LOCAL_PERSON, type Store } from '@/shared/contracts';
import type { CheckedFinding, RefusedClaim } from '@/shared/findings';
import { CHAT_MIGRATIONS, migrateChatSchema } from './schema';
import {
  createStore,
  FindingAlreadyDecidedError,
  FindingNotFoundError,
  FindingSourceWithdrawnError,
  NoDataRoomError,
} from './store';

// The findings register in the chat database: what the store lets an agent put in (drafts only, from documents
// of the room, with a quote that is really there) and what only a person's decision can change.

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
  dir = mkdtempSync(join(tmpdir(), 'findings-store-'));
  dbPath = join(dir, 'chat.db');
  clockMs = Date.parse(START);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of raws.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function seeded(): { store: Store; turnId: string } {
  const store = openStore();
  store.createDataRoom('demo', {
    asOf: AS_OF,
    documents: [
      { id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT_01 },
      { id: 'DR-02', title: 'Agency minutes', sourceType: 'agency-record', publishedAt: '2026-03-20', provided: true, text: TEXT_02 },
    ],
  });
  const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'reglead', clientTurnId: 'c1', bootId: 'boot-1', deadlineAt: '2026-10-12T08:03:00.000Z' });
  return { store, turnId: turn.id };
}

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
    assumptions: ['The overview is current.'],
    ...overrides,
  };
}

const refused = (overrides: Partial<RefusedClaim> = {}): RefusedClaim => ({
  claim: 'The study met its endpoint.',
  code: 'quote_not_in_document',
  message: 'The quote is not in DR-04.',
  documentId: 'DR-04',
  ...overrides,
});

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('proposeFindings', () => {
  it('starts empty', () => {
    const { store } = seeded();

    expect(store.listFindings('demo')).toEqual([]);
    expect(store.listOpenQuestions('demo')).toEqual([]);
    expect(store.listFindingEvents('demo')).toEqual([]);
  });

  it('stores each checked claim as a draft with the next stable id, and who drafted it, and records the proposal', () => {
    const { store, turnId } = seeded();

    const result = store.proposeFindings('demo', {
      turnId,
      agent: AGENT,
      owner: OWNER,
      findings: [checked(), checked({ documentId: 'DR-02', documentTitle: 'Agency minutes', sourceType: 'agency-record', basis: 'primary-record', publishedAt: '2026-03-20', quote: 'did not agree that STUDY-301 alone would suffice', claim: 'The agency did not agree a single study.' })],
      refused: [],
    });

    expect(result.findings.map((entry) => [entry.id, entry.status, entry.basis, entry.documentId])).toEqual([
      ['F-001', 'draft', 'attributed', 'DR-01'],
      ['F-002', 'draft', 'primary-record', 'DR-02'],
    ]);
    expect(result.findings[0]).toMatchObject({
      workspaceId: 'demo',
      asOf: AS_OF,
      owner: OWNER,
      confidence: 'medium',
      assumptions: ['The overview is current.'],
      createdAt: START,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      draftedBy: { ...AGENT, turnId },
    });
    expect(store.listFindings('demo')).toEqual(result.findings);
    expect(store.listFindingEvents('demo').map((event) => [event.findingId, event.kind, event.by, event.at])).toEqual([
      ['F-001', 'proposed', 'agent:reglead', START],
      ['F-002', 'proposed', 'agent:reglead', START],
    ]);
  });

  it('keeps a refused claim as an open question with the reason, never as a finding', () => {
    const { store, turnId } = seeded();

    const result = store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [], refused: [refused(), refused({ claim: 'Another.', code: 'declared_unsupported', message: 'No document says so.', documentId: null })] });

    expect(result.findings).toEqual([]);
    expect(result.openQuestions.map((entry) => [entry.id, entry.claim, entry.reasonCode, entry.documentId])).toEqual([
      ['Q-001', 'The study met its endpoint.', 'quote_not_in_document', 'DR-04'],
      ['Q-002', 'Another.', 'declared_unsupported', null],
    ]);
    expect(result.openQuestions[0]).toMatchObject({ reason: 'The quote is not in DR-04.', raisedBy: { agentId: 'reglead', agentName: 'Rosa', turnId }, createdAt: START });
    expect(store.listFindings('demo')).toEqual([]);
  });

  it('numbers on from the last one in the next proposal, and never reuses an id', () => {
    const { store, turnId } = seeded();
    store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked()], refused: [refused()] });

    const second = store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ claim: 'Another claim.' })], refused: [refused({ claim: 'Again.' })] });

    expect(second.findings[0].id).toBe('F-002');
    expect(second.openQuestions[0].id).toBe('Q-002');
  });

  it('needs a data room', () => {
    const store = openStore();

    expect(thrownBy(() => store.proposeFindings('demo', { turnId: 't', agent: AGENT, owner: OWNER, findings: [checked()], refused: [] }))).toBeInstanceOf(NoDataRoomError);
  });

  it('needs a turn that exists', () => {
    const { store } = seeded();

    expect(thrownBy(() => store.proposeFindings('demo', { turnId: 'no-such-turn', agent: AGENT, owner: OWNER, findings: [checked()], refused: [] }))).toBeInstanceOf(RangeError);
  });

  it('saves all of a proposal or none: one claim the store refuses undoes the others', () => {
    const { store, turnId } = seeded();

    const error = thrownBy(() =>
      store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked(), checked({ documentId: 'DR-77' })], refused: [refused()] }),
    );

    expect(error).toBeInstanceOf(RangeError);
    expect(store.listFindings('demo')).toEqual([]);
    expect(store.listOpenQuestions('demo')).toEqual([]);
    expect(store.listFindingEvents('demo')).toEqual([]);
    // Positive control: the same proposal without the bad claim is saved.
    expect(store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked()], refused: [refused()] }).findings).toHaveLength(1);
  });

  describe('the second wall: the store checks the claim again', () => {
    it('refuses a quote that is not in the document', () => {
      const { store, turnId } = seeded();

      const error = thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ quote: 'a sentence that is nowhere in this document at all' })], refused: [] }));

      expect(error).toBeInstanceOf(RangeError);
      expect((error as Error).message).toMatch(/quote/);
    });

    it('accepts a quote with curly quotes or other spacing, as the checker does', () => {
      const { store, turnId } = seeded();

      const result = store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ quote: 'one adequate  and well-controlled\npivotal study is sufficient' })], refused: [] });

      expect(result.findings).toHaveLength(1);
    });

    it('refuses a withdrawn document and an unknown one', () => {
      const { store, turnId } = seeded();
      store.withdrawDocument('demo', 'DR-01', 'wrong file');

      expect(thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked()], refused: [] }))).toBeInstanceOf(RangeError);
      expect(thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ documentId: 'DR-77' })], refused: [] }))).toBeInstanceOf(RangeError);
    });

    it('takes the basis, the date and the title from the document, not from what it is handed', () => {
      const { store, turnId } = seeded();

      const result = store.proposeFindings('demo', {
        turnId,
        agent: AGENT,
        owner: OWNER,
        findings: [checked({ basis: 'primary-record', sourceType: 'agency-record', publishedAt: '2020-01-01', documentTitle: 'Invented title' })],
        refused: [],
      });

      expect(result.findings[0]).toMatchObject({ basis: 'attributed', sourceType: 'company-disclosure', publishedAt: '2026-07-14', documentTitle: 'Licensor overview' });
    });

    it('refuses an empty owner, an empty claim and a bad confidence', () => {
      const { store, turnId } = seeded();

      expect(thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: ' ', findings: [checked()], refused: [] }))).toBeInstanceOf(TypeError);
      expect(thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ claim: ' ' })], refused: [] }))).toBeInstanceOf(RangeError);
      expect(thrownBy(() => store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked({ confidence: 'certain' as never })], refused: [] }))).toBeInstanceOf(RangeError);
    });
  });
});

describe('decideFinding: the person decides, once', () => {
  function withDraft() {
    const { store, turnId } = seeded();
    store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked()], refused: [] });
    return store;
  }

  it('accepts a draft: status, time and who decided are recorded, and so is the note', () => {
    const store = withDraft();
    clockMs += 60_000;

    const finding = store.decideFinding('demo', 'F-001', 'accepted', '  Matches the minutes.  ');

    expect(finding).toMatchObject({ status: 'accepted', decidedAt: '2026-10-12T08:01:00.000Z', decidedBy: LOCAL_PERSON, decisionNote: 'Matches the minutes.' });
    expect(store.listFindings('demo')[0]).toEqual(finding);
    expect(store.listFindingEvents('demo').map((event) => [event.kind, event.by, event.note])).toEqual([
      ['proposed', 'agent:reglead', null],
      ['accepted', LOCAL_PERSON, 'Matches the minutes.'],
    ]);
  });

  it('rejects a draft, with or without a note', () => {
    const store = withDraft();

    const finding = store.decideFinding('demo', 'F-001', 'rejected', null);

    expect(finding).toMatchObject({ status: 'rejected', decidedBy: LOCAL_PERSON, decisionNote: null });
    expect(store.listFindingEvents('demo').at(-1)).toMatchObject({ kind: 'rejected', note: null });
  });

  it('decides once: a second decision, the same or the opposite, is refused and changes nothing', () => {
    const store = withDraft();
    store.decideFinding('demo', 'F-001', 'accepted', 'first');

    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'rejected', 'second'))).toBeInstanceOf(FindingAlreadyDecidedError);
    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'accepted', 'again'))).toBeInstanceOf(FindingAlreadyDecidedError);
    expect(store.listFindings('demo')[0]).toMatchObject({ status: 'accepted', decisionNote: 'first' });
    expect(store.listFindingEvents('demo')).toHaveLength(2);
  });

  it('names a finding that is not there', () => {
    const store = withDraft();

    expect(thrownBy(() => store.decideFinding('demo', 'F-077', 'accepted', null))).toBeInstanceOf(FindingNotFoundError);
  });

  it('refuses a decision that is not accepted or rejected, and a note over 300 characters', () => {
    const store = withDraft();

    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'draft' as never, null))).toBeInstanceOf(RangeError);
    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'approve' as never, null))).toBeInstanceOf(RangeError);
    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'accepted', 'x'.repeat(301)))).toBeInstanceOf(RangeError);
    expect(store.listFindings('demo')[0].status).toBe('draft');
    // Positive control: exactly 300 is fine.
    expect(store.decideFinding('demo', 'F-001', 'accepted', 'x'.repeat(300)).status).toBe('accepted');
  });

  it('will not accept a finding whose document has been withdrawn since, but can reject it', () => {
    const store = withDraft();
    store.withdrawDocument('demo', 'DR-01', 'wrong file');

    expect(thrownBy(() => store.decideFinding('demo', 'F-001', 'accepted', null))).toBeInstanceOf(FindingSourceWithdrawnError);
    expect(store.listFindings('demo')[0].status).toBe('draft');
    expect(store.decideFinding('demo', 'F-001', 'rejected', 'source withdrawn').status).toBe('rejected');
  });

  it('keeps a decided finding when its document is withdrawn later', () => {
    const store = withDraft();
    store.decideFinding('demo', 'F-001', 'accepted', null);

    store.withdrawDocument('demo', 'DR-01', 'wrong file');

    expect(store.listFindings('demo')[0].status).toBe('accepted');
  });
});

describe('what the database refuses by itself', () => {
  function raw(): SqliteDatabase {
    const { store, turnId } = seeded();
    store.proposeFindings('demo', { turnId, agent: AGENT, owner: OWNER, findings: [checked()], refused: [refused()] });
    return openRaw();
  }

  const insert = (db: SqliteDatabase, values: Partial<Record<string, string | number | null>> = {}) => {
    const turn = db.prepare('SELECT id FROM turns').get()?.id as string;
    const row = {
      workspace_id: 'demo', id: 'F-050', claim: 'A claim.', quote: 'a quote that is long enough', document_id: 'DR-01', source_type: 'company-disclosure',
      basis: 'attributed', published_at: '2026-07-14', as_of: AS_OF, confidence: 'low', confidence_reason: 'why', assumptions: '[]', owner: 'Owner',
      status: 'draft', agent_id: 'reglead', agent_name: 'Rosa', agent_version: '1', model: null, prompt_hash: null, turn_id: turn,
      created_at: START, decided_at: null, decided_by: null, decision_note: null, ...values,
    };
    db.prepare(
      `INSERT INTO findings (workspace_id, id, claim, quote, document_id, source_type, basis, published_at, as_of, confidence, confidence_reason, assumptions, owner, status,
         agent_id, agent_name, agent_version, model, prompt_hash, turn_id, created_at, decided_at, decided_by, decision_note)
       VALUES (:workspace_id, :id, :claim, :quote, :document_id, :source_type, :basis, :published_at, :as_of, :confidence, :confidence_reason, :assumptions, :owner, :status,
         :agent_id, :agent_name, :agent_version, :model, :prompt_hash, :turn_id, :created_at, :decided_at, :decided_by, :decision_note)`,
    ).run(row);
  };

  it('accepts a well-formed draft (positive control for the refusals below)', () => {
    expect(() => insert(raw())).not.toThrow();
  });

  it.each([
    ['a finding that arrives already accepted: only a person decides', { status: 'accepted', decided_at: 'x', decided_by: 'y' }, /only a draft/],
    ['a finding that arrives rejected', { status: 'rejected', decided_at: 'x', decided_by: 'y' }, /only a draft/],
    ['a draft that has a decision on it', { decided_at: 'x' }, /CHECK/],
    ['an unknown confidence', { confidence: 'certain' }, /CHECK/],
    ['an unknown status', { status: 'approved' }, /only a draft|CHECK/],
    ['an unknown basis', { basis: 'verified' }, /CHECK/],
    ['an attributed basis on a registry document', { source_type: 'registry' }, /CHECK/],
    ['a primary basis on a company disclosure', { basis: 'primary-record' }, /CHECK/],
    ['an empty claim', { claim: '' }, /CHECK/],
    ['a claim over 600 characters', { claim: 'x'.repeat(601) }, /CHECK/],
    ['a quote that is too short', { quote: 'short' }, /CHECK/],
    ['assumptions that are not a list', { assumptions: '{"a":1}' }, /CHECK/],
    ['an id that does not fit', { id: 'X-1' }, /CHECK/],
    ['a document that is not in the room', { document_id: 'DR-77' }, /FOREIGN KEY/],
    ['a turn that does not exist', { turn_id: 'nope' }, /FOREIGN KEY/],
    ['an owner that is empty', { owner: '' }, /CHECK/],
  ])('refuses %s', (_label, values, message) => {
    expect(() => insert(raw(), values)).toThrow(message);
  });

  it('refuses a duplicate id', () => {
    expect(() => insert(raw(), { id: 'F-001' })).toThrow(/UNIQUE|PRIMARY/);
  });

  it('refuses any change to a finding except the one decision, and any delete', () => {
    const db = raw();

    for (const change of ["claim = 'changed'", "quote = 'a changed quote that is long enough'", "document_id = 'DR-02'", "confidence = 'high'", "owner = 'Someone else'", "basis = 'primary-record'", "id = 'F-050'", "created_at = 'x'"]) {
      expect(() => db.exec(`UPDATE findings SET ${change} WHERE id = 'F-001'`), change).toThrow(/cannot be changed/);
    }
    expect(() => db.exec("DELETE FROM findings WHERE id = 'F-001'")).toThrow(/cannot be deleted/);
    expect(db.prepare("SELECT claim, status FROM findings WHERE id = 'F-001'").get()).toMatchObject({ status: 'draft', claim: 'The licensor says the agency agreed a single pivotal study is enough.' });
  });

  it('lets a draft be decided exactly once, and not changed along the way', () => {
    const db = raw();

    expect(() => db.exec("UPDATE findings SET status = 'accepted', decided_at = 'x', decided_by = 'y', claim = 'changed' WHERE id = 'F-001'")).toThrow(/cannot be changed/);
    expect(() => db.exec("UPDATE findings SET status = 'accepted' WHERE id = 'F-001'")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE findings SET status = 'accepted', decided_at = 'x', decided_by = 'y' WHERE id = 'F-001'")).not.toThrow();
    expect(() => db.exec("UPDATE findings SET status = 'rejected', decided_at = 'z', decided_by = 'y' WHERE id = 'F-001'")).toThrow(/cannot be changed/);
    expect(() => db.exec("UPDATE findings SET decision_note = 'later' WHERE id = 'F-001'")).toThrow(/cannot be changed/);
  });

  it('refuses to accept a finding whose document is withdrawn, but not to reject it', () => {
    const db = raw();
    db.exec("UPDATE data_room_documents SET withdrawn_at = 'x', withdrawn_reason = 'why' WHERE id = 'DR-01'");

    expect(() => db.exec("UPDATE findings SET status = 'accepted', decided_at = 'x', decided_by = 'y' WHERE id = 'F-001'")).toThrow(/withdrawn/);
    expect(() => db.exec("UPDATE findings SET status = 'rejected', decided_at = 'x', decided_by = 'y' WHERE id = 'F-001'")).not.toThrow();
  });

  it('keeps the audit trail and the open questions as they were written', () => {
    const db = raw();

    expect(() => db.exec("UPDATE finding_events SET kind = 'accepted'")).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM finding_events')).toThrow(/cannot be deleted/);
    expect(() => db.exec("UPDATE open_questions SET reason = 'changed'")).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM open_questions')).toThrow(/cannot be deleted/);
    expect(() => db.exec("INSERT OR REPLACE INTO open_questions (workspace_id, id, claim, reason_code, reason, turn_id, agent_id, agent_name, created_at) SELECT workspace_id, id, 'replaced', reason_code, reason, turn_id, agent_id, agent_name, created_at FROM open_questions")).toThrow();
  });

  it('refuses an audit row of an unknown kind', () => {
    const db = raw();

    expect(() => db.exec("INSERT INTO finding_events (workspace_id, finding_id, kind, at, actor) VALUES ('demo', 'F-001', 'approved', 'x', 'y')")).toThrow(/CHECK/);
  });
});

describe('upgrading a database that has a data room but no findings', () => {
  it('adds the tables and keeps what was there', () => {
    const raw = openRaw();
    migrateChatSchema(raw, CHAT_MIGRATIONS.slice(0, 3));
    raw.exec("INSERT INTO data_rooms (workspace_id, as_of, created_at) VALUES ('demo', '2026-10-12', 'x')");
    expect(CHAT_MIGRATIONS.length).toBeGreaterThanOrEqual(4);

    const store = openStore();

    expect(store.getDataRoom('demo')?.asOf).toBe(AS_OF);
    expect(store.listFindings('demo')).toEqual([]);
  });
});
