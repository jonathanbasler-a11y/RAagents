import type {
  AgentGroup,
  AgentTrigger,
  AgentTurnState,
  AutonomyLevel,
  ChatErrorCode,
  ClassificationId,
  ContributionRole,
  ChecklistState,
  FindingBasis,
  FindingCategory,
  FindingConfidence,
  FindingStatus,
  ProposalTrace,
  NotConsultedReason,
  PublicAgent,
  RouteSource,
  TurnStatus,
} from '@/shared/contracts';
import type { DataRoomTrace } from '@/shared/contracts';
import { CHECKLIST_STATE_WORDS, FINDING_CATEGORY_WORDS } from '@/shared/checklist';
import { FINDING_BASIS_WORDS, FINDING_CONFIDENCE_WORDS } from '@/shared/findings';
import type { DocumentTurnState } from '@/shared/data-room';
import type { SelectionReason } from '@/shared/dd-setup';

/** Display text written by code. Nothing here comes from a model. */

export interface GroupInfo {
  label: string;
  /** Short tag on a profile card. */
  tag: string;
  note: string;
  /** Collapsed by default (rail and team page). */
  collapsed: boolean;
}

export const GROUP_INFO: Record<AgentGroup, GroupInfo> = {
  core: {
    label: 'Regulatory function',
    tag: 'Regulatory',
    note: 'The regulatory affairs team, one agent per role.',
    collapsed: false,
  },
  spec: {
    label: 'Specialists by asset',
    tag: 'Specialist',
    note: 'Brought in by the asset’s classification or stage, set in the DD setup. You can still switch one on or off by hand.',
    collapsed: false,
  },
  role: {
    label: 'Team roles',
    tag: 'Team role',
    note: 'Always on in every DD. Oskar and Sofia join by rule; Emeka, Saskia and Ruben answer when @mentioned.',
    collapsed: false,
  },
  other: {
    label: 'Other functions',
    tag: 'Other function',
    note: 'Built for other playbooks. Off by default for a regulatory DD.',
    collapsed: true,
  },
};

/** Whether the agents can read documents: unknown while the data room is loading or failed to load. */
export type DocumentsConnected = 'unknown' | 'none' | 'connected';

const MODEL_OUTPUT = 'Agent replies are model output, not sources.';
const STAND_IN = 'Replies in practice mode are stand-in text, not model output and not sources.';

/** The line in the header: what is connected, and what a reply is. Unknown is never worded as "no documents". */
export function phaseLineText(documents: DocumentsConnected, mode: 'live' | 'practice', shown: number): string {
  const reply = mode === 'practice' ? STAND_IN : MODEL_OUTPUT;
  if (documents === 'connected') {
    return `A data room is connected (${shown} ${shown === 1 ? 'document' : 'documents'} shown to the agents). No tools are. ${reply}`;
  }
  if (documents === 'unknown') return `No tools are connected. ${reply}`;
  return `In this phase no documents and no tools are connected. ${reply}`;
}

/** The lede of the DD workspace page. */
export function homeLedeText(documents: DocumentsConnected): string {
  const owners = 'Set up the asset and the team follows. People own every decision and every agent.';
  const output = 'What they write is model output, not a source.';
  if (documents === 'connected') {
    return `${owners} The agents read the documents of the data room and cite them by id; they have no tools. ${output}`;
  }
  if (documents === 'unknown') return `${owners} The agents have no tools. ${output}`;
  return `${owners} In this phase the agents have no documents and no tools: they explain how they would assess something and mark what needs checking. ${output}`;
}

/** The banner in the evidence checker's room. */
export function evidenceBannerText(documents: DocumentsConnected, name: string): string {
  if (documents === 'connected') {
    return `${name} can check a claim against the documents of the data room and name the document that shows it. He has no tools, so he cannot look anything up outside it.`;
  }
  if (documents === 'unknown') return `${name} has no tools, so he cannot look anything up himself.`;
  return `No documents are connected yet, so ${name} cannot verify anything. He can explain what evidence a claim would need.`;
}

const NOT_SHOWN_WORDS: Record<DataRoomTrace['notShown'][number]['reason'], string> = {
  not_provided: 'listed, not provided',
  withdrawn: 'withdrawn',
  after_as_of: 'dated after the as-of date',
  too_large: 'did not fit',
};

/** "How this turn ran": what the agents of the turn saw of the data room. Written by code from the stored trace. */
export function dataRoomTraceText(trace: DataRoomTrace): string {
  const parts = [`As of ${trace.asOf}.`, `Shown: ${trace.shown.length === 0 ? 'none' : trace.shown.join(', ')}.`];
  if (trace.notShown.length > 0) {
    parts.push(`Not shown: ${trace.notShown.map((entry) => `${entry.id} (${NOT_SHOWN_WORDS[entry.reason]})`).join(', ')}.`);
  }
  return parts.join(' ');
}

