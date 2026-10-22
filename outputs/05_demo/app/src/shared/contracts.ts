/**
 * Shared contracts for the Digital Human Hybrid Team chat app.
 *
 * Types only, importable from client and server code. The only runtime values are the
 * `as const` string lists that define some unions (useful for validation and display
 * order). No functions, no classes, no imports.
 *
 * Builders compile against these names. To change one, ask for it; do not edit here.
 *
 * Conventions:
 * - ids are strings (UUIDs for rows, spec ids for agents);
 * - timestamps are ISO 8601 strings in UTC (`new Date().toISOString()`);
 * - every row and response type is JSON-safe, so the API can return rows as they are.
 */

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Library groups from mockup v2, in display order. */
export const AGENT_GROUPS = ['core', 'spec', 'role', 'other'] as const;
/** core: regulatory function · spec: specialists by asset · role: team roles · other: other functions. */
export type AgentGroup = (typeof AGENT_GROUPS)[number];

export const AGENT_KINDS = ['orchestrator', 'domain', 'team-role'] as const;
/** Exactly one agent is the orchestrator. Groups core, spec and other are `domain`. */
export type AgentKind = (typeof AGENT_KINDS)[number];

export const TEAM_ROLES = ['orchestrator', 'sanitiser', 'evidence-checker', 'red-team', 'synthesiser'] as const;
/**
 * The job a `role`-group agent does in a team turn. Turn logic keys off this, never off
 * an agent id. Set for every `role` agent, and for no other agent.
 */
export type TeamRole = (typeof TEAM_ROLES)[number];

/** 1 Assist, 2 Collaborate, 3 Delegate under oversight. */
export type AutonomyLevel = 1 | 2 | 3;

/** Asset classifications that bring in a specialist in the DD request (mockup v2). */
export const CLASSIFICATION_IDS = ['orphan', 'paed', 'exp', 'combo', 'cdx'] as const;
export type ClassificationId = (typeof CLASSIFICATION_IDS)[number];

export const AGENT_TRIGGERS = [...CLASSIFICATION_IDS, 'late', 'filed'] as const;
/**
 * What brings an agent into a DD: an asset classification, `late` (the development stage
 * is Phase 3 or Filed), or `filed` (the agent joins only when the asset is filed). The DD
 * setup (stage and classifications) applies these rules when a person changes it; a person can
 * still switch any unlocked agent on or off by hand.
 */
export type AgentTrigger = (typeof AGENT_TRIGGERS)[number];

/** A spec id: lowercase letters, digits and hyphens, starting with a letter. `team` is reserved. */
export type AgentId = string;

/** The model route an agent runs on. Only `agents` exists in this phase. */
export type ModelRoute = 'agents';

export interface AgentRouting {
  /** Case-insensitive, matched as whole words or whole phrases. */
  keywords: string[];
  /** Case-sensitive, matched as whole words (regulatory acronyms such as PIP or CMC). */
  acronyms: string[];
}

/** The `## ` body headings of a spec file, in the required order. */
export const AGENT_SECTION_HEADINGS = [
  'Role',
  'In this phase',
  'Persona and voice',
  'Planned knowledge sources',
  'Tools',
  'Guardrails',
  'Escalation lines',
  'Human owner',
  'Autonomy level',
  'Example prompts',
] as const;
export type AgentSectionHeading = (typeof AGENT_SECTION_HEADINGS)[number];

/** Which AgentSections key each heading fills. */
export interface AgentSectionKeyByHeading {
  'Role': 'role';
  'In this phase': 'inThisPhase';
  'Persona and voice': 'personaAndVoice';
  'Planned knowledge sources': 'plannedKnowledgeSources';
  'Tools': 'tools';
  'Guardrails': 'guardrails';
  'Escalation lines': 'escalationLines';
  'Human owner': 'humanOwner';
  'Autonomy level': 'autonomyLevel';
  'Example prompts': 'examplePrompts';
}

/** Body sections of a spec, as Markdown text (trimmed). Every section is required and non-empty. */
export interface AgentSections {
  role: string;
  /** What the agent can and cannot do now: no documents, no tools. Server-only (prompt text). */
  inThisPhase: string;
  /** Persona brief. Server-only (prompt text). */
  personaAndVoice: string;
  plannedKnowledgeSources: string;
  tools: string;
  guardrails: string;
  /** Lines that must survive every prompt edit (BUILD-LEARNINGS rule 23). */
  escalationLines: string;
  humanOwner: string;
  autonomyLevel: string;
  /** The bullet items of "Example prompts", in order. Starter prompts in the UI. */
  examplePrompts: string[];
}

/**
 * One agent, parsed from `outputs/04_agents/<id>.md`. YAML keys are snake_case; the
 * YAML key is named on each field. outputs/04_agents/README.md is the authoring guide.
 */
export interface AgentSpec {
  /** `id`. Equals the file name without `.md`. */
  id: AgentId;
  /** `name`. Fictional first name; starts with `letter`; unique. */
  name: string;
  /** `letter`. One capital letter: the initial of the capability's key word. */
  letter: string;
  /** `capability`. The capability as named in mockup v2, e.g. "Regulatory lead". */
  capability: string;
  /** `short_capability`. Shorter label for chips and the rail. */
  shortCapability?: string;
  /** `group`. */
  group: AgentGroup;
  /** `kind`. */
  kind: AgentKind;
  /** `team_role`. Present exactly when group is `role`. */
  teamRole?: TeamRole;
  /** `order`. Unique positive integer: display order, and the routing tie-break ("spec order"). */
  order: number;
  /** `autonomy_level`. */
  autonomyLevel: AutonomyLevel;
  /** `human_owner`. A role, never a person's name. */
  humanOwner: string;
  /** `active`. The registry leaves inactive agents out entirely. */
  active: boolean;
  /** `version`. "MAJOR.MINOR.PATCH"; stored on every message the agent writes. */
  version: string;
  /** `model_route`. */
  modelRoute: ModelRoute;
  /** `routing`. */
  routing: AgentRouting;
  /** `routable`. Keyword routing may pick this agent when it is selected. Domain agents only. */
  routable: boolean;
  /** `mention_only`. Joins a team turn only when @mentioned. */
  mentionOnly: boolean;
  /** `locked`. Always selected; its switch cannot be turned off. */
  locked: boolean;
  /** `default_selected`. Selected in a workspace that has no saved selection. */
  defaultSelected: boolean;
  /** `trigger`. */
  trigger?: AgentTrigger;
  /** `handoffs`. Agent ids to suggest when a question is out of remit; narrowed to the active roster at load. */
  handoffs: AgentId[];
  /** `source_allowlist`. Planned hard filter on retrieval; empty in this phase. */
  sourceAllowlist: string[];
  /** `avatar`. Exactly `/avatars/<id>.svg` (a path under public/). */
  avatar: string;
  /** `planned_remit`. The mockup v2 remit, shown on the profile marked "planned". */
  plannedRemit: string;
  /** The body sections. */
  sections: AgentSections;
}

/** Every front-matter key a spec may use. The registry refuses any other key. */
export const AGENT_SPEC_YAML_KEYS = [
  'id',
  'name',
  'letter',
  'capability',
  'short_capability',
  'group',
  'kind',
  'team_role',
  'order',
  'autonomy_level',
  'human_owner',
  'active',
  'version',
  'model_route',
  'routing',
  'routable',
  'mention_only',
  'locked',
  'default_selected',
  'trigger',
  'handoffs',
  'source_allowlist',
  'avatar',
  'planned_remit',
] as const;
export type AgentSpecYamlKey = (typeof AGENT_SPEC_YAML_KEYS)[number];

