import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '@/server/db/sqlite';
import { LOCAL_PERSON, type GateId, type GateOption, type GateTeam, type GateView, type Store } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { CHAT_MIGRATIONS, migrateChatSchema } from './schema';
import { createStore, GateDecisionNotFoundError, GateFactsChangedError, GateReasonRequiredError } from './store';

// Gate decisions and dissents in the chat database: what the store lets a person record, what it refuses, and what the
// database refuses by itself. The facts and the recommended call are built inside the store; a request cannot carry them.

const START = '2026-10-22T08:00:00.000Z';
const TEAM: GateTeam = { selected: 14, total: 25 };
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
  dir = mkdtempSync(join(tmpdir(), 'gates-store-'));
  dbPath = join(dir, 'chat.db');
  clockMs = Date.parse(START);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of raws.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const AGENT = { agentId: 'reglead', agentName: 'Rosa', agentVersion: '0.2.0', model: 'model-x', promptHash: 'sha256:abc' };

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

/** A store with a data room (two provided documents) and three drafts: F-001 and F-003 on DR-01, F-002 on DR-02. */
function seeded(): Store {
  const store = openStore();
  store.createDataRoom('demo', {
    asOf: '2026-10-12',
    documents: [
      { id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT_01 },
      { id: 'DR-02', title: 'Agency minutes', sourceType: 'agency-record', publishedAt: '2026-03-20', provided: true, text: TEXT_02 },
    ],
  });
  const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'reglead', clientTurnId: 'c1', bootId: 'boot-1', deadlineAt: '2026-10-22T08:03:00.000Z' });
  store.proposeFindings('demo', {
    turnId: turn.id,
    agent: AGENT,
    owner: 'Regulatory lead agent owner',
    findings: [
      checked(),
      checked({ claim: 'The agency did not agree a single study.', quote: 'did not agree that STUDY-301 alone would suffice', documentId: 'DR-02', documentTitle: 'Agency minutes', sourceType: 'agency-record', basis: 'primary-record', publishedAt: '2026-03-20' }),
      checked({ claim: 'The licensor says the study is sufficient.', quote: 'The agency has agreed that one adequate' }),
    ],
    refused: [],
  });
  return store;
}

/** The evidence is complete: every draft decided, accepted findings tagged, every checklist item checked or not applicable. */
function completeEvidence(store: Store) {
  store.decideFinding('demo', 'F-001', 'accepted', null, { checklistItem: 'guidance', category: 'neutral' });
  store.decideFinding('demo', 'F-002', 'rejected', null);
  store.decideFinding('demo', 'F-003', 'accepted', null, { checklistItem: 'bottlenecks', category: 'risk' });
  store.setChecklistState('demo', 'guidance', 'checked', null);
  store.setChecklistState('demo', 'bottlenecks', 'checked', null);
  for (const item of ['designations', 'regions', 'ptrs-inputs', 'hta-handover'] as const) {
    store.setChecklistState('demo', item, 'not_applicable', 'Not part of this asset.');
  }
}

const view = (store: Store, id: GateId, team: GateTeam = TEAM): GateView => store.listGates('demo', team).find((entry) => entry.id === id) as GateView;
const request = (gate: GateView, option: GateOption, reason?: string) => ({ option, reason, factsHash: gate.factsHash });

describe('listGates', () => {
  it('shows the three gates, none decided, for a workspace with nothing in it', () => {
    const gates = openStore().listGates('demo', TEAM);

    expect(gates.map((gate) => [gate.id, gate.status, gate.recommended])).toEqual([
      ['scope', 'not_decided', 'seek_more'],
      ['evidence', 'not_decided', 'seek_more'],
      ['release', 'not_decided', 'seek_more'],
    ]);
  });

  it('builds the facts from what the workspace holds: a data room makes the scope gate recommend going ahead', () => {
    const store = seeded();

    expect(view(store, 'scope').recommended).toBe('proceed');
    expect(view(store, 'scope').facts.find((fact) => fact.label === 'Data room')?.text).toBe(
      'As of 2026-10-12: 2 documents listed, 2 provided, 0 listed but not provided, 0 withdrawn.',
    );
    expect(view(store, 'evidence').facts.find((fact) => fact.label === 'Drafts not decided')?.text).toBe('3');
  });

  it('uses the saved DD setup, and the default setup when none is saved', () => {
    const store = seeded();
    expect(view(store, 'scope').facts.find((fact) => fact.label === 'Stage')?.text).toBe('Phase 2');

    store.updateDdSetup('demo', () => ({ setup: { stage: 'Phase 3', classifications: ['exp'] }, selection: ['reglead'] }));

    expect(view(store, 'scope').facts.find((fact) => fact.label === 'Stage')?.text).toBe('Phase 3');
    expect(view(store, 'scope').facts.find((fact) => fact.label === 'Asset classification')?.text).toBe('Expedited programme');
  });

  it('keeps one workspace\'s decisions out of another', () => {
    const store = seeded();
    store.decideGate('demo', 'scope', request(view(store, 'scope'), 'proceed'), TEAM);

    expect(store.listGates('other', TEAM).every((gate) => gate.decisions.length === 0)).toBe(true);
  });
});

