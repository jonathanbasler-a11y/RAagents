import 'server-only';
import { randomUUID } from 'node:crypto';
import { LlmError } from '@/server/llm';
import { buildAgentPrompt, type UntrustedBlock } from '@/server/prompts';
import type {
  AgentId,
  AgentOutcome,
  AgentSpec,
  AgentTurnState,
  AppendAgentMessageInput,
  ChatErrorCode,
  ChatEvent,
  ContributionRole,
  LlmClient,
  LlmMessage,
  LlmResult,
  MessageStatus,
} from '@/shared/contracts';

// runAgent: the ONE execution path into an agent (BUILD-LEARNINGS rule 8). 1:1 rooms, the
// team chat and the evals all call it, so every agent call gets the same rules, brief,
// date line, fencing, history validation and error handling.

/** The agent is unknown or inactive. Thrown before any event or model call. */
export class AgentUnavailableError extends Error {
  readonly agentId: AgentId;

  constructor(agentId: AgentId) {
    super(`agent "${agentId}" is not an active agent`);
    this.name = 'AgentUnavailableError';
    this.agentId = agentId;
  }
}

export interface RunAgentDeps {
  /** The registry lookup: undefined for unknown and inactive agents. */
  getAgent: (id: AgentId) => AgentSpec | undefined;
  /** The agents route client. */
  llm: LlmClient;
  /** The turn's clock (date line and duration). */
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, 'error' | 'warn'>;
}

export interface RunAgentContext {
  room: 'one-to-one' | 'team';
  role: ContributionRole;
  /** Validated history ending with the question (see toPromptHistory). */
  history: readonly LlmMessage[];
  /** Valid messages left out of history ("earlier messages not included"). */
  omitted?: number;
  /** Text not written by the person asking; fenced in the prompt. */
  roomContext?: readonly UntrustedBlock[];
  /** Extra code-written lines for this turn. */
  instructions?: readonly string[];
  lengthWords?: number;
  /** The browser's IANA time zone, already checked. */
  timeZone: string;
  /** The turn deadline. Never the browser's request.signal. */
  signal: AbortSignal;
  /** The id the reply is saved under; agent_start announces it. */
  messageId?: string;
  /** Streams agent_start, delta, error and agent_end. Leave out to run silently. */
  emit?: (event: ChatEvent) => void;
  maxTokens?: number;
}

export interface RunAgentResult {
  messageId: string;
  agentId: AgentId;
  /** Snapshots for the saved message. */
  agentName: string;
  agentVersion: string;
  role: ContributionRole;
  /** Everything received, also when the reply broke off. */
  text: string;
  status: MessageStatus;
  truncated: boolean;
  /** As the gateway reported it; null when no reply arrived. */
  model: string | null;
  promptHash: string;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
  state: Extract<AgentTurnState, 'answered' | 'failed' | 'out_of_time'>;
  durationMs: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** What the trace records for one agent's run ("How this turn ran"). */
export function toAgentOutcome(result: RunAgentResult): AgentOutcome {
  return {
    agentId: result.agentId,
    agentName: result.agentName,
    role: result.role,
    state: result.state,
    messageId: result.messageId,
    ...(result.model === null ? {} : { model: result.model }),
    durationMs: result.durationMs,
    truncated: result.truncated,
    ...(result.errorCode === null ? {} : { errorCode: result.errorCode }),
  };
}

/** The saved form of a reply: everything received, also when it broke off or failed. */
export function toReplyMessage(turnId: string, result: RunAgentResult): AppendAgentMessageInput {
  return {
    id: result.messageId,
    turnId,
    agentId: result.agentId,
    agentName: result.agentName,
    agentVersion: result.agentVersion,
    promptHash: result.promptHash,
    model: result.model,
    text: result.text,
    status: result.status,
    truncated: result.truncated,
    errorCode: result.errorCode,
    correlationId: result.correlationId,
  };
}

/**
 * Runs one agent on one question: builds the prompt (shared rules, persona brief, date and
 * time zone, fenced room context, validated history), streams the reply from the model
 * and reports it through `emit`. Model failures never throw: they come back as a result
 * with status error or partial, an error code and a correlation id, and any text received
 * is kept. Throws AgentUnavailableError for an unknown or inactive agent, and a TypeError
 * for invalid history, before any event or model call.
 */
export async function runAgent(agentId: AgentId, context: RunAgentContext, deps: RunAgentDeps): Promise<RunAgentResult> {
  const agent = deps.getAgent(agentId);
  if (agent === undefined || !agent.active) throw new AgentUnavailableError(agentId);

  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? console;
  const startedAt = now();

  const teammates = agent.handoffs
    .map((id) => deps.getAgent(id))
    .filter((mate): mate is AgentSpec => mate !== undefined && mate.active && mate.id !== agent.id);
  const prompt = buildAgentPrompt({
    agent,
    teammates,
    room: context.room,
    role: context.role,
    now: startedAt,
    timeZone: context.timeZone,
    history: context.history,
    omitted: context.omitted,
    roomContext: context.roomContext,
    instructions: context.instructions,
    lengthWords: context.lengthWords,
  });

  const messageId = context.messageId ?? newId();
  const emit = (event: ChatEvent) => {
    if (!context.emit) return;
    try {
      context.emit(event);
    } catch (error) {
      log.error(`[run-agent] the event emitter failed for ${agent.id}: ${describeError(error)}`);
    }
  };
  emit({ type: 'agent_start', agentId: agent.id, messageId, role: context.role });

  let text = '';
  let status: MessageStatus = 'complete';
  let truncated = false;
  let model: string | null = null;
  let errorCode: ChatErrorCode | null = null;
  let correlationId: string | null = null;

  try {
    let end: LlmResult | undefined;
    for await (const event of deps.llm.stream({ messages: prompt.messages, signal: context.signal, maxTokens: context.maxTokens })) {
      if (event.type === 'delta') {
        text += event.text;
        emit({ type: 'delta', messageId, text: event.text });
      } else {
        end = event.result;
      }
    }
    if (end === undefined) throw new Error('the model stream ended without its end event');
    model = end.model;
    truncated = end.truncated;
    if (end.partial) {
      status = 'partial';
      errorCode = context.signal.aborted ? 'out_of_time' : `llm_${end.errorKind ?? 'network'}`;
      // The client logged why the reply broke off under this id; the browser shows the same id.
      correlationId = end.correlationId ?? newId();
      log.warn(`[run-agent] ${agent.id} reply broke off after ${text.length} characters (correlation ${correlationId}): ${errorCode}`);
    }
  } catch (error) {
    status = text === '' ? 'error' : 'partial';
    if (error instanceof LlmError) {
      // The client logged the details under this id; the browser shows the same id.
      errorCode = context.signal.aborted ? 'out_of_time' : `llm_${error.kind}`;
      correlationId = error.correlationId;
    } else {
      errorCode = context.signal.aborted ? 'out_of_time' : 'internal';
      correlationId = newId();
      log.error(`[run-agent] ${agent.id} failed (correlation ${correlationId}): ${describeError(error)}`);
    }
  }

  if (errorCode !== null && correlationId !== null) emit({ type: 'error', code: errorCode, correlationId, messageId });
  emit({ type: 'agent_end', messageId, status, truncated });

  const state: RunAgentResult['state'] = errorCode === 'out_of_time' ? 'out_of_time' : errorCode === null ? 'answered' : 'failed';
  return {
    messageId,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: agent.version,
    role: context.role,
    text,
    status,
    truncated,
    model,
    promptHash: prompt.promptHash,
    errorCode,
    correlationId,
    state,
    durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
  };
}