/** Keys a spec may leave out. `team_role` is still required in group `role`. */
export const AGENT_SPEC_OPTIONAL_YAML_KEYS = [
  'short_capability',
  'team_role',
  'trigger',
] as const satisfies readonly AgentSpecYamlKey[];

/** Which AgentSpec field each front-matter key fills (`sections` comes from the body). */
export interface AgentSpecFieldByYamlKey {
  id: 'id';
  name: 'name';
  letter: 'letter';
  capability: 'capability';
  short_capability: 'shortCapability';
  group: 'group';
  kind: 'kind';
  team_role: 'teamRole';
  order: 'order';
  autonomy_level: 'autonomyLevel';
  human_owner: 'humanOwner';
  active: 'active';
  version: 'version';
  model_route: 'modelRoute';
  routing: 'routing';
  routable: 'routable';
  mention_only: 'mentionOnly';
  locked: 'locked';
  default_selected: 'defaultSelected';
  trigger: 'trigger';
  handoffs: 'handoffs';
  source_allowlist: 'sourceAllowlist';
  avatar: 'avatar';
  planned_remit: 'plannedRemit';
}

/** Profile text the browser may see: every section except the prompt-only ones. */
export type PublicAgentProfile = Omit<AgentSections, 'inThisPhase' | 'personaAndVoice' | 'examplePrompts'>;

/**
 * What the browser gets for an agent (GET /api/agents). Leaves out the persona and
 * "In this phase" text (prompt material), routing terms, handoffs and the allowlist.
 */
export type PublicAgent = Pick<
  AgentSpec,
  | 'id'
  | 'name'
  | 'letter'
  | 'capability'
  | 'shortCapability'
  | 'group'
  | 'kind'
  | 'teamRole'
  | 'order'
  | 'autonomyLevel'
  | 'humanOwner'
  | 'version'
  | 'routable'
  | 'mentionOnly'
  | 'locked'
  | 'defaultSelected'
  | 'trigger'
  | 'avatar'
  | 'plannedRemit'
> & {
  profile: PublicAgentProfile;
  examplePrompts: string[];
};

/** Options for loading the agent registry (src/server/agents). */
export interface LoadRegistryOptions {
  /** Folder with the `<id>.md` specs. Default: env AGENT_SPECS_DIR, else `../../04_agents` from process.cwd(). */
  specsDir?: string;
  /** Folder that holds `avatars/<id>.svg`. Default: `<process.cwd()>/public`. */
  publicDir?: string;
}

/** The loaded, validated roster. Inactive agents are not in it. */
export interface AgentRegistry {
  /** Absolute path the specs were read from. */
  readonly specsDir: string;
  /** Active agents, sorted by `order`. */
  readonly agents: readonly AgentSpec[];
  readonly orchestrator: AgentSpec;
  /** Undefined for unknown and for inactive ids. */
  get(id: AgentId): AgentSpec | undefined;
}

export interface SpecIssue {
  /** The spec file name or agent id the issue is about. */
  source: string;
  message: string;
}

export interface SpecValidationResult {
  ok: boolean;
  issues: SpecIssue[];
}

export interface ValidateSpecsOptions {
  /** Whether an avatar path such as `/avatars/reglead.svg` exists. Default: looks under `<process.cwd()>/public`. */
  avatarExists?: (avatarPath: string) => boolean;
}

// ---------------------------------------------------------------------------
// Rooms, threads, turns and messages (store rows)
// ---------------------------------------------------------------------------

/** The team chat's id. Agent ids may not be `team`. */
export type TeamChatId = 'team';
/** `team` or an agent id (that agent's 1:1 room). */
export type RoomId = TeamChatId | AgentId;

/** One workspace per DD case later; `demo` until then. */
export type WorkspaceId = string;
export type DefaultWorkspaceId = 'demo';