describe('the team size the gates show', () => {
  it('refuses a team that cannot be: negative, more selected than the whole roster, or not whole numbers', () => {
    const store = openStore();
    const bad: GateTeam[] = [
      { selected: -1, total: 25 },
      { selected: 26, total: 25 },
      { selected: 1.5, total: 25 },
      { selected: 14, total: Number.NaN },
      { selected: Number.POSITIVE_INFINITY, total: Number.POSITIVE_INFINITY },
    ];

    for (const team of bad) expect(() => store.listGates('demo', team), JSON.stringify(team)).toThrow(RangeError);
    expect(() => store.decideGate('demo', 'scope', { option: 'proceed', factsHash: 'x' }, { selected: 30, total: 25 })).toThrow(RangeError);
  });

  it('refuses members that are not a list of agent ids', () => {
    const store = openStore();

    for (const members of ['reglead', [1, 2], [null]]) {
      expect(() => store.listGates('demo', { selected: 2, total: 25, members } as unknown as GateTeam), JSON.stringify(members)).toThrow(RangeError);
    }
  });

  it('knows which agents are on the team: the same count with other agents is another view of the scope gate', () => {
    const store = openStore();
    const scopeHash = (members: string[]) => (store.listGates('demo', { selected: members.length, total: 25, members }).find((gate) => gate.id === 'scope') as GateView).factsHash;

    expect(scopeHash(['cmcreg', 'reglead'])).not.toBe(scopeHash(['o-pv', 'reglead']));
  });

  it('accepts the edges: nobody selected, and everybody', () => {
    const store = openStore();

    expect(() => store.listGates('demo', { selected: 0, total: 25 })).not.toThrow();
    expect(() => store.listGates('demo', { selected: 25, total: 25 })).not.toThrow();
  });
});

