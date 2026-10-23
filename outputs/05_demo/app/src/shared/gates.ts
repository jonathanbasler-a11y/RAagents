import {
  GATE_IDS,
  GATE_OPTIONS,
  type Briefing,
  type DdSetup,
  type GateDecision,
  type GateDissent,
  type GateFact,
  type GateId,
  type GateOption,
  type GateStatus,
  type GateTeam,
  type GateView,
} from './contracts';
import { CLASSIFICATION_LABELS } from './dd-setup';

// Gates: three points of the due diligence where a person decides. Everything here is pure and built by code from facts
// the app already holds (the DD setup, the data room, the findings register, the checklist, earlier decisions): no model
// is called, so no fact, recommended call or cost can be invented. The recommended call is advice. A person decides, and
// is asked for a reason whenever the decision differs from the advice.

export const MAX_GATE_REASON_CHARS = 600;
export const MAX_DISSENT_ROLE_CHARS = 60;

export const GATE_OPTION_LABELS: Record<GateOption, string> = {
  proceed: 'Go ahead',
  pause: 'Pause',
  seek_more: 'Ask for more information',
  stop: 'Stop',
};

const GATE_INFO: Record<GateId, { title: string; question: string }> = {
  scope: {
    title: 'Scope and activation',
    question: 'Should the team start work on this asset, with this setup and these documents?',
  },
  evidence: {
    title: 'The evidence is enough',
    question: 'Is the evidence enough to build the briefing on, or must more be decided, checked or provided first?',
  },
  release: {
    title: 'Release the briefing',
    question: 'Is the briefing ready to be handed to the cross-functional discussion? Going ahead is not a view on the deal.',
  },
};

/** What each choice costs, in one sentence, written once. */
const GATE_COSTS: Record<GateId, Record<GateOption, string>> = {
  scope: {
    proceed: 'The team starts on this setup and these documents. Replies stay unsourced model output, and findings can be drafted from the documents.',
    pause: 'Nothing is lost, but no one is asked to work on the asset until you decide again, and the due diligence clock keeps running.',
    seek_more: 'Costs time: someone has to provide documents or settle the setup before the team starts, and answers stay general until then.',
    stop: 'Ends the due diligence work on this asset. What is already in the app stays in the record, and nothing is deleted.',
  },
  evidence: {
    proceed: 'The briefing is built on what is accepted and checked now. What is not checked, could not be checked or is still open stays visible in it.',
    pause: 'The work on the evidence waits. Nothing is lost, but the briefing cannot be released until you decide again.',
    seek_more: 'Costs time: drafts must be decided, items checked and documents provided before the evidence is complete.',
    stop: 'Ends the due diligence work on this asset. The findings, the checklist and the briefing stay in the record.',
  },
  release: {
    proceed: 'The briefing goes to the cross-functional discussion as it stands. It is not a view on the deal: the people in that discussion decide.',
    pause: 'The briefing waits and the discussion cannot use it yet. Nothing in it changes.',
    seek_more: 'Costs time: more evidence or checks before the discussion, and the briefing is not released until then.',
    stop: 'The briefing is not released. The app ends nothing by itself: the decision owner decides what happens to the due diligence.',
  },
};

/** The decisions only a person makes. No agent, tool or prompt can make them. */
export const ALWAYS_HUMAN: readonly string[] = [
  'Deal-breakers.',
  'The overall assessment.',
  'The recommendation, including whether to buy.',
  'Going ahead on incomplete evidence.',
  'Settling a disagreement between specialists.',
  'Stopping the due diligence.',
];

export const DISAGREEMENT_RULE =
  'When the lead and a specialist disagree, the lead decides. The dissent is recorded under the decision and stays on the record; it never blocks the decision.';

export const isGateId = (value: unknown): value is GateId => typeof value === 'string' && (GATE_IDS as readonly string[]).includes(value);
export const isGateOption = (value: unknown): value is GateOption => typeof value === 'string' && (GATE_OPTIONS as readonly string[]).includes(value);

/**
 * A short fingerprint of a text, to tell whether what a person saw is still what the code shows. It is a change
 * detector (53 bits, cyrb53), not a security feature.
 */