/** "How this turn ran": what a findings proposal put in the register. Written by code from the stored trace, never by the agent. */
export function proposalTraceText(trace: ProposalTrace): string {
  if (trace.problem !== null) return `Nothing was added to the register: ${trace.problem}`;
  const findings = trace.findingIds.length === 0 ? 'no drafts' : `drafts ${trace.findingIds.join(', ')}`;
  const questions = trace.questionIds.length === 0 ? 'no open questions' : `open questions ${trace.questionIds.join(', ')}`;
  const repeated = trace.duplicateIds && trace.duplicateIds.length > 0 ? ` Already in the register, not added again: ${[...new Set(trace.duplicateIds)].join(', ')}.` : '';
  return `Added to the register: ${findings}; ${questions}.${repeated} A draft is not a finding until a person accepts it.`;
}

/** What the agents do with a data-room document, in the data room list. */
export const DOCUMENT_STATE_LABELS: Record<DocumentTurnState, string> = {
  shown: 'Agents see it',
  not_provided: 'Listed, not provided',
  withdrawn: 'Withdrawn',
  after_as_of: 'Not shown: dated after the as-of date',
  too_large: 'Not shown: it did not fit',
};

/** A finding's status in the register. Only a person moves it from draft. */
export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  draft: 'Draft: no person has decided',
  accepted: 'Accepted by a person',
  rejected: 'Rejected by a person',
};

/** The four checklist states, kept apart in words as in the database. */
export const CHECKLIST_STATE_LABELS: Record<ChecklistState, string> = CHECKLIST_STATE_WORDS;

/** What kind of finding it is, as a person tagged it. */
export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = FINDING_CATEGORY_WORDS;

/** What a finding stands on. A seller's own document is attributed to the seller and never becomes verified fact. */
export const FINDING_BASIS_LABELS: Record<FindingBasis, string> = FINDING_BASIS_WORDS;

/** How sure the agent is that the quote shows the claim; not how likely the claim is to be true. */
export const FINDING_CONFIDENCE_LABELS: Record<FindingConfidence, string> = FINDING_CONFIDENCE_WORDS;

export function shortCapability(agent: Pick<PublicAgent, 'capability' | 'shortCapability'>): string {
  return agent.shortCapability?.trim() || agent.capability;
}

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  1: 'L1 Assist',
  2: 'L2 Collaborate',
  3: 'L3 Delegate under oversight',
};

export const CLASSIFICATION_LABELS: Record<ClassificationId, string> = {
  orphan: 'Orphan',
  paed: 'Paediatric requirements',
  exp: 'Expedited programme',
  combo: 'Combination product',
  cdx: 'Companion diagnostic',
};

export function triggerText(trigger: AgentTrigger | undefined): string | null {
  if (!trigger) return null;
  if (trigger === 'late') return 'Usually joins when a filing is near (Phase 3 or filed).';
  if (trigger === 'filed') return 'Joins only when the asset is filed.';
  return `Usually switched on by the asset classification: ${CLASSIFICATION_LABELS[trigger]}.`;
}

/** Why an agent is on or off for this DD, in one line. `trigger` is the agent's own trigger, used when a person overrode the rule. */
export function selectionReasonText(reason: SelectionReason, trigger: AgentTrigger | undefined): string {
  switch (reason.kind) {
    case 'always':
      return 'Always on: a team role in every DD.';
    case 'classification':
      return `On because the asset is classified: ${CLASSIFICATION_LABELS[reason.id]}.`;
    case 'late':
      return 'On because a filing is near (Phase 3 or filed).';
    case 'filed':
      return 'On because the asset is filed.';
    case 'default':
      return 'On for every regulatory DD.';
    case 'manual-on':
      return 'Switched on by you.';
    case 'manual-off':
      return `Switched off by you (${wouldJoin(trigger)}).`;
    case 'waiting':
      if (reason.trigger === 'late') return 'Joins when a filing is near (Phase 3 or filed).';
      if (reason.trigger === 'filed') return 'Joins only when the asset is filed.';
      return `Joins if the asset is classified: ${CLASSIFICATION_LABELS[reason.trigger]}.`;
    case 'not-for-dd':
      return 'Off for a regulatory DD: built for other playbooks.';
  }
}

function wouldJoin(trigger: AgentTrigger | undefined): string {
  if (trigger === undefined) return 'on by default';
  if (trigger === 'late') return 'the playbook would bring them in at Phase 3 or filed';
  if (trigger === 'filed') return 'the playbook would bring them in once the asset is filed';
  return `the playbook would bring them in: ${CLASSIFICATION_LABELS[trigger]}`;
}