describe('decideGate', () => {
  it('records the recommended call without a reason, with the facts as shown, the person and the time', () => {
    const store = seeded();
    const gate = view(store, 'scope');

    const decision = store.decideGate('demo', 'scope', request(gate, 'proceed'), TEAM);

    expect(decision).toEqual({
      id: 'GD-1',
      workspaceId: 'demo',
      gate: 'scope',
      option: 'proceed',
      reason: null,
      recommended: 'proceed',
      facts: gate.facts,
      factsHash: gate.factsHash,
      actor: LOCAL_PERSON,
      createdAt: START,
    });
    expect(view(store, 'scope').status).toBe('decided');
    expect(view(store, 'scope').decisions[0].id).toBe('GD-1');
  });

  it('numbers decisions per workspace and keeps them all, newest first', () => {
    const store = seeded();
    const first = store.decideGate('demo', 'scope', request(view(store, 'scope'), 'proceed'), TEAM);
    clockMs += 60_000;
    const second = store.decideGate('demo', 'scope', request(view(store, 'scope'), 'pause', 'The licensor asked for a week.'), TEAM);

    expect([first.id, second.id]).toEqual(['GD-1', 'GD-2']);
    expect(view(store, 'scope').decisions.map((entry) => entry.id)).toEqual(['GD-2', 'GD-1']);
    const otherScope = store.listGates('other', TEAM).find((entry) => entry.id === 'scope') as GateView;
    expect(store.decideGate('other', 'scope', request(otherScope, 'seek_more'), TEAM)).toMatchObject({ id: 'GD-1', workspaceId: 'other' });
    expect(() => store.decideGate('other', 'scope', request(view(store, 'scope'), 'seek_more'), TEAM)).toThrow(GateFactsChangedError);
  });

  it('records another option with its reason, and keeps what the code had recommended', () => {
    const store = seeded();

    const decision = store.decideGate('demo', 'evidence', request(view(store, 'evidence'), 'proceed', '  The seller will send the rest by Friday.  '), TEAM);

    expect(decision).toMatchObject({ option: 'proceed', recommended: 'seek_more', reason: 'The seller will send the rest by Friday.' });
  });

  it('refuses another option without a reason, writes nothing, and says why', () => {
    const store = seeded();

    expect(() => store.decideGate('demo', 'evidence', request(view(store, 'evidence'), 'proceed'), TEAM)).toThrow(GateReasonRequiredError);
    expect(() => store.decideGate('demo', 'evidence', request(view(store, 'evidence'), 'stop', '   '), TEAM)).toThrow(/reason/);
    expect(view(store, 'evidence').decisions).toEqual([]);
    expect(new GateReasonRequiredError('x').code).toBe('gate_reason_required');
  });

  it('refuses a decision taken on facts that changed, and writes nothing', () => {
    const store = seeded();
    const shown = view(store, 'scope');

    expect(() => store.decideGate('demo', 'scope', request(shown, 'proceed'), { selected: 15, total: 25 })).toThrow(GateFactsChangedError);
    expect(view(store, 'scope').decisions).toEqual([]);
    expect(new GateFactsChangedError('scope').code).toBe('gate_facts_changed');
  });

  it('refuses a stale hash after the register changed', () => {
    const store = seeded();
    const shown = view(store, 'evidence');
    store.decideFinding('demo', 'F-002', 'rejected', null);

    expect(() => store.decideGate('demo', 'evidence', request(shown, 'seek_more'), TEAM)).toThrow(GateFactsChangedError);
  });

  it('never takes the recommended call or the facts from the request', () => {
    const store = seeded();
    const gate = view(store, 'evidence'); // recommends seek_more

    const decision = store.decideGate('demo', 'evidence', { option: 'proceed', reason: 'go', factsHash: gate.factsHash, recommended: 'proceed', facts: [] }, TEAM);

    expect(decision.recommended).toBe('seek_more');
    expect(decision.facts).toEqual(gate.facts);
  });

  it('refuses an unknown gate, an unknown option and a body that is not an object, with RangeError', () => {
    const store = seeded();
    const gate = view(store, 'scope');

    expect(() => store.decideGate('demo', 'everything' as GateId, request(gate, 'proceed'), TEAM)).toThrow(RangeError);
    expect(() => store.decideGate('demo', 'scope', { option: 'buy', factsHash: gate.factsHash }, TEAM)).toThrow(RangeError);
    expect(() => store.decideGate('demo', 'scope', null, TEAM)).toThrow(RangeError);
    expect(() => store.decideGate('demo', 'scope', { option: 'proceed', reason: 5, factsHash: gate.factsHash }, TEAM)).toThrow(RangeError);
    expect(() => store.decideGate('', 'scope', request(gate, 'proceed'), TEAM)).toThrow();
  });

  it('shows the facts as they were when decided after they change, and calls the gate outdated', () => {
    const store = seeded();
    const decided = store.decideGate('demo', 'evidence', request(view(store, 'evidence'), 'seek_more'), TEAM);
    store.decideFinding('demo', 'F-002', 'rejected', null);

    const gate = view(store, 'evidence');

    expect(gate.status).toBe('outdated');
    expect(gate.decisions[0].facts).toEqual(decided.facts);
    expect(gate.facts).not.toEqual(decided.facts);
  });

  it('makes the release gate follow the evidence gate: go ahead only after it was decided go ahead on the current facts', () => {
    const store = seeded();
    completeEvidence(store);
    expect(view(store, 'evidence').recommended).toBe('proceed');
    expect(view(store, 'release').recommended).toBe('seek_more');

    store.decideGate('demo', 'evidence', request(view(store, 'evidence'), 'proceed'), TEAM);
    expect(view(store, 'release').recommended).toBe('proceed');

    store.setChecklistState('demo', 'regions', 'could_not_check', 'Not provided.');
    expect(view(store, 'evidence').status).toBe('outdated');
    expect(view(store, 'release').recommended).toBe('seek_more');
  });
});