export const THREAD_STATUSES = ['active', 'archived'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** A room's conversation. A room has one active thread; "new conversation" archives it. */
export interface Thread {
  id: string;
  workspaceId: WorkspaceId;
  roomId: RoomId;
  status: ThreadStatus;
  createdAt: string;
  archivedAt: string | null;
}

export const TURN_STATUSES = ['running', 'done', 'partial', 'error', 'interrupted'] as const;
/**
 * - running: in progress; holds the room lock.
 * - done: every planned step finished.
 * - partial: finished, but some planned text is missing (a reply broke off, a secondary failed, the deadline hit).
 * - error: no usable answer (the primary failed, or setup is missing).
 * - interrupted: the server restarted or shut down while it ran, or the turn outlived its deadline
 *   and grace (set by reconcileStaleTurns or interruptTurn).
 */
export type TurnStatus = (typeof TURN_STATUSES)[number];
export type TerminalTurnStatus = Exclude<TurnStatus, 'running'>;

/** One question and everything it caused. */
export interface Turn {
  id: string;
  threadId: string;
  workspaceId: WorkspaceId;
  roomId: RoomId;
  /** Browser-generated; unique across all turns. A repeat POST is a no-op. */
  clientTurnId: string;
  status: TurnStatus;
  /** Id of the server process that started the turn. */
  bootId: string;
  /** Stored as route_json. Null until the turn has been routed (see Store.saveTurnTrace). */
  trace: TurnTrace | null;
  /** When the runner gives up (the turn deadline). */
  deadlineAt: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
}

export const MESSAGE_AUTHORS = ['human', 'agent', 'note'] as const;
/** human: the question · agent: a model reply · note: text written by code (routing notes). */
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

export const MESSAGE_STATUSES = ['complete', 'partial', 'error'] as const;
/**
 * - complete: the reply ended normally. `truncated` marks a stop at the output cap ("cut off").
 * - partial: the reply broke off (stream error, missing [DONE], deadline). The text so far is kept.
 * - error: no usable reply. Text is usually empty but keeps anything received.
 * partial and error carry errorCode and correlationId. Human and note messages are complete.
 */
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** All chat data is derived: it never enters an evidence corpus. */
export type Provenance = 'derived';

/** One message. Append-only: a saved message is never updated or deleted. */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  /** Position in the thread; strictly increasing. */
  seq: number;
  author: MessageAuthor;
  /** Agent messages only. */
  agentId: AgentId | null;
  /** Snapshot of the agent's name when it wrote the message. */
  agentName: string | null;
  agentVersion: string | null;
  /** Hash of the exact prompt sent to the model. */
  promptHash: string | null;
  /** Model id the gateway reported. */
  model: string | null;
  provenance: Provenance;
  status: MessageStatus;
  truncated: boolean;
  text: string;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Routing and turn traces ("How this turn ran")
// ---------------------------------------------------------------------------

export const ROUTE_SOURCES = ['direct', 'explicit', 'keyword', 'none'] as const;
/**
 * - direct: a 1:1 room; its agent answers.
 * - explicit: @mentions picked the agents.
 * - keyword: routing terms picked the agents.
 * - none: nobody matched; the orchestrator answers and names who fits.
 */
export type RouteSource = (typeof ROUTE_SOURCES)[number];

export const NOT_CONSULTED_REASONS = [
  'over_cap',
  'not_selected',
  'joins_by_rule',
  'primary_failed',
  'too_few_contributions',
] as const;
/**
 * - over_cap: matched, but past the mention or keyword cap ("matched, not consulted").
 * - not_selected: @mentioned, but not selected for this DD (a note says how to switch it on).
 * - joins_by_rule: @mentioned a team role that joins by rule, not by mention (orchestrator, synthesiser).
 * - primary_failed: skipped because the primary failed.
 * - too_few_contributions: the synthesiser did not run (fewer than 2 substantive contributions).
 */
export type NotConsultedReason = (typeof NOT_CONSULTED_REASONS)[number];

export interface NotConsulted {
  agentId: AgentId;
  reason: NotConsultedReason;
}

/** Who the router picked, before any model call. Written by code, never by a model. */
export interface RouteDecision {
  source: RouteSource;
  /** Answers first, streamed. Absent only if no agent can answer. */
  primary?: AgentId;
  /** Run in parallel after the primary, in rank order. */
  secondaries: AgentId[];
  notConsulted: NotConsulted[];
  /** Code-written notes shown in the thread, e.g. about an unselected agent. */
  notes: string[];
  /** Whether the synthesiser may run at the end of this turn (it still needs 2+ contributions). */
  synthesis: boolean;
  /** Routing terms that matched, per agent id (keyword routing). */
  matchedTerms?: Record<AgentId, string[]>;
}

export const AGENT_TURN_STATES = ['answered', 'no_addition', 'failed', 'out_of_time', 'not_consulted'] as const;
/** Kept distinct everywhere: in the trace, the SSE stream and the UI. */
export type AgentTurnState = (typeof AGENT_TURN_STATES)[number];

export const CONTRIBUTION_ROLES = ['solo', 'primary', 'secondary', 'synthesis'] as const;
/** solo: the agent of a 1:1 room. */
export type ContributionRole = (typeof CONTRIBUTION_ROLES)[number];

/** What one agent did in a turn. */
export interface AgentOutcome {
  agentId: AgentId;
  agentName: string;
  role: ContributionRole;
  state: AgentTurnState;
  /** The saved message, if the agent wrote one. */
  messageId?: string;
  model?: string;
  durationMs?: number;
  truncated?: boolean;
  /** Set when state is not_consulted. */
  reason?: NotConsultedReason;
  /** Set when state is failed or out_of_time. */
  errorCode?: ChatErrorCode;
}

/** Stored with the turn (route_json); "How this turn ran" renders it with code. */
export interface TurnTrace {
  route: RouteDecision;
  /** Every agent the route named (consulted or not), plus the synthesiser if it ran. */
  agents: AgentOutcome[];
  /** Which data-room documents the agents saw in this turn. Left out when the workspace has no data room. */
  dataRoom?: DataRoomTrace;
  /** Set on a findings proposal turn (see TURN_INTENTS). */
  intent?: TurnIntent;
  /** What a findings proposal turn put in the register: ids of the drafts and of the open questions, or why it put nothing. */
  proposal?: ProposalTrace;
}

export const TURN_INTENTS = ['propose-findings'] as const;
/** propose-findings: the person asks an agent, in its own room, to propose findings from the data room. */
export type TurnIntent = (typeof TURN_INTENTS)[number];

export interface ProposalTrace {
  findingIds: string[];
  questionIds: string[];
  /** Ids of the findings that claims of this turn repeated and that were not added again. Left out when none. */
  duplicateIds?: string[];
  /** Why nothing was added, when the reply could not be used. */
  problem: string | null;
}

// ---------------------------------------------------------------------------
// Errors shown in the chat
// ---------------------------------------------------------------------------

export const LLM_ERROR_KINDS = [
  'config',
  'auth',
  'model',
  'request',
  'rate_limit',
  'outage',
  'timeout',
  'network',
  'tls',
  'dns',
] as const;
/**
 * - config: env missing or a placeholder (no call was made).
 * - auth: key refused · model: model not allowed or unknown · request: the gateway refused the request shape.
 * - rate_limit: 429 · outage: 5xx · timeout: deadline hit · network: connection failed or reset.
 * - tls, dns: permanent connection errors; never retried.
 * The UI shows config and request problems differently from outages.
 */
export type LlmErrorKind = (typeof LLM_ERROR_KINDS)[number];

/**
 * Error codes in chat messages, turns and SSE `error` events.
 * server_shutdown: the server process got SIGINT or SIGTERM while the reply streamed; the text that had arrived was saved.
 */
export type ChatErrorCode = `llm_${LlmErrorKind}` | 'out_of_time' | 'server_shutdown' | 'internal';

// ---------------------------------------------------------------------------
// Server-sent events: POST /api/rooms/[room]/turns
// ---------------------------------------------------------------------------

/**
 * One SSE message per event: `data: <JSON of the event>` then a blank line. No `event:`
 * or `id:` fields. Order: turn, route, then per agent agent_start → delta* → agent_end
 * (or no_addition), notes and errors as they happen, then done. A heartbeat goes out
 * every 15 s. A turn-level failure sends `error` without messageId, then `done`.
 */
export type ChatEvent =
  | {
      type: 'turn';
      turnId: string;
      threadId: string;
      roomId: RoomId;
      clientTurnId: string;
      userMessageId: string;
      startedAt: string;
    }
  | { type: 'route'; route: RouteDecision }
  | { type: 'agent_start'; agentId: AgentId; messageId: string; role: ContributionRole }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'no_addition'; agentId: AgentId; messageId?: string }
  | { type: 'agent_end'; messageId: string; status: MessageStatus; truncated: boolean }
  | { type: 'note'; text: string; messageId?: string }
  | { type: 'error'; code: ChatErrorCode; correlationId: string; messageId?: string }
  | { type: 'done'; turnId: string; status: TerminalTurnStatus }
  | { type: 'heartbeat' };

export type ChatEventType = ChatEvent['type'];

// ---------------------------------------------------------------------------
// Model connection (src/server/llm)
// ---------------------------------------------------------------------------

export const LLM_ROUTES = ['agents', 'judge'] as const;
export type LlmRouteName = (typeof LLM_ROUTES)[number];

/** A resolved route. Server-only: holds the key. Never log it, never send it to the browser. */
export interface LlmRouteConfig {
  route: LlmRouteName;
  /** Up to and including the API version path, e.g. https://<gateway>/v1. */
  baseUrl: string;
  apiKey: string;
  /** Header that carries the key; null means `Authorization: Bearer <key>`. */
  apiKeyHeader: string | null;
  /** Exact model id; no "latest" aliases. */
  model: string;
  /** Output token cap per reply. */
  maxTokens: number;
  /** Deadline per call, including reading the body. */
  timeoutMs: number;
}

/** Why a route cannot be used. Safe to show: names variables, never values or hosts. */
export interface LlmConfigError {
  kind: 'config';
  message: string;
  /** Variable names that are missing or hold a placeholder. */
  missing: string[];
}

export type LlmConfigResult =
  | { ok: true; config: LlmRouteConfig; warnings: string[] }
  | { ok: false; error: LlmConfigError; warnings: string[] };

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Overrides the route's maxTokens. */
  maxTokens?: number;
  temperature?: number;
  /** The turn deadline. Never the browser's request.signal. */
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  /** As the gateway sent it ("stop", "length", ...), or null if none arrived. */
  finishReason: string | null;
  /** finishReason was length or max_tokens. */
  truncated: boolean;
  /** The stream broke after the first token; text holds what arrived. */
  partial: boolean;
  /** Model id the gateway reported (else the configured id). */
  model: string;
  /** Why a partial result stopped. */
  errorKind?: LlmErrorKind;
  /** Set on a partial result: the server log line that says why it stopped carries this id. */
  correlationId?: string;
}

/** A stream yields deltas, then exactly one `end`. */
export type LlmStreamEvent = { type: 'delta'; text: string } | { type: 'end'; result: LlmResult };

