import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ITEM_IDS,
  GATE_IDS,
  GATE_OPTIONS,
  LOCAL_PERSON,
  type Briefing,
  type BriefingFinding,
  type BriefingWarning,
  type ChecklistItemId,
  type ChecklistState,
  type GateDecision,
  type GateDissent,
  type GateId,
  type GateOption,
  type GateView,
} from './contracts';
import {
  ALWAYS_HUMAN,
  DISAGREEMENT_RULE,
  GATE_OPTION_LABELS,
  MAX_DISSENT_ROLE_CHARS,
  MAX_GATE_REASON_CHARS,
  buildGates,
  checkGateDecision,
  checkGateDissent,
  hashFacts,
  isGateId,
  isGateOption,
  type GatesInput,
} from './gates';

// Fixtures. Everything is fictional and shaped like the contracts.

const some = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `F-${index + 1}` }) as BriefingFinding);

interface BriefingOptions {
  room?: boolean;
  provided?: number;
  listedOnly?: number;
  withdrawn?: number;
  drafts?: number;
  accepted?: number;
  untagged?: number;
  states?: Partial<Record<ChecklistItemId, ChecklistState>>;
  warnings?: BriefingWarning['code'][];
  openQuestions?: number;
  risks?: number;
  positives?: number;
  ptrs?: number;
}

/** A briefing that is complete unless the options say otherwise. */
function briefing(options: BriefingOptions = {}): Briefing {
  const { room = true, provided = 8, listedOnly = 0, withdrawn = 0, drafts = 0, accepted = 4, untagged = 0, openQuestions = 0, risks = 2, positives = 1, ptrs = 1 } = options;
  const document = (id: string, isProvided: boolean, isWithdrawn: boolean) => ({
    id,
    title: `Document ${id}`,
    sourceType: 'company-disclosure' as const,
    publishedAt: '2026-09-01',
    provided: isProvided,
    withdrawn: isWithdrawn,
  });
  const documents = room
    ? [
        ...Array.from({ length: provided }, (_, index) => document(`DR-${index + 1}`, true, false)),
        ...Array.from({ length: listedOnly }, (_, index) => document(`DR-L${index + 1}`, false, false)),
        ...Array.from({ length: withdrawn }, (_, index) => document(`DR-W${index + 1}`, true, true)),
      ]
    : [];
  return {
    asOf: room ? '2026-10-12' : null,
    documents,
    counts: { acceptedTagged: accepted - untagged, acceptedUntagged: untagged, drafts, rejected: 0, openQuestions },
    warnings: (options.warnings ?? []).map((code) => ({ code, message: code })),
    checklist: CHECKLIST_ITEM_IDS.map((item) => ({
      item,
      label: item,
      hint: '',
      state: options.states?.[item] ?? 'checked',
      reason: null,
      findingIds: [],
    })),
    positives: some(positives),
    risks: some(risks),
    neutral: [],
    unsorted: some(untagged),
    ptrsInputs: some(ptrs),
    openQuestions: Array.from({ length: openQuestions }, (_, index) => ({ id: `Q-${index + 1}`, claim: 'c', reason: 'r', documentId: null })),
    couldNotCheck: [],
  };
}

const baseInput = (options: BriefingOptions = {}, extra: Partial<GatesInput> = {}): GatesInput => ({
  setup: { stage: 'Phase 2', classifications: ['orphan', 'paed'] },
  team: { selected: 14, total: 25 },
  briefing: briefing(options),
  decisions: [],
  dissents: [],
  ...extra,
});

const gateOf = (views: GateView[], id: GateId): GateView => views.find((view) => view.id === id) as GateView;
const factText = (view: GateView, label: string) => view.facts.find((fact) => fact.label === label)?.text;