function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What changed in the team after a DD setup save, from the first names of who joined and who left. */
export function teamChangeText(joined: readonly string[], left: readonly string[]): string {
  const parts: string[] = [];
  if (joined.length > 0) parts.push(`${nameList(joined)} joined the team`);
  if (left.length > 0) parts.push(`${nameList(left)} left the team`);
  return parts.length > 0 ? `Saved. ${parts.join('; ')}.` : 'Saved. The team stays the same.';
}

/** Can be brought into a team turn with @Name. The orchestrator and the synthesiser join by rule. */
export function isMentionable(agent: Pick<PublicAgent, 'kind' | 'mentionOnly'>): boolean {
  return agent.kind === 'domain' || agent.mentionOnly;
}

// ---------------------------------------------------------------------------
// Practice mode (DEMO_MODE=practice, `npm run demo:practice`): the app runs on the stand-in
// model in scripts/fake-llm.mjs, so no practice reply may pass for a real answer.
// ---------------------------------------------------------------------------

/** On every page while the demo runs in practice mode. */
export const PRACTICE_MODE_BANNER =
  'Practice mode: replies come from a stand-in model, not AI. Do not present them as real answers.';

/** On every agent reply in practice mode, instead of "Model output · not sourced". */
export const PRACTICE_REPLY_LABEL = 'Practice reply · not AI · not sourced';

// ---------------------------------------------------------------------------
// Errors: setup problems read differently from service problems
// ---------------------------------------------------------------------------

export type ErrorKind = 'setup' | 'service' | 'app';

export const ERROR_KIND_TITLES: Record<ErrorKind, string> = {
  setup: 'Setup problem',
  service: 'Service problem',
  app: 'App error',
};

const CHAT_ERRORS: Record<ChatErrorCode, { kind: ErrorKind; text: string }> = {
  llm_config: { kind: 'setup', text: 'The model connection is not set up.' },
  llm_auth: { kind: 'setup', text: 'The model gateway did not accept the key.' },
  llm_model: { kind: 'setup', text: 'The configured model is not available to this key.' },
  llm_request: { kind: 'setup', text: 'The model gateway refused the request.' },
  llm_tls: { kind: 'setup', text: 'A secure connection to the model gateway could not be made.' },
  llm_dns: { kind: 'setup', text: 'The model gateway address could not be found.' },
  llm_rate_limit: { kind: 'service', text: 'The model gateway is limiting requests. Try again in a moment.' },
  llm_outage: { kind: 'service', text: 'The model service is having an outage. Try again later.' },
  llm_timeout: { kind: 'service', text: 'The model took too long to answer.' },
  llm_network: { kind: 'service', text: 'The connection to the model gateway broke.' },
  out_of_time: { kind: 'service', text: 'The turn ran out of time.' },
  server_shutdown: {
    kind: 'service',
    text: 'The server shut down during this reply. The text shown is what had arrived before it stopped.',
  },
  internal: { kind: 'app', text: 'Something went wrong in the app.' },
};

export function describeChatError(code: ChatErrorCode | null): { kind: ErrorKind; title: string; text: string } {
  const known = code !== null && Object.hasOwn(CHAT_ERRORS, code) ? CHAT_ERRORS[code] : null;
  const entry = known ?? { kind: 'app' as const, text: 'Something went wrong.' };
  return { ...entry, title: ERROR_KIND_TITLES[entry.kind] };
}

// ---------------------------------------------------------------------------
// "How this turn ran"
// ---------------------------------------------------------------------------

export const ROUTE_SOURCE_LABELS: Record<RouteSource, string> = {
  direct: '1:1 room: this agent answers',
  explicit: '@mentions chose the agents',
  keyword: 'Routing terms in the question chose the agents',
  none: 'Nobody matched: the orchestrator answered and named who fits',
};

export const ROLE_LABELS: Record<ContributionRole, string> = {
  solo: '1:1',
  primary: 'answers first',
  secondary: 'adds to it',
  synthesis: 'summary',
};

export const AGENT_STATE_LABELS: Record<AgentTurnState, string> = {
  answered: 'answered',
  no_addition: 'nothing to add',
  failed: 'failed',
  out_of_time: 'out of time',
  not_consulted: 'not consulted',
};

export const NOT_CONSULTED_LABELS: Record<NotConsultedReason, string> = {
  over_cap: 'matched, not consulted (over the cap)',
  not_selected: 'not selected for this DD',
  joins_by_rule: 'joins by rule, not by mention',
  primary_failed: 'skipped: the first reply failed',
  too_few_contributions: 'did not run: fewer than 2 contributions',
};

export const TURN_STATUS_LABELS: Record<TurnStatus, string> = {
  running: 'Running',
  done: 'Done',
  partial: 'Partial: some text is missing',
  error: 'Error: no usable answer',
  interrupted: 'Interrupted: the server restarted',
};

/** 850 ms · 12.4 s · 2 min 05 s */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}
