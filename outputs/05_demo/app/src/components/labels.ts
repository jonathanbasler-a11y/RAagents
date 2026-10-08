import type {
  AgentGroup,
  AgentTrigger,
  AgentTurnState,
  AutonomyLevel,
  ChatErrorCode,
  ClassificationId,
  ContributionRole,
  NotConsultedReason,
  PublicAgent,
  RouteSource,
  TurnStatus,
} from '@/shared/contracts';

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
    note: 'Brought in by the asset’s classification or stage. In this phase you switch them on and off by hand.',
    collapsed: false,
  },
  role: {
    label: 'Team roles',
    tag: 'Team role',
    note: 'Run in every DD. Always on.',
    collapsed: false,
  },
  other: {
    label: 'Other functions',
    tag: 'Other function',
    note: 'Built for other playbooks. Off by default for a regulatory DD.',
    collapsed: true,
  },
};

export function shortCapability(agent: Pick<PublicAgent, 'capability' | 'shortCapability'>): string {
  return agent.shortCapability?.trim() || agent.capability;
}

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  1: 'L1 Assist',
  2: 'L2 Collaborate',
  3: 'L3 Delegate under oversight',
};

const CLASSIFICATION_LABELS: Record<ClassificationId, string> = {
  orphan: 'Orphan',
  paed: 'Paediatric requirements',
  exp: 'Expedited programme',
  combo: 'Combination product',
  cdx: 'Companion diagnostic',
};

export function triggerText(trigger: AgentTrigger | undefined): string | null {
  if (!trigger) return null;
  if (trigger === 'late') return 'Usually joins when a filing is near (Phase 3 or filed).';
  return `Usually switched on by the asset classification: ${CLASSIFICATION_LABELS[trigger]}.`;
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
export const PRACTICE_REPLY_LABEL = 'Practice reply · not AI';

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