describe('recordGateDissent', () => {
  function decided() {
    const store = seeded();
    const decision = store.decideGate('demo', 'scope', request(view(store, 'scope'), 'proceed'), TEAM);
    return { store, decision };
  }

  it('records a dissent under a decision of that gate and shows it there', () => {
    const { store, decision } = decided();
    clockMs += 1000;

    const note = store.recordGateDissent('demo', 'scope', { decisionId: decision.id, role: '  CMC regulatory agent owner ', reason: ' The site data is not in. ' });

    expect(note).toEqual({
      id: 'GX-1',
      decisionId: 'GD-1',
      workspaceId: 'demo',
      gate: 'scope',
      role: 'CMC regulatory agent owner',
      reason: 'The site data is not in.',
      actor: LOCAL_PERSON,
      createdAt: '2026-10-22T08:00:01.000Z',
    });
    expect(view(store, 'scope').decisions[0].dissents).toEqual([note]);
  });

  it('never changes the decision or the gate\'s status', () => {
    const { store, decision } = decided();
    const before = view(store, 'scope');

    store.recordGateDissent('demo', 'scope', { decisionId: decision.id, role: 'Quality', reason: 'I disagree.' });

    const after = view(store, 'scope');
    expect(after.status).toBe(before.status);
    expect(after.decisions[0].option).toBe(before.decisions[0].option);
    expect(after.factsHash).toBe(before.factsHash);
  });

  it('allows several dissents under one decision, numbered in order', () => {
    const { store, decision } = decided();

    const ids = [1, 2, 3].map(() => store.recordGateDissent('demo', 'scope', { decisionId: decision.id, role: 'Quality', reason: 'No.' }).id);

    expect(ids).toEqual(['GX-1', 'GX-2', 'GX-3']);
  });

  it('refuses a decision that does not exist, belongs to another gate or to another workspace', () => {
    const { store, decision } = decided();

    expect(() => store.recordGateDissent('demo', 'scope', { decisionId: 'GD-99', role: 'Quality', reason: 'x' })).toThrow(GateDecisionNotFoundError);
    expect(() => store.recordGateDissent('demo', 'evidence', { decisionId: decision.id, role: 'Quality', reason: 'x' })).toThrow(GateDecisionNotFoundError);
    expect(() => store.recordGateDissent('other', 'scope', { decisionId: decision.id, role: 'Quality', reason: 'x' })).toThrow(GateDecisionNotFoundError);
    expect(new GateDecisionNotFoundError('GD-99').code).toBe('gate_decision_not_found');
    expect(view(store, 'scope').decisions[0].dissents).toEqual([]);
  });

  it('refuses a missing or oversized role or reason, an unknown gate and a body that is not an object, with RangeError', () => {
    const { store, decision } = decided();
    const good = { decisionId: decision.id, role: 'Quality', reason: 'x' };

    expect(() => store.recordGateDissent('demo', 'scope', { ...good, role: '' })).toThrow(RangeError);
    expect(() => store.recordGateDissent('demo', 'scope', { ...good, reason: '   ' })).toThrow(RangeError);
    expect(() => store.recordGateDissent('demo', 'scope', { ...good, role: 'x'.repeat(61) })).toThrow(RangeError);
    expect(() => store.recordGateDissent('demo', 'scope', { ...good, reason: 'x'.repeat(601) })).toThrow(RangeError);
    expect(() => store.recordGateDissent('demo', 'everything' as GateId, good)).toThrow(RangeError);
    expect(() => store.recordGateDissent('demo', 'scope', null)).toThrow(RangeError);
  });
});