/** Carried by the LlmError the client throws when no text was produced. */
export interface LlmErrorInfo {
  kind: LlmErrorKind;
  /** Safe to log: no key, no host. */
  message: string;
  /** HTTP status, when there was a response. */
  status?: number;
  retryAfterMs?: number;
  /** Remembered for the process (auth, model): later calls fail at once without a request. */
  permanent: boolean;
}

export interface LlmClient {
  readonly route: LlmRouteName;
  readonly model: string;
  /** One non-streaming call. Throws LlmError when no text was produced. */
  complete(request: LlmRequest): Promise<LlmResult>;
  /** Streams deltas, then one `end`. Throws LlmError (before any delta) when no text was produced. */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

export interface CreateLlmClientOptions {
  config: LlmRouteConfig;
  /** Injected; tests pass a fake. */
  fetch: typeof fetch;
  /** Test hooks for retry backoff and clocks. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Store (src/server/chat/store.ts): synchronous, node:sqlite, .data/chat.db
// ---------------------------------------------------------------------------

export interface StoreOptions {
  /** Clock for timestamps; tests freeze it. */
  now?: () => Date;
  /** Id generator; default crypto.randomUUID. */
  newId?: () => string;
  /** The boot id of this server process: the only turns interruptTurn may end. Without it interruptTurn throws. */
  bootId?: string;
}

export interface StartTurnInput {
  workspaceId: WorkspaceId;
  roomId: RoomId;
  clientTurnId: string;
  bootId: string;
  deadlineAt: string;
  /**
   * The most turns that may run at once across all rooms. When that many already run, startTurn
   * throws ServerBusyError before it writes anything. Left out: no limit. A repeated clientTurnId
   * and a busy room are answered first.
   */
  maxRunningTurns?: number;
}

export interface InterruptTurnInput {
  turnId: string;
  errorCode: ChatErrorCode;
  correlationId: string;
}

/** How long past its deadline a running turn may go before reconcileStaleTurns ends it. */
export interface ReconcileOptions {
  /**
   * Runtime mode: end only turns of any process that are past their deadline by more than this
   * many ms (the runner's own grace). Left out: boot mode (turns of another boot, and this boot's turns past their deadline).
   */
  graceMs?: number;
}

export interface StartTurnResult {
  /** false: a turn with this clientTurnId already existed and is returned unchanged. */
  created: boolean;
  turn: Turn;
  thread: Thread;
}

export interface AppendUserMessageInput {
  turnId: string;
  text: string;
}

export interface AppendAgentMessageInput {
  /** Allocated at agent_start, so the browser can follow the stream by id. */
  id: string;
  turnId: string;
  agentId: AgentId;
  agentName: string;
  agentVersion: string;
  /** Null when the agent failed before a prompt was built. */
  promptHash: string | null;
  model: string | null;
  text: string;
  status: MessageStatus;
  truncated: boolean;
  errorCode?: ChatErrorCode | null;
  correlationId?: string | null;
}

export interface AppendNoteInput {
  /** Optional pre-allocated id (to match an SSE `note` event). */
  id?: string;
  turnId: string;
  text: string;
}

export interface AppendResult {
  message: Message;
  /** false: the message already existed and is returned unchanged. */
  inserted: boolean;
}

export interface FinishTurnInput {
  turnId: string;
  /** `interrupted` is reserved for reconcileStaleTurns. */
  status: Exclude<TerminalTurnStatus, 'interrupted'>;
  trace: TurnTrace | null;
  errorCode?: ChatErrorCode | null;
  correlationId?: string | null;
}

export interface NewThreadResult {
  thread: Thread;
  /** The thread that was archived, if the room had one. */
  archived: Thread | null;
}

/**
 * Chat persistence. All methods are synchronous.
 * Invariants: append-only (no message is updated or deleted); one active thread per
 * room; at most one running turn per room, enforced in the database.
 */
export interface Store {
  /** The room's active thread, created on first use. */
  getActiveThread(workspaceId: WorkspaceId, roomId: RoomId): Thread;
  /** Archives the active thread and opens an empty one. Throws RoomBusyError while a turn runs. */
  newThread(workspaceId: WorkspaceId, roomId: RoomId): NewThreadResult;
  /**
   * Starts a turn in the room's active thread. Idempotent by clientTurnId: a repeat returns
   * the existing turn with created false (the caller checks it belongs to the same room).
   * Throws RoomBusyError when another turn runs in the room.
   */
  startTurn(input: StartTurnInput): StartTurnResult;
  /** Saves the trace of a running turn (the route as soon as it is known). Ignored once the turn has finished. */
  saveTurnTrace(turnId: string, trace: TurnTrace): void;
  /** The turn's question. Insert-once: a second call for the same turn returns the first message. */
  appendUserMessage(input: AppendUserMessageInput): AppendResult;
  /** A finished agent reply. Insert-once by id: a repeat returns the saved row unchanged. */
  appendAgentMessage(input: AppendAgentMessageInput): AppendResult;
  /** A code-written note. Insert-once when an id is given. */
  appendNote(input: AppendNoteInput): AppendResult;
  /** Moves a running turn to its terminal status and saves the trace. A finished turn is returned unchanged. */
  finishTurn(input: FinishTurnInput): Turn;
  getTurn(turnId: string): Turn | null;
  getRunningTurn(workspaceId: WorkspaceId, roomId: RoomId): Turn | null;
  /** A thread's messages by seq. */
  listMessages(threadId: string): Message[];
  /** A thread's turns, oldest first. */
  listTurns(threadId: string): Turn[];
  /**
   * Ends a running turn of this server process as interrupted (the server is shutting down), keeping
   * the code and correlation id. Only turns started with this store's bootId are touched: a turn of
   * another process, or one that already finished, is returned unchanged. Throws if the store was
   * opened without a bootId.
   */
  interruptTurn(input: InterruptTurnInput): Turn;
  /**
   * On boot: running turns from another bootId become interrupted, and so do this boot's turns past
   * their deadline. At runtime (options.graceMs): only turns past deadline plus grace, any boot.
   * Returns how many changed.
   */
  reconcileStaleTurns(bootId: string, options?: ReconcileOptions): number;
  /** The saved selection, or null if this workspace never saved one (use the defaults). */
  getSelection(workspaceId: WorkspaceId): AgentId[] | null;
  setSelection(workspaceId: WorkspaceId, agentIds: AgentId[]): void;
  /** The saved DD setup, or null if this workspace never saved one (use the default). */
  getDdSetup(workspaceId: WorkspaceId): DdSetup | null;
  /**
   * Saves a new DD setup and the selection that goes with it in ONE transaction. `change` receives the
   * saved setup and selection (null when never saved) and returns the new pair. It runs inside the
   * transaction and must not call the store. Throws RangeError for an unknown stage or classification
   * and TypeError for an empty agent id; either way nothing is saved.
   */
  updateDdSetup(
    workspaceId: WorkspaceId,
    change: (current: { setup: DdSetup | null; selection: AgentId[] | null }) => { setup: DdSetup; selection: AgentId[] },
  ): { setup: DdSetup; selection: AgentId[] };
  /** The workspace's data room with every document (withdrawn ones too), or null when none was started. */
  getDataRoom(workspaceId: WorkspaceId): DataRoom | null;
  /**
   * Starts the workspace's data room with the documents given, in ONE transaction. A workspace has at most
   * one data room: throws DataRoomExistsError when it already has one. Throws RangeError (nothing saved) for an
   * invalid as-of date or document, including a provided document dated after the as-of date.
   */
  createDataRoom(workspaceId: WorkspaceId, input: { asOf: string; documents: NewDocument[] }): DataRoom;
  /**
   * Adds one document, with the next free id when none is given. Throws NoDataRoomError, DuplicateDocumentError
   * (the id exists) or RangeError (invalid, or dated after the as-of date). A saved document's text never changes.
   */
  addDocument(workspaceId: WorkspaceId, input: NewDocument): DataRoomDocument;
  /**
   * Withdraws a document: agents stop seeing it, the list still shows it with the reason. The only change a saved
   * document can ever have. Throws NoDataRoomError, DocumentNotFoundError or RangeError (empty reason). Withdrawing
   * a withdrawn document returns it unchanged.
   */
  withdrawDocument(workspaceId: WorkspaceId, documentId: string, reason: string): DataRoomDocument;
  /** Findings of the workspace by id, drafts and decided ones. */
  listFindings(workspaceId: WorkspaceId): Finding[];
  listOpenQuestions(workspaceId: WorkspaceId): OpenQuestion[];
  /** The audit trail, oldest first. */
  listFindingEvents(workspaceId: WorkspaceId): FindingEvent[];
  /**
   * Puts an agent's checked claims in the register as drafts and its refused claims in the open questions, in ONE
   * transaction (all or nothing), with a 'proposed' event for each draft. The register checks each claim again against
   * the room: the document must exist, not be withdrawn and be dated on or before the as-of date, and the quote must be
   * in it. The basis, date and title come from the document. There is no way to set a status here: this is the only
   * way an agent's claim enters the register, and it always enters as a draft. A claim on a document and a quote the
   * register already holds (at any status, so a rejected finding is not asked again) is not added again: it comes back
   * in `duplicates` with the id it repeats. Throws NoDataRoomError, or RangeError (nothing saved) for a claim it refuses
   * or a turn that does not exist.
   */
  proposeFindings(workspaceId: WorkspaceId, input: ProposeFindingsInput): ProposeFindingsResult;
  /**
   * A person's decision on a draft, recorded once with the time, LOCAL_PERSON and an optional note (up to 300
   * characters), plus an audit event. The ONLY writer of a finding's status. Throws FindingNotFoundError,
   * FindingAlreadyDecidedError, FindingSourceWithdrawnError (accepting a finding whose document was withdrawn; rejecting
   * it is allowed) or RangeError (a decision other than accepted or rejected, or a long note).
   */
  decideFinding(workspaceId: WorkspaceId, findingId: string, decision: 'accepted' | 'rejected', note: string | null, tag?: FindingTagInput): Finding;
  /**
   * Which checklist item an accepted finding supports and whether it is a positive, a risk or neutral, set once by a
   * person (insert-only: a tag is never changed). The ONLY writer of a tag. Accepting a finding can carry the tag in the
   * same transaction (see decideFinding); this is for a finding accepted without one. Throws FindingNotFoundError,
   * FindingNotAcceptedError (a draft or rejected finding has no tag), FindingAlreadyTaggedError or RangeError (an unknown
   * item or category).
   */
  tagFinding(workspaceId: WorkspaceId, findingId: string, tag: FindingTagInput): FindingTag;
  listFindingTags(workspaceId: WorkspaceId): FindingTag[];
  /**
   * Moves one checklist item to a state, as a person's action, with an append-only event. "checked" needs at least one
   * accepted finding tagged to the item (ChecklistNeedsFindingError); "not applicable" and "could not check" need a
   * reason (RangeError). The ONLY writer of a checklist state.
   */
  setChecklistState(workspaceId: WorkspaceId, item: ChecklistItemId, state: ChecklistState, reason: string | null): ChecklistEntry;
  /** Every checklist item in the order of CHECKLIST_ITEM_IDS; an item nobody touched is "not checked". */
  listChecklist(workspaceId: WorkspaceId): ChecklistEntry[];
  /** The checklist's audit trail, oldest first. */
  listChecklistEvents(workspaceId: WorkspaceId): ChecklistEvent[];
  /**
   * The three gates as they stand now: the facts and the recommended call are built here, from this workspace's DD setup,
   * data room, findings, checklist and earlier decisions (no model), with every decision and dissent. Read-only.
   */
  listGates(workspaceId: WorkspaceId, team: GateTeam): GateView[];
  /**
   * Records a person's decision at a gate. The ONLY writer of a gate decision. The facts and the recommended call are
   * rebuilt inside the transaction and never taken from the request. Throws GateFactsChangedError (the request carries the
   * facts hash of an older view), GateReasonRequiredError (the option differs from the recommended call and no reason was
   * given) or RangeError (an unknown gate or option, a reason that is not text or is too long).
   */
  decideGate(workspaceId: WorkspaceId, gate: GateId, request: unknown, team: GateTeam): GateDecision;
  /**
   * Records a dissent under an existing decision of the same gate. The ONLY writer of a dissent; it never changes the
   * decision. Throws GateDecisionNotFoundError or RangeError (a role or reason that is missing, not text or too long).
   */
  recordGateDissent(workspaceId: WorkspaceId, gate: GateId, request: unknown): GateDissent;
  close(): void;
}

// ---------------------------------------------------------------------------
// Policy numbers from the approved plan
// ---------------------------------------------------------------------------

/**
 * Code that enforces one of these declares it with this type, so a drifting value fails
 * the type check: `const MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;`
 */
export interface ChatLimits {
  /** Longest question the composer and the API accept, in characters (after trimming). */
  turnTextMaxChars: 8000;
  /** Most agents @mentions bring in; the rest are "matched, not consulted". */
  mentionCap: 4;
  /** Most agents keyword routing brings in. */
  keywordCap: 3;
  /** Most model calls in one team turn: 4 contributors plus 1 synthesis. */
  maxCallsPerTurn: 5;
  /** Substantive contributions needed before the synthesiser runs. */
  synthesisMinContributions: 2;
  /** Valid messages of history a 1:1 room sends to the model. */
  oneToOneHistoryMessages: 20;
  /** Human and specialist messages a team specialist sees as context. */
  specialistContextMessages: 8;
  /** Wall-clock deadline for one turn. */
  turnDeadlineMs: 180000;
  /** Deadline for one model call, including reading the body. */
  llmCallTimeoutMs: 120000;
  /** SSE heartbeat interval. */
  heartbeatMs: 15000;
}

// ---------------------------------------------------------------------------
// HTTP API. Node runtime, dynamic. Every POST needs `Sec-Fetch-Site: same-origin` and a
// JSON content type, else 403 with no model call and no write.
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  'invalid_request',
  'forbidden',
  'not_found',
  'room_busy',
  'server_busy',
  'locked_agent',
  'data_room_exists',
  'no_data_room',
  'document_not_found',
  'finding_not_found',
  'finding_decided',
  'finding_source_withdrawn',
  'finding_not_accepted',
  'finding_tagged',
  'checklist_needs_finding',
  'checklist_item_not_found',
  'gate_not_found',
  'gate_reason_required',
  'gate_facts_changed',
  'gate_decision_not_found',
  'llm_not_configured',
  'internal',
] as const;
/**
 * HTTP status: invalid_request 400, forbidden 403, not_found 404, room_busy 409, server_busy 429,
 * locked_agent 409, data_room_exists 409, no_data_room 409, document_not_found 404, finding_not_found 404, finding_decided 409,
 * finding_source_withdrawn 409, finding_not_accepted 409, finding_tagged 409, checklist_needs_finding 409,
 * checklist_item_not_found 404, llm_not_configured 503, internal 500.
 * server_busy: two turns already run on this server (the most it runs at once); nothing was written.
 */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Body of every non-2xx JSON response. Generic text only; details stay in the server log under the correlation id. */