let serial = 0;
function decision(view: GateView, option: GateOption, overrides: Partial<GateDecision> = {}): GateDecision {
  serial += 1;
  return {
    id: `GD-${serial}`,
    workspaceId: 'demo',
    gate: view.id,
    option,
    reason: option === view.recommended ? null : 'because',
    recommended: view.recommended,
    facts: view.facts,
    factsHash: view.factsHash,
    actor: LOCAL_PERSON,
    createdAt: `2026-10-22T10:00:${String(serial).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

function dissent(of: GateDecision, overrides: Partial<GateDissent> = {}): GateDissent {
  serial += 1;
  return {
    id: `GX-${serial}`,
    decisionId: of.id,
    workspaceId: 'demo',
    gate: of.gate,
    role: 'CMC regulatory agent owner',
    reason: 'The comparability data is not in yet.',
    actor: LOCAL_PERSON,
    createdAt: `2026-10-22T11:00:${String(serial).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

describe('buildGates: the three gates, in order, each with four options', () => {
  it('returns scope, evidence and release, in that order', () => {
    expect(buildGates(baseInput()).map((view) => view.id)).toEqual(['scope', 'evidence', 'release']);
    expect([...GATE_IDS]).toEqual(['scope', 'evidence', 'release']);
  });

  it('offers go ahead, pause, ask for more information and stop at every gate, each with a cost in plain words', () => {
    for (const view of buildGates(baseInput())) {
      expect(view.options.map((entry) => entry.option)).toEqual([...GATE_OPTIONS]);
      for (const entry of view.options) {
        expect(entry.label).toBe(GATE_OPTION_LABELS[entry.option]);
        expect(entry.cost.length).toBeGreaterThan(30);
      }
    }
    expect(GATE_OPTION_LABELS).toEqual({ proceed: 'Go ahead', pause: 'Pause', seek_more: 'Ask for more information', stop: 'Stop' });
  });

  it('says on the release gate that going ahead is not a view on the deal', () => {
    const release = gateOf(buildGates(baseInput()), 'release');
    expect(release.options.find((entry) => entry.option === 'proceed')?.cost).toContain('not a view on the deal');
    expect(release.question).toContain('not a view on the deal');
  });

  it('is deterministic: the same input gives the same views', () => {
    expect(buildGates(baseInput())).toEqual(buildGates(baseInput()));
  });
});

describe('gate 1, scope and activation', () => {
  it('shows the setup, the team and the data room as facts', () => {
    const scope = gateOf(buildGates(baseInput({ provided: 8, listedOnly: 2, withdrawn: 1 })), 'scope');

    expect(factText(scope, 'Stage')).toBe('Phase 2');
    expect(factText(scope, 'Asset classification')).toBe('Orphan, Paediatric requirements');
    expect(factText(scope, 'Team')).toBe('14 of 25 agents are selected for this DD.');
    expect(factText(scope, 'Data room')).toBe('As of 2026-10-12: 11 documents listed, 8 provided, 2 listed but not provided, 1 withdrawn.');
  });

  it('says plainly when nothing is classified or no data room is connected', () => {
    const scope = gateOf(buildGates(baseInput({ room: false }, { setup: { stage: 'Phase 3', classifications: [] } })), 'scope');

    expect(factText(scope, 'Asset classification')).toBe('None set.');
    expect(factText(scope, 'Data room')).toBe('No data room is connected.');
  });

  it('uses singular words for one document', () => {
    const scope = gateOf(buildGates(baseInput({ provided: 1 })), 'scope');

    expect(factText(scope, 'Data room')).toBe('As of 2026-10-12: 1 document listed, 1 provided, 0 listed but not provided, 0 withdrawn.');
  });

  it('recommends going ahead when the data room has a document the agents can read', () => {
    const scope = gateOf(buildGates(baseInput({ provided: 1 })), 'scope');

    expect(scope.recommended).toBe('proceed');
    expect(scope.recommendedBecause).toBe('A data room is connected and holds documents the agents can read.');
    expect(scope.wouldChange).toEqual(['Withdrawing every document the agents can read would move the call to: ask for more information.']);
  });

  it('recommends asking for more information with no data room, and says what would move the call', () => {
    const scope = gateOf(buildGates(baseInput({ room: false })), 'scope');

    expect(scope.recommended).toBe('seek_more');
    expect(scope.recommendedBecause).toBe('No data room is connected, so the agents have no documents to work from.');
    expect(scope.wouldChange).toEqual(['Loading a data room with at least one provided document would move the call to: go ahead.']);
  });

  it('recommends asking for more information when every document is listed only or withdrawn', () => {
    for (const options of [{ provided: 0, listedOnly: 3 }, { provided: 0, withdrawn: 2 }, { provided: 0 }]) {
      const scope = gateOf(buildGates(baseInput(options)), 'scope');
      expect(scope.recommended).toBe('seek_more');
      expect(scope.recommendedBecause).toBe('The data room has no document the agents can read.');
    }
  });
});

describe('gate 2, the evidence is enough', () => {
  const evidence = (options: BriefingOptions) => gateOf(buildGates(baseInput(options)), 'evidence');

  it('shows the register, the checklist and the withdrawn documents as facts', () => {
    const view = evidence({
      drafts: 3,
      accepted: 5,
      untagged: 1,
      openQuestions: 2,
      states: { guidance: 'checked', designations: 'not_applicable', regions: 'could_not_check', bottlenecks: 'not_checked', 'ptrs-inputs': 'not_checked', 'hta-handover': 'checked' },
      warnings: ['withdrawn_document'],
    });

    expect(factText(view, 'Drafts not decided')).toBe('3');
    expect(factText(view, 'Accepted findings')).toBe('5');
    expect(factText(view, 'Accepted without a checklist item or kind')).toBe('1');
    expect(factText(view, 'Checklist')).toBe('2 checked, 1 not applicable, 1 could not check, 2 not checked (of 6).');
    expect(factText(view, 'Open questions')).toBe('2');
    expect(factText(view, 'Findings on withdrawn documents')).toBe('Yes: see the briefing.');
  });

  it('recommends going ahead only when nothing is open', () => {
    const view = evidence({});

    expect(view.recommended).toBe('proceed');
    expect(view.recommendedBecause).toBe('Every draft is decided, every accepted finding is tagged, and every checklist item is set to checked or not applicable.');
  });

  it('a checklist item that is not applicable counts as done', () => {
    expect(evidence({ states: { designations: 'not_applicable' } }).recommended).toBe('proceed');
  });

  it('recommends asking for more information for each thing that is open, and names each', () => {
    const cases: Array<[BriefingOptions, string, string]> = [
      [{ room: false, provided: 0, accepted: 0 }, 'There is no data room.', 'Loading a data room, then drafting and accepting findings from it.'],
      [{ drafts: 3 }, '3 draft findings are not decided.', 'Deciding the 3 draft findings.'],
      [{ drafts: 1 }, '1 draft finding is not decided.', 'Deciding the 1 draft finding.'],
      [{ untagged: 2 }, '2 accepted findings have no checklist item or kind.', 'Tagging the 2 accepted findings that have no checklist item or kind.'],
      [{ states: { regions: 'not_checked', bottlenecks: 'not_checked' } }, '2 checklist items are not checked.', 'Setting the 2 checklist items that are not checked.'],
      [{ states: { regions: 'could_not_check' } }, '1 checklist item could not be checked.', 'Providing what the 1 checklist item that could not be checked needs, then setting it.'],
      [{ accepted: 0 }, 'No finding has been accepted yet.', 'Accepting at least one finding.'],
      [{ warnings: ['withdrawn_document'] }, 'A finding rests on a document that was withdrawn after it was accepted.', 'Looking again at the findings that rest on withdrawn documents (the briefing lists them).'],
      [{ warnings: ['checked_on_withdrawn'] }, 'A checklist item is checked only on withdrawn documents.', 'Looking again at the checklist items that rest only on withdrawn documents (the briefing lists them).'],
    ];
    for (const [options, because, change] of cases) {
      const view = evidence(options);
      expect(view.recommended, JSON.stringify(options)).toBe('seek_more');
      expect(view.recommendedBecause, JSON.stringify(options)).toContain(because);
      expect(view.wouldChange, JSON.stringify(options)).toContain(change);
    }
  });

  it('lists every open thing when several are open, in a fixed order', () => {
    const view = evidence({ drafts: 2, untagged: 1, states: { regions: 'not_checked' } });

    expect(view.wouldChange).toEqual([
      'Deciding the 2 draft findings.',
      'Tagging the 1 accepted finding that has no checklist item or kind.',
      'Setting the 1 checklist item that is not checked.',
    ]);
  });

  it('never recommends pausing or stopping, whatever is open', () => {
    const combos: BriefingOptions[] = [{}, { room: false, provided: 0, accepted: 0 }, { drafts: 5 }, { untagged: 3 }, { accepted: 0 }, { states: { guidance: 'not_checked' } }, { warnings: ['withdrawn_document', 'checked_on_withdrawn'] }];
    for (const options of combos) expect(['proceed', 'seek_more']).toContain(evidence(options).recommended);
  });

  it('when the call is to go ahead, says what would move it', () => {
    expect(evidence({}).wouldChange).toEqual(['A new draft finding, a checklist item set back to not checked, or a document withdrawn after you decide would move the call to: ask for more information.']);
  });
});

describe('gate 3, release the briefing', () => {
  /** The views after gate 2 was decided as given, on the facts as they are now. */
  function afterEvidence(option: GateOption | null, options: BriefingOptions = {}, changeAfter: BriefingOptions | null = null) {
    const first = buildGates(baseInput(options));
    const decided = option === null ? [] : [decision(gateOf(first, 'evidence'), option)];
    return buildGates(baseInput(changeAfter ?? options, { decisions: decided }));
  }

  it('shows the evidence gate, the counts and the dissents as facts', () => {
    const first = buildGates(baseInput({ openQuestions: 2, risks: 3, positives: 1, ptrs: 2 }));
    const evidenceDecision = decision(gateOf(first, 'evidence'), 'proceed');
    const view = gateOf(buildGates(baseInput({ openQuestions: 2, risks: 3, positives: 1, ptrs: 2 }, { decisions: [evidenceDecision], dissents: [dissent(evidenceDecision), dissent(evidenceDecision)] })), 'release');

    expect(factText(view, 'Evidence gate')).toBe('Decided: go ahead, on the facts as they are now.');
    expect(factText(view, 'Open questions')).toBe('2');
    expect(factText(view, 'Risks')).toBe('3');
    expect(factText(view, 'Positives')).toBe('1');
    expect(factText(view, 'Inputs for the PTRS')).toBe('2 findings; the app computes no number.');
    expect(factText(view, 'Dissents recorded')).toBe('2');
  });

  it('recommends going ahead only when the evidence gate was decided go ahead on the facts as they are now', () => {
    const view = gateOf(afterEvidence('proceed'), 'release');

    expect(view.recommended).toBe('proceed');
    expect(view.recommendedBecause).toBe('The evidence gate was decided: go ahead, and the facts have not changed since.');
  });

  it('recommends asking for more information when the evidence gate is not decided', () => {
    const view = gateOf(afterEvidence(null), 'release');

    expect(view.recommended).toBe('seek_more');
    expect(factText(view, 'Evidence gate')).toBe('Not decided.');
    expect(view.recommendedBecause).toBe('The evidence gate has not been decided.');
    expect(view.wouldChange).toEqual(['Deciding the evidence gate: go ahead, on the facts as they are now.']);
  });

  it('recommends asking for more information when the evidence gate was decided something else', () => {
    for (const option of ['pause', 'seek_more', 'stop'] as GateOption[]) {
      const view = gateOf(afterEvidence(option, { drafts: 1 }), 'release');
      expect(view.recommended, option).toBe('seek_more');
      expect(factText(view, 'Evidence gate'), option).toBe(`Decided: ${GATE_OPTION_LABELS[option].toLowerCase()}, on the facts as they are now.`);
      expect(view.recommendedBecause, option).toBe(`The evidence gate was decided: ${GATE_OPTION_LABELS[option].toLowerCase()}, not go ahead.`);
    }
  });

  it('recommends asking for more information when the facts changed after the evidence gate was decided', () => {
    const view = gateOf(afterEvidence('proceed', {}, { drafts: 1 }), 'release');

    expect(view.recommended).toBe('seek_more');
    expect(factText(view, 'Evidence gate')).toBe('Decided: go ahead, but the facts changed since.');
    expect(view.recommendedBecause).toBe('The evidence gate was decided go ahead, but the facts changed since. Decide it again.');
    expect(view.wouldChange).toEqual(['Deciding the evidence gate again: go ahead, on the facts as they are now.']);
  });

  it('when the call is to go ahead, says what would move it', () => {
    expect(gateOf(afterEvidence('proceed'), 'release').wouldChange).toEqual(['A change in the evidence after you decide (a new draft, an item set back, a withdrawn document) would move the call to: ask for more information.']);
  });
});

describe('status and history', () => {
  it('is not decided until a person decides, then decided, then outdated when the facts change', () => {
    const first = buildGates(baseInput());
    expect(first.map((view) => view.status)).toEqual(['not_decided', 'not_decided', 'not_decided']);

    const scope = decision(gateOf(first, 'scope'), 'proceed');
    const decided = buildGates(baseInput({}, { decisions: [scope] }));
    expect(gateOf(decided, 'scope').status).toBe('decided');
    expect(gateOf(decided, 'evidence').status).toBe('not_decided');

    const changed = buildGates(baseInput({ provided: 0 }, { decisions: [scope] }));
    expect(gateOf(changed, 'scope').status).toBe('outdated');
  });

  it('keeps every decision, newest first, with its dissents, and the latest one sets the status', () => {
    const first = buildGates(baseInput({ provided: 0 }));
    const earlier = decision(gateOf(first, 'scope'), 'pause', { createdAt: '2026-10-22T09:00:00.000Z', id: 'GD-early' });
    const later = decision(gateOf(first, 'scope'), 'seek_more', { createdAt: '2026-10-22T10:00:00.000Z', id: 'GD-late' });
    const note = dissent(earlier);

    const view = gateOf(buildGates(baseInput({ provided: 0 }, { decisions: [earlier, later], dissents: [note] })), 'scope');

    expect(view.decisions.map((entry) => entry.id)).toEqual(['GD-late', 'GD-early']);
    expect(view.decisions[1].dissents).toEqual([note]);
    expect(view.decisions[0].dissents).toEqual([]);
    expect(view.status).toBe('decided');
  });

  it('a decision on other facts counts as outdated even when an older one matched', () => {
    const now = buildGates(baseInput());
    const matched = decision(gateOf(now, 'scope'), 'proceed', { createdAt: '2026-10-22T09:00:00.000Z' });
    const stale = decision(gateOf(now, 'scope'), 'proceed', { createdAt: '2026-10-22T10:00:00.000Z', factsHash: 'other' });

    expect(gateOf(buildGates(baseInput({}, { decisions: [matched, stale] })), 'scope').status).toBe('outdated');
  });

  it('shows the gate\'s own decisions only', () => {
    const first = buildGates(baseInput());
    const view = buildGates(baseInput({}, { decisions: [decision(gateOf(first, 'scope'), 'proceed')] }));

    expect(gateOf(view, 'evidence').decisions).toEqual([]);
  });
});

describe('hashFacts and factsHash', () => {
  it('is stable for the same text and different for different text', () => {
    expect(hashFacts('a')).toBe(hashFacts('a'));
    expect(hashFacts('a')).not.toBe(hashFacts('b'));
    expect(hashFacts('a')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('changes when any fact or the recommended call changes, and not when only the history changes', () => {
    const base = gateOf(buildGates(baseInput()), 'evidence').factsHash;

    expect(gateOf(buildGates(baseInput({ drafts: 1 })), 'evidence').factsHash).not.toBe(base);
    expect(gateOf(buildGates(baseInput({ openQuestions: 1 })), 'evidence').factsHash).not.toBe(base);
    expect(gateOf(buildGates(baseInput({}, { team: { selected: 15, total: 25 } })), 'scope').factsHash).not.toBe(gateOf(buildGates(baseInput()), 'scope').factsHash);
    const first = buildGates(baseInput());
    const withHistory = buildGates(baseInput({}, { decisions: [decision(gateOf(first, 'evidence'), 'proceed')] }));
    expect(gateOf(withHistory, 'evidence').factsHash).toBe(base);
  });

  it('gate 3 changes when gate 2 is decided, because its facts include it', () => {
    const first = buildGates(baseInput());
    const second = buildGates(baseInput({}, { decisions: [decision(gateOf(first, 'evidence'), 'proceed')] }));

    expect(gateOf(second, 'release').factsHash).not.toBe(gateOf(first, 'release').factsHash);
  });
});

describe('checkGateDecision: what a person may submit', () => {
  const view = gateOf(buildGates(baseInput({ provided: 0 })), 'scope'); // recommends seek_more
  const request = (over: Record<string, unknown> = {}) => ({ option: 'seek_more', reason: '', factsHash: view.factsHash, ...over });

  it('accepts the recommended call without a reason', () => {
    expect(checkGateDecision(view, request())).toEqual({ ok: true, option: 'seek_more', reason: null });
  });

  it('accepts the recommended call with a reason and keeps it, trimmed', () => {
    expect(checkGateDecision(view, request({ reason: '  The licensor promised the index.  ' }))).toEqual({ ok: true, option: 'seek_more', reason: 'The licensor promised the index.' });
  });

  it('refuses another option without a reason, and with a blank one', () => {
    for (const reason of [undefined, '', '   ', '\n\t']) {
      const outcome = checkGateDecision(view, request({ option: 'proceed', reason }));
      expect(outcome).toMatchObject({ ok: false, code: 'reason_required' });
    }
  });

  it('accepts another option with a reason', () => {
    expect(checkGateDecision(view, request({ option: 'proceed', reason: 'The seller sent the documents by email.' }))).toEqual({ ok: true, option: 'proceed', reason: 'The seller sent the documents by email.' });
    expect(checkGateDecision(view, request({ option: 'stop', reason: 'The asset was withdrawn.' }))).toMatchObject({ ok: true, option: 'stop' });
  });

  it('refuses an unknown option, a missing option and a wrong type', () => {
    for (const option of ['buy', '', undefined, null, 1, 'Proceed', ['proceed']]) {
      expect(checkGateDecision(view, request({ option, reason: 'x' })), String(option)).toMatchObject({ ok: false, code: 'invalid' });
    }
  });

  it('refuses a reason that is not text or is too long', () => {
    expect(checkGateDecision(view, request({ reason: 5 }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(checkGateDecision(view, request({ reason: 'x'.repeat(MAX_GATE_REASON_CHARS) }))).toMatchObject({ ok: true });
    expect(checkGateDecision(view, request({ reason: 'x'.repeat(MAX_GATE_REASON_CHARS + 1) }))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a decision taken on facts that have since changed', () => {
    expect(checkGateDecision(view, request({ factsHash: 'old' }))).toMatchObject({ ok: false, code: 'facts_changed' });
    expect(checkGateDecision(view, request({ factsHash: undefined }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(checkGateDecision(view, request({ factsHash: 7 }))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('checks the hash before the reason, so a stale page is told to reload first', () => {
    expect(checkGateDecision(view, request({ option: 'proceed', reason: '', factsHash: 'old' }))).toMatchObject({ ok: false, code: 'facts_changed' });
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'proceed', 3, []]) expect(checkGateDecision(view, body)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('checkGateDissent', () => {
  it('accepts a role and a reason, trimmed', () => {
    expect(checkGateDissent({ decisionId: 'GD-1', role: '  CMC regulatory agent owner ', reason: ' Not enough data. ' })).toEqual({
      ok: true,
      decisionId: 'GD-1',
      role: 'CMC regulatory agent owner',
      reason: 'Not enough data.',
    });
  });

  it('refuses a missing or blank decision, role or reason', () => {
    const good = { decisionId: 'GD-1', role: 'Quality', reason: 'Because.' };
    for (const field of ['decisionId', 'role', 'reason']) {
      for (const value of [undefined, '', '   ', 4]) {
        expect(checkGateDissent({ ...good, [field]: value }), `${field}=${String(value)}`).toMatchObject({ ok: false, code: 'invalid' });
      }
    }
  });

  it('refuses a role or a reason that is too long', () => {
    const good = { decisionId: 'GD-1', role: 'Quality', reason: 'Because.' };
    expect(checkGateDissent({ ...good, role: 'x'.repeat(MAX_DISSENT_ROLE_CHARS) })).toMatchObject({ ok: true });
    expect(checkGateDissent({ ...good, role: 'x'.repeat(MAX_DISSENT_ROLE_CHARS + 1) })).toMatchObject({ ok: false });
    expect(checkGateDissent({ ...good, reason: 'x'.repeat(MAX_GATE_REASON_CHARS + 1) })).toMatchObject({ ok: false });
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'x', []]) expect(checkGateDissent(body)).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('guards and words', () => {
  it('knows its ids and options', () => {
    for (const id of GATE_IDS) expect(isGateId(id)).toBe(true);
    for (const option of GATE_OPTIONS) expect(isGateOption(option)).toBe(true);
    for (const value of ['', 'Scope', 'constructor', undefined, null, 3]) {
      expect(isGateId(value)).toBe(false);
      expect(isGateOption(value)).toBe(false);
    }
  });

  it('lists the decisions only a person makes, including the three the concept reserves and stopping', () => {
    const text = ALWAYS_HUMAN.join(' | ').toLowerCase();

    for (const word of ['deal-breaker', 'overall assessment', 'recommendation', 'whether to buy', 'incomplete evidence', 'disagreement between specialists', 'stopping']) {
      expect(text, word).toContain(word);
    }
  });

  it('states the disagreement rule: the lead decides and the dissent stays on the record', () => {
    expect(DISAGREEMENT_RULE).toContain('lead');
    expect(DISAGREEMENT_RULE.toLowerCase()).toContain('dissent');
    expect(DISAGREEMENT_RULE.toLowerCase()).toContain('record');
  });

  it('no gate recommends or asks for a view on the deal: only the always-human list names it, as a person\'s decision', () => {
    const gates = JSON.stringify(buildGates(baseInput()));

    expect(gates).not.toMatch(/\b(buy|purchase|acquire|acquisition)\b/i);
  });
});