export function hashFacts(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export interface GatesInput {
  setup: DdSetup;
  team: GateTeam;
  /** The briefing as it is now (buildBriefing): the gates read its counts, checklist and warnings. */
  briefing: Briefing;
  /** Every recorded decision, in any order. */
  decisions: readonly GateDecision[];
  dissents: readonly GateDissent[];
}

interface Base {
  facts: GateFact[];
  recommended: GateOption;
  recommendedBecause: string;
  wouldChange: string[];
  /** Facts shown to the person but left out of the hash, because they must not reopen a decision. */
  notHashed?: string[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const lower = (option: GateOption) => GATE_OPTION_LABELS[option].toLowerCase();

const HELD_WORDS: Partial<Record<GateOption, string>> = { stop: 'stopped', pause: 'paused' };

/**
 * A scope gate that was stopped or paused leads the gates after it: whatever the evidence says, the call there is to pause
 * until a person decides scope again. The latest scope decision counts, even if its facts have changed since.
 * Once scope is decided again, the stop stays on the record as a fact of the later gates, so what was decided at them before
 * the stop does not become current again without a new decision.
 */
function ledByScope(base: Base, scope: GateView): Base {
  const latest = scope.decisions[0];
  const held = scope.decisions.find((entry) => HELD_WORDS[entry.option] !== undefined);
  if (latest === undefined || held === undefined) return base;
  if (latest.id !== held.id) {
    return { ...base, facts: [...base.facts, { label: 'Scope gate', text: `Decided: ${lower(latest.option)}, after it was ${HELD_WORDS[held.option]}.` }] };
  }
  return {
    ...base,
    facts: [...base.facts, { label: 'Scope gate', text: `Decided: ${lower(latest.option)}.` }],
    recommended: 'pause',
    recommendedBecause: `The scope gate was decided: ${lower(latest.option)}. Decide it again before this gate.`,
    wouldChange: ['Deciding the scope gate again: go ahead.'],
  };
}

function scopeBase({ setup, team, briefing }: GatesInput): Base {
  const documents = briefing.documents;
  const readable = documents.filter((document) => document.provided && !document.withdrawn).length;
  const notProvided = documents.filter((document) => !document.provided).length;
  const withdrawn = documents.filter((document) => document.withdrawn).length;
  const hasRoom = briefing.asOf !== null;
  const facts: GateFact[] = [
    { label: 'Stage', text: setup.stage },
    {
      label: 'Asset classification',
      text: setup.classifications.length === 0 ? 'None set.' : setup.classifications.map((id) => CLASSIFICATION_LABELS[id]).join(', '),
    },
    { label: 'Team', text: `${team.selected} of ${team.total} agents are selected for this DD.` },
    // Named, so that a different team of the same size is a visible change, and the decision keeps which team it was taken on.
    ...(team.members === undefined
      ? []
      : [{ label: 'Selected agents', text: team.members.length === 0 ? 'None.' : [...team.members].sort((a, b) => a.localeCompare(b, 'en')).join(', ') }]),
    {
      label: 'Data room',
      text: hasRoom
        ? `As of ${briefing.asOf}: ${plural(documents.length, 'document', 'documents')} listed, ${readable} provided, ${notProvided} listed but not provided, ${withdrawn} withdrawn.`
        : 'No data room is connected.',
    },
  ];
  if (!hasRoom) {
    return {
      facts,
      recommended: 'seek_more',
      recommendedBecause: 'No data room is connected, so the agents have no documents to work from.',
      wouldChange: ['Loading a data room with at least one provided document would move the call to: go ahead.'],
    };
  }
  if (readable === 0) {
    return {
      facts,
      recommended: 'seek_more',
      recommendedBecause: 'The data room has no document the agents can read.',
      wouldChange: ['Providing at least one document, or loading one that is provided, would move the call to: go ahead.'],
    };
  }
  return {
    facts,
    recommended: 'proceed',
    recommendedBecause: 'A data room is connected and holds documents the agents can read.',
    wouldChange: ['Withdrawing every document the agents can read would move the call to: ask for more information.'],
  };
}

function evidenceBase({ briefing }: GatesInput): Base {
  const { counts } = briefing;
  const hasRoom = briefing.asOf !== null;
  const accepted = counts.acceptedTagged + counts.acceptedUntagged;
  const rows = briefing.checklist;
  const inState = (state: string) => rows.filter((row) => row.state === state).length;
  const checked = inState('checked');
  const notApplicable = inState('not_applicable');
  const couldNot = inState('could_not_check');
  const notChecked = inState('not_checked');
  const codes = new Set(briefing.warnings.map((warning) => warning.code));
  const onWithdrawn = codes.has('withdrawn_document') || codes.has('checked_on_withdrawn');

  const facts: GateFact[] = [
    { label: 'Drafts not decided', text: String(counts.drafts) },
    { label: 'Accepted findings', text: String(accepted) },
    { label: 'Accepted without a checklist item or kind', text: String(counts.acceptedUntagged) },
    { label: 'Checklist', text: `${checked} checked, ${notApplicable} not applicable, ${couldNot} could not check, ${notChecked} not checked (of ${rows.length}).` },
    { label: 'Open questions', text: String(counts.openQuestions) },
    { label: 'Findings on withdrawn documents', text: onWithdrawn ? 'Yes: see the briefing.' : 'No.' },
  ];

  const because: string[] = [];
  const change: string[] = [];
  if (!hasRoom) {
    because.push('There is no data room.');
    change.push('Loading a data room, then drafting and accepting findings from it.');
  } else if (accepted === 0) {
    because.push('No finding has been accepted yet.');
    change.push('Accepting at least one finding.');
  }
  if (counts.drafts > 0) {
    because.push(`${plural(counts.drafts, 'draft finding is', 'draft findings are')} not decided.`);
    change.push(`Deciding the ${plural(counts.drafts, 'draft finding', 'draft findings')}.`);
  }
  if (counts.acceptedUntagged > 0) {
    because.push(`${plural(counts.acceptedUntagged, 'accepted finding has', 'accepted findings have')} no checklist item or kind.`);
    change.push(`Tagging the ${plural(counts.acceptedUntagged, 'accepted finding that has', 'accepted findings that have')} no checklist item or kind.`);
  }
  if (notChecked > 0) {
    because.push(`${plural(notChecked, 'checklist item is', 'checklist items are')} not checked.`);
    change.push(`Setting the ${plural(notChecked, 'checklist item that is', 'checklist items that are')} not checked.`);
  }
  if (couldNot > 0) {
    because.push(`${plural(couldNot, 'checklist item', 'checklist items')} could not be checked.`);
    change.push(
      `Providing what the ${plural(couldNot, 'checklist item that could not be checked needs', 'checklist items that could not be checked need')}, then setting ${couldNot === 1 ? 'it' : 'them'}.`,
    );
  }
  if (codes.has('withdrawn_document')) {
    because.push('A finding rests on a document that was withdrawn after it was accepted.');
    change.push('Looking again at the findings that rest on withdrawn documents (the briefing lists them).');
  }
  if (codes.has('checked_on_withdrawn')) {
    because.push('A checklist item is checked only on withdrawn documents.');
    change.push('Looking again at the checklist items that rest only on withdrawn documents (the briefing lists them).');
  }

  if (because.length === 0) {
    return {
      facts,
      recommended: 'proceed',
      recommendedBecause: 'Every draft is decided, every accepted finding is tagged, and every checklist item is set to checked or not applicable.',
      wouldChange: ['A new draft finding, a checklist item set back to not checked, or a document withdrawn after you decide would move the call to: ask for more information.'],
    };
  }
  return { facts, recommended: 'seek_more', recommendedBecause: because.join(' '), wouldChange: change };
}

function releaseBase(input: GatesInput, evidence: GateView): Base {
  const { briefing } = input;
  const latest = evidence.decisions[0];
  const current = latest !== undefined && evidence.status === 'decided';
  const evidenceText =
    latest === undefined
      ? 'Not decided.'
      : `Decided: ${lower(latest.option)}, ${evidence.status === 'decided' ? 'on the facts as they are now' : 'but the facts changed since'}.`;
  const facts: GateFact[] = [
    { label: 'Evidence gate', text: evidenceText },
    { label: 'Open questions', text: String(briefing.counts.openQuestions) },
    { label: 'Risks', text: String(briefing.risks.length) },
    { label: 'Positives', text: String(briefing.positives.length) },
    { label: 'Inputs for the PTRS', text: `${plural(briefing.ptrsInputs.length, 'finding', 'findings')}; the app computes no number.` },
    { label: 'Dissents recorded', text: String(input.dissents.length) },
  ];
  // A dissent is shown but never hashed: it stays on the record and must not reopen the decision it is under.
  const notHashed = ['Dissents recorded'];
  if (latest === undefined) {
    return {
      notHashed,
      facts,
      recommended: 'seek_more',
      recommendedBecause: 'The evidence gate has not been decided.',
      wouldChange: ['Deciding the evidence gate: go ahead, on the facts as they are now.'],
    };
  }
  if (latest.option !== 'proceed') {
    return {
      notHashed,
      facts,
      recommended: 'seek_more',
      recommendedBecause: `The evidence gate was decided: ${lower(latest.option)}, not go ahead.`,
      wouldChange: ['Deciding the evidence gate again: go ahead, on the facts as they are now.'],
    };
  }
  if (!current) {
    return {
      notHashed,
      facts,
      recommended: 'seek_more',
      recommendedBecause: 'The evidence gate was decided go ahead, but the facts changed since. Decide it again.',
      wouldChange: ['Deciding the evidence gate again: go ahead, on the facts as they are now.'],
    };
  }
  return {
    notHashed,
    facts,
    recommended: 'proceed',
    recommendedBecause: 'The evidence gate was decided: go ahead, and the facts have not changed since.',
    wouldChange: ['A change in the evidence after you decide (a new draft, an item set back, a withdrawn document) would move the call to: ask for more information.'],
  };
}

function finish(id: GateId, base: Base, input: GatesInput): GateView {
  const hashed = base.facts.filter((fact) => !(base.notHashed ?? []).includes(fact.label));
  const factsHash = hashFacts(JSON.stringify({ facts: hashed, recommended: base.recommended }));
  const own = input.decisions
    .filter((entry) => entry.gate === id)
    // Numbers grow with time, so the number alone puts the newest first (GD-10 after GD-9).
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
  const status: GateStatus = own.length === 0 ? 'not_decided' : own[0].factsHash === factsHash ? 'decided' : 'outdated';
  return {
    id,
    title: GATE_INFO[id].title,
    question: GATE_INFO[id].question,
    facts: base.facts,
    recommended: base.recommended,
    recommendedBecause: base.recommendedBecause,
    wouldChange: base.wouldChange,
    options: GATE_OPTIONS.map((option) => ({ option, label: GATE_OPTION_LABELS[option], cost: GATE_COSTS[id][option] })),
    factsHash,
    status,
    decisions: own.map((entry) => ({
      ...entry,
      dissents: input.dissents.filter((note) => note.decisionId === entry.id).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
    })),
  };
}

/** The three gates, in order, as they stand now. */
export function buildGates(input: GatesInput): GateView[] {
  const scope = finish('scope', scopeBase(input), input);
  const evidence = finish('evidence', ledByScope(evidenceBase(input), scope), input);
  const release = finish('release', ledByScope(releaseBase(input, evidence), scope), input);
  return [scope, evidence, release];
}

// ---------------------------------------------------------------------------
// What a person may submit
// ---------------------------------------------------------------------------

export type GateDecisionCheck =
  | { ok: true; option: GateOption; reason: string | null }
  | { ok: false; code: 'invalid' | 'reason_required' | 'facts_changed'; message: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = (message: string): { ok: false; code: 'invalid'; message: string } => ({ ok: false, code: 'invalid', message });

/**
 * Checks a decision request against the gate as it is now: a known option, a reason of sensible length, the facts the
 * person saw are still the facts, and a reason is given whenever the choice differs from the recommended call.
 * The recommended call is the gate's own, never a value from the request.
 */
export function checkGateDecision(gate: GateView, body: unknown): GateDecisionCheck {
  if (!isObject(body)) return invalid('The request must be an object.');
  if (!isGateOption(body.option)) return invalid('The option must be one of: go ahead, pause, ask for more information, stop.');
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') return invalid('The reason must be text.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > MAX_GATE_REASON_CHARS) return invalid(`The reason can be at most ${MAX_GATE_REASON_CHARS} characters.`);
  if (typeof body.factsHash !== 'string' || body.factsHash === '') return invalid('The request must carry the facts hash of the gate as it was shown.');
  if (body.factsHash !== gate.factsHash) {
    return { ok: false, code: 'facts_changed', message: 'The facts changed since you opened this gate. Reload and look again.' };
  }
  if (body.option !== gate.recommended && reason === '') {
    return { ok: false, code: 'reason_required', message: 'Give a reason: you chose something other than the recommended call.' };
  }
  return { ok: true, option: body.option, reason: reason === '' ? null : reason };
}

export type GateDissentCheck =
  | { ok: true; decisionId: string; role: string; reason: string }
  | { ok: false; code: 'invalid'; message: string };

/** Checks a dissent request: a decision, the function it speaks for and a reason, all text of sensible length. */
export function checkGateDissent(body: unknown): GateDissentCheck {
  if (!isObject(body)) return invalid('The request must be an object.');
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const decisionId = text(body.decisionId);
  const role = text(body.role);
  const reason = text(body.reason);
  if (decisionId === '') return invalid('Name the decision this dissent is about.');
  if (role === '') return invalid('Say which function this dissent speaks for.');
  if (role.length > MAX_DISSENT_ROLE_CHARS) return invalid(`The function can be at most ${MAX_DISSENT_ROLE_CHARS} characters.`);
  if (reason === '') return invalid('Give the reason for the dissent.');
  if (reason.length > MAX_GATE_REASON_CHARS) return invalid(`The reason can be at most ${MAX_GATE_REASON_CHARS} characters.`);
  return { ok: true, decisionId, role, reason };
}