export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  correlationId: string;
  /** room_busy only: the turn holding the room. */
  runningTurnId?: string;
}

/** GET /api/agents */
export interface AgentsResponse {
  /** Sorted by `order`. */
  agents: PublicAgent[];
}

/** Whether the agents route can be called. Safe to show: names, never values or hosts. */
export interface LlmSetupStatus {
  configured: boolean;
  /** Variable names to set. */
  missing: string[];
  /** Text for the setup banner, or null when configured. */
  message: string | null;
}

export type HealthStatus = 'ok' | 'degraded' | 'error';
export type HealthCheckState = 'ok' | 'error' | 'not_configured';

/**
 * "practice" when the server runs on the stand-in model (`npm run demo:practice`, DEMO_MODE=practice).
 * Every page and every reply then says so; any other setting is live.
 */
export type DemoMode = 'live' | 'practice';

export interface HealthReport {
  status: HealthStatus;
  checks: {
    database: HealthCheckState;
    agents: HealthCheckState;
    llm: HealthCheckState;
  };
  agentCount: number;
  llm: LlmSetupStatus;
  /** When this server process started; a change means a restart. */
  startedAt: string;
}

/** What the contracts-phase stub returns; the real route returns a HealthReport. */
export interface HealthStubResponse {
  status: 'stub';
}