describe('what the database refuses by itself', () => {
  function raw(): SqliteDatabase {
    const store = seeded();
    const decision = store.decideGate('demo', 'scope', request(view(store, 'scope'), 'proceed'), TEAM);
    store.recordGateDissent('demo', 'scope', { decisionId: decision.id, role: 'Quality', reason: 'No.' });
    return openRaw();
  }

  const insertDecision = (db: SqliteDatabase, values: Record<string, string | null> = {}) => {
    const row = { id: 'GD-9', gate: 'scope', option: 'proceed', recommended: 'proceed', reason: null, facts_json: '[]', facts_hash: 'h', actor: 'x', created_at: START, ...values };
    db.prepare(
      "INSERT INTO gate_decisions (workspace_id, id, gate, option, recommended, reason, facts_json, facts_hash, actor, created_at) VALUES ('demo', :id, :gate, :option, :recommended, :reason, :facts_json, :facts_hash, :actor, :created_at)",
    ).run(row);
  };

  const insertDissent = (db: SqliteDatabase, values: Record<string, string> = {}) => {
    const row = { id: 'GX-9', decision_id: 'GD-1', gate: 'scope', role: 'Quality', reason: 'No.', actor: 'x', created_at: START, ...values };
    db.prepare(
      "INSERT INTO gate_dissents (workspace_id, id, decision_id, gate, role, reason, actor, created_at) VALUES ('demo', :id, :decision_id, :gate, :role, :reason, :actor, :created_at)",
    ).run(row);
  };

  it('accepts a well-formed decision and dissent (positive controls)', () => {
    const db = raw();

    expect(() => insertDecision(db)).not.toThrow();
    expect(() => insertDecision(db, { id: 'GD-10', option: 'stop', reason: 'Because.' })).not.toThrow();
    expect(() => insertDissent(db)).not.toThrow();
  });

  it.each([
    ['a decision against the recommended call with no reason', { option: 'stop', recommended: 'proceed', reason: null }, /CHECK/],
    ['a decision with an empty reason', { option: 'stop', recommended: 'proceed', reason: '' }, /CHECK/],
    ['a decision with a reason over 600 characters', { option: 'stop', recommended: 'proceed', reason: 'x'.repeat(601) }, /CHECK/],
    ['a decision with an unknown gate', { gate: 'everything' }, /CHECK/],
    ['a decision with an unknown option', { option: 'buy' }, /CHECK/],
    ['a decision with an unknown recommended call', { recommended: 'buy' }, /CHECK/],
    ['a second decision with the same number', { id: 'GD-1' }, /UNIQUE|PRIMARY/],
  ])('refuses %s', (_label, values, message) => {
    expect(() => insertDecision(raw(), values)).toThrow(message);
  });

  it.each([
    ['a dissent under a decision that does not exist', { decision_id: 'GD-99' }, /a dissent needs a decision of the same gate/],
    ['a dissent under a decision of another gate', { gate: 'evidence' }, /a dissent needs a decision of the same gate/],
    ['a dissent with an empty role', { role: '' }, /CHECK/],
    ['a dissent with an empty reason', { reason: '' }, /CHECK/],
    ['a dissent with a role over 60 characters', { role: 'x'.repeat(61) }, /CHECK/],
    ['a dissent with a reason over 600 characters', { reason: 'x'.repeat(601) }, /CHECK/],
    ['a second dissent with the same number', { id: 'GX-1' }, /UNIQUE|PRIMARY/],
  ])('refuses %s', (_label, values, message) => {
    expect(() => insertDissent(raw(), values)).toThrow(message);
  });

  it('refuses to change or delete a decision or a dissent', () => {
    const db = raw();

    expect(() => db.exec("UPDATE gate_decisions SET option = 'stop' WHERE id = 'GD-1'")).toThrow(/cannot be changed/);
    expect(() => db.exec("DELETE FROM gate_decisions WHERE id = 'GD-1'")).toThrow(/cannot be deleted/);
    expect(() => db.exec("UPDATE gate_dissents SET reason = 'x' WHERE id = 'GX-1'")).toThrow(/cannot be changed/);
    expect(() => db.exec("DELETE FROM gate_dissents WHERE id = 'GX-1'")).toThrow(/cannot be deleted/);
  });
});

describe('upgrading a version 5 database', () => {
  it('adds the tables and keeps what was there', () => {
    const db = openRaw();
    migrateChatSchema(db, CHAT_MIGRATIONS.slice(0, 5));
    expect(CHAT_MIGRATIONS.length).toBeGreaterThanOrEqual(6);
    db.close();

    const store = openStore();

    expect(store.listGates('demo', TEAM).every((gate) => gate.decisions.length === 0)).toBe(true);
    expect(store.listChecklist('demo').every((entry) => entry.state === 'not_checked')).toBe(true);
  });

  it('refuses a database newer than this code', () => {
    openStore().close();
    const db = openRaw();
    db.exec(`PRAGMA user_version = ${CHAT_MIGRATIONS.length + 1}`);
    db.close();

    expect(() => createStore(dbPath, { now })).toThrow(/newer than/);
  });
});
