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

export const AGENT_TRIGGERS = [...CLASSIFICATION_IDS, 'late'] as const;
/**
 * What brings an agent into a DD: an asset classification, or `late` (the development
 * stage is Phase 3 or Filed). Shown on the profile; in this phase selection stays manual.
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
 * - interrupted: the server restarted while it ran (set by reconcileStaleTurns).
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

/** Error codes in chat messages, turns and SSE `error` events. */
export type ChatErrorCode = `llm_${LlmErrorKind}` | 'out_of_time' | 'internal';

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
}

export interface StartTurnInput {
  workspaceId: WorkspaceId;
  roomId: RoomId;
  clientTurnId: string;
  bootId: string;
  deadlineAt: string;
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
  /** On boot: running turns from another bootId become interrupted. Returns how many changed. */
  reconcileStaleTurns(bootId: string): number;
  /** The saved selection, or null if this workspace never saved one (use the defaults). */
  getSelection(workspaceId: WorkspaceId): AgentId[] | null;
  setSelection(workspaceId: WorkspaceId, agentIds: AgentId[]): void;
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
  'locked_agent',
  'llm_not_configured',
  'internal',
] as const;
/** HTTP status: invalid_request 400, forbidden 403, not_found 404, room_busy 409, locked_agent 409, llm_not_configured 503, internal 500. */
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