/** GET /api/health */
export type HealthResponse = HealthReport | HealthStubResponse;

/** GET /api/rooms/[room]/messages (the room's active thread). */
export interface RoomMessagesResponse {
  roomId: RoomId;
  thread: Thread;
  /** By seq. */
  messages: Message[];
  /** Oldest first; for "How this turn ran". */
  turns: Turn[];
  /** Show "in progress" and poll until it ends. */
  runningTurn: Turn | null;
}

/**
 * POST /api/rooms/[room]/turns. The server owns history: the browser sends only this.
 * 200 text/event-stream: ChatEvent stream (see above).
 * 200 application/json: TurnDuplicateResponse (clientTurnId seen before; poll messages).
 * 4xx/5xx: ApiErrorBody (room_busy is 409).
 * Once a 200 arrives the browser never re-POSTs the turn.
 */
export interface PostTurnRequest {
  /** 1 to 8,000 characters after trimming. */
  text: string;
  /** Browser-generated UUID (crypto.randomUUID()). */
  clientTurnId: string;
  /** The browser's IANA time zone, e.g. "Europe/Paris". */
  tz: string;
  /** Only in an agent's own room, and only with a data room that has documents; the server then uses its own question text. */
  intent?: TurnIntent;
}

export interface TurnDuplicateResponse {
  duplicate: true;
  turnId: string;
  status: TurnStatus;
}

/** POST /api/rooms/[room]/new: archives the active thread (409 room_busy while a turn runs). Body: {}. */
export type NewThreadRequest = Record<string, never>;

export interface NewThreadResponse {
  thread: Thread;
  archivedThreadId: string | null;
}

/** GET /api/selection, and the reply to POST /api/selection. */
export interface SelectionResponse {
  workspaceId: WorkspaceId;
  /** Selected agent ids by `order`. Always includes every locked agent. */
  selected: AgentId[];
  /** default: nothing saved for this workspace yet. */
  source: 'default' | 'saved';
}

/** POST /api/selection: flip one switch. 409 locked_agent when switching a locked agent off. */
export interface SelectionUpdateRequest {
  agentId: AgentId;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// DD setup (development stage and asset classifications)
// ---------------------------------------------------------------------------

/** The development stages of the asset, in order (mockup v2). */
export const DEVELOPMENT_STAGES = ['Phase 1', 'Phase 2', 'Phase 3', 'Filed'] as const;
export type DevelopmentStage = (typeof DEVELOPMENT_STAGES)[number];

/**
 * What the person says about the asset. The playbook uses it to bring agents in (see the agent
 * `trigger`). `classifications` is unique and in CLASSIFICATION_IDS order.
 */
export interface DdSetup {
  stage: DevelopmentStage;
  classifications: ClassificationId[];
}

/** GET /api/dd-setup, and the reply to POST /api/dd-setup. */
export interface DdSetupResponse {
  workspaceId: WorkspaceId;
  setup: DdSetup;
  /** default: nothing saved for this workspace yet. */
  source: 'default' | 'saved';
  /** The selection after the change, so the page and the rail update from one reply. */
  selection: SelectionResponse;
}

/** POST /api/dd-setup: the whole setup, not a patch. 400 for an unknown stage or classification. */
export type DdSetupUpdateRequest = DdSetup;

// ---------------------------------------------------------------------------
// Data room: the documents a DD works from. Rules in src/shared/data-room.ts.
// ---------------------------------------------------------------------------

/**
 * What kind of source a document is, which decides how agents word it:
 * - company-disclosure: written by the company or licensor. What it says is an attributed claim.
 * - agency-record: a regulator's own record (minutes, letters, review documents).
 * - registry: an entry of a public registry.
 * - publication: a published paper or similar.
 */
export const DOCUMENT_SOURCE_TYPES = ['company-disclosure', 'agency-record', 'registry', 'publication'] as const;
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

/** practice-pack: loaded from the fictional practice case. added: put in by a person. */
export const DOCUMENT_ORIGINS = ['practice-pack', 'added'] as const;
export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number];

export interface DataRoomDocument {
  /** DR-00 to DR-999. Stable; never reused. */
  id: string;
  title: string;
  sourceType: DocumentSourceType;
  /** YYYY-MM-DD. Null only for a document that is listed but not provided. */
  publishedAt: string | null;
  /** Where it came from, shown as text. Never fetched. */
  url: string | null;
  /** false: the index lists it but nobody has given it (for example "Paediatric study plan"). */
  provided: boolean;
  origin: DocumentOrigin;
  /** Null when not provided. */
  text: string | null;
  addedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
}

export interface DataRoom {
  workspaceId: WorkspaceId;
  /** YYYY-MM-DD. No document dated after it can be in the room, and none is ever shown to an agent. */
  asOf: string;
  createdAt: string;
  /** By id. */
  documents: DataRoomDocument[];
}

/** A document to put in. Left out: `id` (the next free one), `origin` ('added'). */
export interface NewDocument {
  id?: string;
  title: string;
  sourceType: DocumentSourceType;
  publishedAt: string | null;
  url?: string | null;
  provided: boolean;
  text: string | null;
  origin?: DocumentOrigin;
}

/**
 * Why a listed document was not shown to the agents in a turn:
 * - not_provided: listed in the index, never given.
 * - withdrawn: a person withdrew it.
 * - after_as_of: dated after the as-of date (the store refuses such a document; this is the second wall).
 * - too_large: it did not fit the room left in the prompt.
 */
export const NOT_SHOWN_REASONS = ['not_provided', 'withdrawn', 'after_as_of', 'too_large'] as const;
export type NotShownReason = (typeof NOT_SHOWN_REASONS)[number];

/** What the agents of one turn saw of the data room; stored in the turn's trace. */
export interface DataRoomTrace {
  asOf: string;
  /** Document ids, in the order they were put in the prompt. */
  shown: string[];
  notShown: Array<{ id: string; reason: NotShownReason }>;
}

/** A document without its text, for lists. */
export interface DataRoomDocumentSummary extends Omit<DataRoomDocument, 'text'> {
  /** Length of the text; 0 when not provided. */
  chars: number;
}

/** GET /api/data-room */
export interface DataRoomResponse {
  workspaceId: WorkspaceId;
  /** Null: no data room was started in this workspace. */
  dataRoom: { asOf: string; createdAt: string; documents: DataRoomDocumentSummary[] } | null;
  /** Whether the fictional practice data room can be loaded here. */
  practiceAvailable: boolean;
  limits: { documentChars: number; turnChars: number };
}

