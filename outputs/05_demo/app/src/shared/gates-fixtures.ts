import {
  CHECKLIST_ITEM_IDS,
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
  type GatesResponse,
} from './contracts';
import { ALWAYS_HUMAN, DISAGREEMENT_RULE, buildGates, type GatesInput } from './gates';

/**
 * Test data only: fictional briefings, gate inputs, decisions and dissents shaped exactly like the contracts.
 * Imported by tests, never by app code.
 */

export const some = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `F-${index + 1}` }) as BriefingFinding);

export interface BriefingOptions {
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
export function briefing(options: BriefingOptions = {}): Briefing {
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
    gateDecisions: [],
  };
}

export const baseInput = (options: BriefingOptions = {}, extra: Partial<GatesInput> = {}): GatesInput => ({
  setup: { stage: 'Phase 2', classifications: ['orphan', 'paed'] },
  team: { selected: 14, total: 25 },
  briefing: briefing(options),
  decisions: [],
  dissents: [],
  ...extra,
});

export const gateOf = (views: GateView[], id: GateId): GateView => views.find((view) => view.id === id) as GateView;
export const factText = (view: GateView, label: string) => view.facts.find((fact) => fact.label === label)?.text;

let serial = 0;
export function decision(view: GateView, option: GateOption, overrides: Partial<GateDecision> = {}): GateDecision {
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

export function dissent(of: GateDecision, overrides: Partial<GateDissent> = {}): GateDissent {
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

/** What GET /api/gates answers for a briefing and earlier decisions, built by the real rules. */
export function gatesResponse(options: BriefingOptions = {}, extra: Partial<GatesInput> = {}): GatesResponse {
  return {
    workspaceId: 'demo',
    generatedAt: '2026-10-22T10:00:00.000Z',
    gates: buildGates(baseInput(options, extra)),
    alwaysHuman: [...ALWAYS_HUMAN],
    disagreementRule: DISAGREEMENT_RULE,
  };
}