/** GET /api/data-room/documents/[id], and the reply to adding or withdrawing one. */
export interface DataRoomDocumentResponse {
  document: DataRoomDocument;
}

/** POST /api/data-room: start the data room. Either with an as-of date, or with the fictional practice case. */
export type DataRoomStartRequest = { asOf: string } | { practice: true };

/** POST /api/data-room/documents */
export type AddDocumentRequest = Pick<NewDocument, 'title' | 'sourceType' | 'publishedAt' | 'url' | 'provided' | 'text'>;

/** POST /api/data-room/documents/[id] */
export interface WithdrawDocumentRequest {
  action: 'withdraw';
  reason: string;
}

// ---------------------------------------------------------------------------
// Findings register: what agents propose from the data room and what a person decides.
// Rules in src/shared/findings.ts. "No source, no finding": a claim without a verbatim quote
// from a document the agent was shown is never a finding; it becomes an open question.
// ---------------------------------------------------------------------------

export const FINDING_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCE_LEVELS)[number];

/** draft: proposed by an agent, nobody has acted. accepted and rejected: a person decided, once. */
export const FINDING_STATUSES = ['draft', 'accepted', 'rejected'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Worked out from the document's source type, never chosen by the agent:
 * - attributed: the document is a company disclosure, so the finding is what the seller states, never verified fact.
 * - primary-record: an agency record, a registry entry or a publication.
 */
export const FINDING_BASES = ['attributed', 'primary-record'] as const;
export type FindingBasis = (typeof FINDING_BASES)[number];

/** Why a proposed claim did not become a finding. */
export const PROPOSAL_REFUSAL_CODES = [
  'not_an_object',
  'claim_missing',
  'claim_too_long',
  'document_missing',
  'document_unknown',
  'document_not_shown',
  'document_withdrawn',
  'document_after_as_of',
  'quote_missing',
  'quote_too_short',
  'quote_too_long',
  'quote_not_in_document',
  'confidence_invalid',
  'confidence_reason_missing',
  'assumptions_invalid',
  'too_many',
  'declared_unsupported',
] as const;
export type ProposalRefusalCode = (typeof PROPOSAL_REFUSAL_CODES)[number];

/** A claim that passed every check of src/shared/findings.ts, in the form the register stores. */
export interface CheckedFinding {
  claim: string;
  quote: string;
  documentId: string;
  documentTitle: string;
  sourceType: DocumentSourceType;
  basis: FindingBasis;
  publishedAt: string;
  confidence: FindingConfidence;
  confidenceReason: string;
  assumptions: string[];
}

/** A claim that did not become a finding, and why. */
export interface RefusedClaim {
  claim: string;
  code: ProposalRefusalCode;
  message: string;
  documentId: string | null;
}

/** What a proposal turn hands the register. The agent never sets a status: the register writes drafts only. */
export interface ProposeFindingsInput {
  turnId: string;
  agent: { agentId: AgentId; agentName: string; agentVersion: string; model: string | null; promptHash: string | null };
  /** A human role: the drafting agent's owner. */
  owner: string;
  findings: CheckedFinding[];
  refused: RefusedClaim[];
}

export interface Finding {
  /** F-001, F-002 ...: stable, per workspace, never reused. */
  id: string;
  workspaceId: WorkspaceId;
  claim: string;
  /** Verbatim from the document (up to whitespace, quote marks and dashes). */
  quote: string;
  documentId: string;
  documentTitle: string;
  sourceType: DocumentSourceType;
  basis: FindingBasis;
  /** The document's date, and the data room's as-of date when the finding was proposed. */
  publishedAt: string;
  asOf: string;
  confidence: FindingConfidence;
  confidenceReason: string;
  assumptions: string[];
  /** A human role: the drafting agent's owner. */
  owner: string;
  status: FindingStatus;
  draftedBy: { agentId: AgentId; agentName: string; agentVersion: string; model: string | null; promptHash: string | null; turnId: string };
  createdAt: string;
  decidedAt: string | null;
  /** Who decided. Today the app has no login, so this says so. */
  decidedBy: string | null;
  decisionNote: string | null;
}

/** What a proposal added to the register, and what it repeated. */
export interface ProposeFindingsResult {
  findings: Finding[];
  openQuestions: OpenQuestion[];
  /** Claims whose document and quote were already in the register: not added again. */
  duplicates: Array<{ claim: string; existingId: string }>;
}

/** A claim that did not become a finding, with the reason. Never evidence. */
export interface OpenQuestion {
  /** Q-001, Q-002 ...: stable, per workspace. */
  id: string;
  workspaceId: WorkspaceId;
  claim: string;
  reasonCode: ProposalRefusalCode;
  reason: string;
  documentId: string | null;
  raisedBy: { agentId: AgentId; agentName: string; turnId: string };
  createdAt: string;
}

export type FindingEventKind = 'proposed' | 'accepted' | 'rejected';

/** The append-only audit trail of the register. */
export interface FindingEvent {
  id: number;
  findingId: string;
  kind: FindingEventKind;
  at: string;
  by: string;
  note: string | null;
}

/** What the person who decides is recorded as, while the app has no login. */
export const LOCAL_PERSON = 'person (local, not authenticated)';

/** GET /api/findings */
export interface FindingsResponse {
  workspaceId: WorkspaceId;
  findings: Finding[];
  openQuestions: OpenQuestion[];
  /** The tags of accepted findings; a finding with no entry here is untagged. */
  tags: FindingTag[];
}

/** POST /api/findings/[id]: the decision of a person. Anything else is refused. */
export interface FindingDecisionRequest {
  decision: 'accept' | 'reject';
  note?: string;
  /** Required to accept: which checklist item the finding supports, and whether it is a positive, a risk or neutral. */
  checklistItem?: ChecklistItemId;
  category?: FindingCategory;
}

/** The finding as it is saved after the decision, and its tag (null for a rejection). */
export interface FindingDecisionResponse {
  finding: Finding;
  tag: FindingTag | null;
}

// ---------------------------------------------------------------------------
// Checklist: the regulatory checklist of the DD playbook, and the tags that tie accepted findings to it.
// Rules in src/shared/checklist.ts. Every state is set by a person; "checked" needs an accepted finding behind it.
// ---------------------------------------------------------------------------

/** The regulatory checklist (CLAUDE.md, "Regulatory checklist"). Labels and hints are in src/shared/checklist.ts. */
export const CHECKLIST_ITEM_IDS = ['guidance', 'designations', 'regions', 'bottlenecks', 'ptrs-inputs', 'hta-handover'] as const;
export type ChecklistItemId = (typeof CHECKLIST_ITEM_IDS)[number];

/**
 * The four states, kept apart on purpose:
 * - not_checked: nobody has looked, or somebody took the mark back. The default.
 * - checked: looked at, with at least one accepted finding behind it.
 * - not_applicable: looked at and does not apply here, with a reason ("checked: not applicable").
 * - could_not_check: tried and could not, with a reason (for example a document was not provided).
 */
export const CHECKLIST_STATES = ['not_checked', 'checked', 'not_applicable', 'could_not_check'] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

export const FINDING_CATEGORIES = ['positive', 'risk', 'neutral'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface FindingTagInput {
  checklistItem: ChecklistItemId;
  category: FindingCategory;
}

/** What a person said an accepted finding is about. Never changed once set. */
export interface FindingTag extends FindingTagInput {
  findingId: string;
  taggedAt: string;
  /** LOCAL_PERSON while the app has no login. */
  taggedBy: string;
}

export interface ChecklistEntry {
  item: ChecklistItemId;
  state: ChecklistState;
  /** Required for not_applicable and could_not_check. */
  reason: string | null;
  /** Null for an item nobody has touched. */
  changedAt: string | null;
  changedBy: string | null;
}

export interface ChecklistEvent {
  id: number;
  item: ChecklistItemId;
  state: ChecklistState;
  reason: string | null;
  at: string;
  by: string;
}

/** GET /api/checklist: each item with how many accepted findings are tagged to it. */
export interface ChecklistResponse {
  workspaceId: WorkspaceId;
  items: Array<ChecklistEntry & { acceptedFindings: number }>;
}

/** POST /api/checklist/[item]: a person moves one item to a state. */
export interface ChecklistStateRequest {
  state: ChecklistState;
  reason?: string;
}

/** POST /api/findings/[id]/tags: a person tags a finding they accepted without one. */
export type FindingTagRequest = FindingTagInput;

export interface FindingTagResponse {
  tag: FindingTag;
}

// ---------------------------------------------------------------------------
// Briefing: what the regulatory lead takes into the cross-functional discussion. Built by code from the register, the
// tags and the checklist (src/shared/briefing.ts); no model writes it, and it contains none of the decisions reserved
// for people. Only accepted findings that a person tagged are sorted into it.
// ---------------------------------------------------------------------------

/** An accepted finding as the briefing shows it. */
export interface BriefingFinding {
  id: string;
  /** Drafted by an agent; a person accepted it. */
  claim: string;
  /** Word for word from the document. */
  quote: string;
  documentId: string;
  documentTitle: string;
  sourceType: DocumentSourceType;
  basis: FindingBasis;
  publishedAt: string;
  confidence: FindingConfidence;
  /** Null while nobody has said which item it supports. */
  checklistItem: ChecklistItemId | null;
  category: FindingCategory | null;
  /** The document was withdrawn from the data room after the finding was accepted. */
  documentWithdrawn: boolean;
  decisionNote: string | null;
}

export const BRIEFING_WARNING_CODES = [
  'no_data_room',
  'drafts_pending',
  'untagged_accepted',
  'withdrawn_document',
  'checked_on_withdrawn',
  'items_not_checked',
  'items_could_not_check',
  'gate_outdated',
] as const;
export type BriefingWarningCode = (typeof BRIEFING_WARNING_CODES)[number];

export interface BriefingWarning {
  code: BriefingWarningCode;
  message: string;
}

export interface BriefingChecklistRow {
  item: ChecklistItemId;
  label: string;
  hint: string;
  state: ChecklistState;
  reason: string | null;
  /** Ids of the accepted findings tagged to this item, in id order. */
  findingIds: string[];
}

/** One gate in the briefing: whether a person decided it, the latest decision, and the dissents recorded under that decision. */
export interface BriefingGate {
  gate: GateId;
  title: string;
  status: GateStatus;
  latest: { id: string; option: GateOption; recommended: GateOption; reason: string | null; actor: string; createdAt: string } | null;
  dissents: Array<{ role: string; reason: string }>;
}

export interface Briefing {
  /** The data room's as-of date; null when there is no data room. */
  asOf: string | null;
  /** The documents in the data room, as listed. */
  documents: Array<{ id: string; title: string; sourceType: DocumentSourceType; publishedAt: string | null; provided: boolean; withdrawn: boolean }>;
  counts: { acceptedTagged: number; acceptedUntagged: number; drafts: number; rejected: number; openQuestions: number };
  warnings: BriefingWarning[];
  checklist: BriefingChecklistRow[];
  positives: BriefingFinding[];
  risks: BriefingFinding[];
  neutral: BriefingFinding[];
  /** Accepted findings with no tag: listed apart so nothing accepted goes missing. */
  unsorted: BriefingFinding[];
  /** The accepted findings tagged to the PTRS item. The app computes no number. */
  ptrsInputs: BriefingFinding[];
  openQuestions: Array<{ id: string; claim: string; reason: string; documentId: string | null }>;
  /** The checklist items a person marked "could not check", with the reason. */
  couldNotCheck: Array<{ item: ChecklistItemId; label: string; reason: string }>;
  /** The three gates and what people decided at them; empty when the caller gave no gates. */
  gateDecisions: BriefingGate[];
}

/** GET /api/briefing */
export interface BriefingResponse {
  workspaceId: WorkspaceId;
  generatedAt: string;
  briefing: Briefing;
}


// ---------------------------------------------------------------------------
// Gates: three points of the due diligence where a person decides, on facts built by code.
// ---------------------------------------------------------------------------

/** 1 scope: start on this setup and these documents. 2 evidence: the evidence is enough. 3 release: hand the briefing to the cross-functional discussion. */
export const GATE_IDS = ['scope', 'evidence', 'release'] as const;
export type GateId = (typeof GATE_IDS)[number];

/** The four choices at every gate. */
export const GATE_OPTIONS = ['proceed', 'pause', 'seek_more', 'stop'] as const;
export type GateOption = (typeof GATE_OPTIONS)[number];

/** The team size the gates show: the store does not know the roster, so the API passes it in. */
export interface GateTeam {
  selected: number;
  total: number;
}

/** One line of what the code found, for the person deciding. */
export interface GateFact {
  label: string;
  text: string;
}

/** A decision a person recorded. Append-only; the facts and the recommended call are kept as they were shown. */
export interface GateDecision {
  id: string;
  workspaceId: WorkspaceId;
  gate: GateId;
  option: GateOption;
  /** Required when `option` differs from `recommended`. */
  reason: string | null;
  /** What the code recommended when the person decided. */
  recommended: GateOption;
  /** The facts in front of the person. */
  facts: GateFact[];
  /** Changes whenever the facts or the recommended call change. */
  factsHash: string;
  /** Who decided: LOCAL_PERSON until there is a login. */
  actor: string;
  createdAt: string;
}

/** A disagreement with a decision, recorded under it. It never blocks the decision. */
export interface GateDissent {
  id: string;
  decisionId: string;
  workspaceId: WorkspaceId;
  gate: GateId;
  /** The function the dissent speaks for, for example "CMC regulatory agent owner". */
  role: string;
  reason: string;
  actor: string;
  createdAt: string;
}

/**
 * not_decided: no decision yet. decided: the latest decision was taken on the facts as they are now.
 * outdated: the facts or the recommended call changed since the latest decision.
 */
export type GateStatus = 'not_decided' | 'decided' | 'outdated';

export interface GateView {
  id: GateId;
  title: string;
  question: string;
  facts: GateFact[];
  recommended: GateOption;
  recommendedBecause: string;
  /** What would move the recommended call, from the same facts. */
  wouldChange: string[];
  options: Array<{ option: GateOption; label: string; cost: string }>;
  /** What the person sees now; a decision must carry it. */
  factsHash: string;
  status: GateStatus;
  /** Every decision, newest first, each with its dissents. */
  decisions: Array<GateDecision & { dissents: GateDissent[] }>;
}

/** GET /api/gates */
export interface GatesResponse {
  workspaceId: WorkspaceId;
  generatedAt: string;
  gates: GateView[];
  /** The decisions only a person makes. */
  alwaysHuman: string[];
  disagreementRule: string;
}

/** POST /api/gates/[gate]/decision */
export interface GateDecisionRequest {
  option: GateOption;
  reason?: string;
  /** The factsHash of the gate as the person saw it. */
  factsHash: string;
}

/** POST /api/gates/[gate]/dissent */
export interface GateDissentRequest {
  decisionId: string;
  role: string;
  reason: string;
}
