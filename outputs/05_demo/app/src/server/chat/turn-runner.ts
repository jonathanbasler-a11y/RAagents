import 'server-only';
import type {
  AgentId,
  ChatErrorCode,
  ChatEvent,
  ChatLimits,
  Message,
  MessageStatus,
  RoomId,
  StartTurnResult,
  Store,
  TerminalTurnStatus,
  Thread,
  Turn,
  TurnTrace,
  FinishTurnInput,
} from '@/shared/contracts';
import { createTurnChannel, type TurnChannel } from './events';
import { registerRunningTurn, type ShutdownSignal } from './shutdown';
import { RoomBusyError, ServerBusyError } from './store';

// The durable turn (BUILD-LEARNINGS Part 8, durable runs): the question is saved, the turn
// runs DETACHED from the HTTP response with a top-level catch, emits into an in-memory
// channel that the SSE response subscribes to, and always reaches a terminal status. A
// browser that disconnects only stops listening; the turn finishes and saves its result.
// The turn's deadline is its own signal: the browser's request.signal never reaches it.

export const TURN_DEADLINE_MS: ChatLimits['turnDeadlineMs'] = 180_000;
/** After the deadline aborts the turn signal, how long the room's executor gets to wrap up before the runner ends the turn itself. */
export const DEADLINE_GRACE_MS = 10_000;
/** The most turns that run at once on this server, across all rooms. A third is refused (429 server_busy) before anything is written. */
export const MAX_RUNNING_TURNS = 2;
/**
 * Extra time, beyond the runner's own grace, before a turn that is still marked running counts as
 * stuck. The runner ends its own overdue turn at deadline plus grace; this keeps the stale-turn
 * check from taking that turn out from under it.
 */
export const STALE_TURN_MARGIN_MS = 5_000;
/** How often, and how many times, a terminal save that the store refused is retried in the background. */
export const TERMINAL_SAVE_RETRY_MS = 2_000;
export const TERMINAL_SAVE_RETRIES = 10;

/** What a room's executor gets for one turn. */
export interface TurnRun {
  turn: Turn;
  thread: Thread;
  /** The saved question. */
  userMessage: Message;
  /** The question as saved (trimmed). */
  question: string;
  /** The browser's IANA time zone, already checked. */
  timeZone: string;
  /** Aborts at the turn deadline. Pass it to every model call. */
  signal: AbortSignal;
  /** Into the turn's channel: never throws, and works with nobody listening. */
  emit: (event: ChatEvent) => void;
}

/** How a room's turn ended. The runner saves it with finishTurn. */
export interface TurnOutcome {
  status: Exclude<TerminalTurnStatus, 'interrupted'>;
  /** Null keeps the trace saved while the turn ran. */
  trace: TurnTrace | null;
  errorCode?: ChatErrorCode | null;
  correlationId?: string | null;
}

/** Runs one room's turn: a 1:1 room (one-to-one.ts) or the team chat (team.ts). Saves its own messages. */
export type RoomExecutor = (run: TurnRun) => Promise<TurnOutcome>;

export interface TurnRunnerDeps {
  store: Store;
  bootId: string;
  workspaceId: string;
  now: () => Date;
  newId: () => string;
  log: Pick<Console, 'error' | 'warn'>;
  /** Default TURN_DEADLINE_MS. */
  turnDeadlineMs?: number;
  /** Default DEADLINE_GRACE_MS. */
  deadlineGraceMs?: number;
  /** Default MAX_RUNNING_TURNS. */
  maxRunningTurns?: number;
  /**
   * The agent's name and version, for the reply that a shutdown cuts off (the saved message names
   * its author). Without it, or for an agent the roster no longer has, the id and "unknown" are saved.
   */
  getAgent?: (agentId: AgentId) => { name: string; version: string } | undefined;
  /** Default TERMINAL_SAVE_RETRY_MS. */
  finishRetryMs?: number;
}

export interface StartTurnInput {
  roomId: RoomId;
  /** Browser-generated; a repeat is answered with the existing turn. */
  clientTurnId: string;
  /** The question, trimmed and checked. */
  text: string;
  timeZone: string;
}

export type StartTurnOutcome =
  /** The turn runs; `finished` settles (never rejects) once its terminal status is saved and `done` is out. */
  | { kind: 'started'; turn: Turn; thread: Thread; userMessage: Message; channel: TurnChannel; finished: Promise<Turn> }
  /** This clientTurnId was seen before in this room: nothing new runs. */
  | { kind: 'duplicate'; turn: Turn }
  /** Another turn holds the room. */
  | { kind: 'busy'; runningTurnId: string }
  /** The server already runs as many turns as it may at once; nothing was written. */
  | { kind: 'server_busy'; running: number; limit: number }
  /** This clientTurnId was already used in another room. */
  | { kind: 'other_room'; turn: Turn };

const GAVE_UP = Symbol('gave up');

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Resolves with the work, or with GAVE_UP once `graceMs` have passed since the signal aborted. */
function raceWithDeadline<T>(work: Promise<T>, signal: AbortSignal, graceMs: number): Promise<T | typeof GAVE_UP> {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const gaveUp = new Promise<typeof GAVE_UP>((resolve) => {
    onAbort = () => {
      graceTimer = setTimeout(() => resolve(GAVE_UP), graceMs);
      graceTimer.unref?.();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([work, gaveUp]).finally(() => {
    clearTimeout(graceTimer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Starts the executor at once; a synchronous throw becomes a rejection. */
function callExecutor(executor: RoomExecutor, run: TurnRun): Promise<TurnOutcome> {
  try {
    return executor(run);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * A turn that never reaches a terminal status holds its room, and the browser polls it, until
 * the server restarts. So the end of a turn is saved with every means at hand, in turn: the
 * outcome as it is, once more, then without its trace (the likeliest cause that depends on the
 * data; the trace saved while the turn ran stays). If the store still refuses, the save is
 * retried in the background a bounded number of times. finishTurn leaves a finished turn alone,
 * so a late retry never overwrites an `interrupted` set by reconcileStaleTurns.
 */
function finishSafely(store: Store, input: FinishTurnInput, log: TurnRunnerDeps['log'], retryMs: number): Turn | null {
  const withoutTrace: FinishTurnInput = { ...input, trace: null };
  let lastError: unknown;
  for (const attempt of [input, input, withoutTrace]) {
    try {
      return store.finishTurn(attempt);
    } catch (error) {
      lastError = error;
      log.error(`[turn] could not save the end of turn ${input.turnId}: ${describeError(error)}`);
    }
  }
  keepTryingToFinish(store, withoutTrace, log, retryMs, lastError);
  try {
    return store.getTurn(input.turnId);
  } catch {
    return null;
  }
}

function keepTryingToFinish(store: Store, input: FinishTurnInput, log: TurnRunnerDeps['log'], retryMs: number, firstError: unknown): void {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    try {
      store.finishTurn(input);
      clearInterval(timer);
      log.warn(`[turn] saved the end of turn ${input.turnId} on background try ${tries}`);
    } catch (error) {
      if (tries < TERMINAL_SAVE_RETRIES) return;
      clearInterval(timer);
      log.error(
        `[turn] gave up saving the end of turn ${input.turnId} after ${tries} background tries; it holds its room until the server restarts: ${describeError(error)} (first error: ${describeError(firstError)})`,
      );
    }
  }, retryMs);
  timer.unref?.();
}

/**
 * Ends the turns that are still marked running although their deadline and the runner's grace
 * have long passed (their runner is stuck or gone), so they stop holding their room and a slot.
 * Called when a turn starts and when messages are listed. Never throws: a failed check is
 * logged, and the caller's own store call then fails or succeeds on its own. Returns how many
 * turns it ended.
 */
export function reconcileOverdueTurns(deps: Pick<TurnRunnerDeps, 'store' | 'bootId' | 'log' | 'deadlineGraceMs'>): number {
  const graceMs = (deps.deadlineGraceMs ?? DEADLINE_GRACE_MS) + STALE_TURN_MARGIN_MS;
  try {
    const changed = deps.store.reconcileStaleTurns(deps.bootId, { graceMs });
    if (changed > 0) {
      deps.log.warn(`[turn] ${changed} turn(s) were still running long after their deadline; marked interrupted so their rooms are free`);
    }
    return changed;
  } catch (error) {
    deps.log.error(`[turn] could not check for turns past their deadline: ${describeError(error)}`);
    return 0;
  }
}

/** One reply as the turn's events show it, kept so a shutdown can save what had arrived. */
interface TrackedReply {
  messageId: string;
  agentId: AgentId;
  text: string;
  ended: { status: MessageStatus; truncated: boolean } | null;
  failure: { code: ChatErrorCode; correlationId: string } | null;
}

/** Follows a turn's events and keeps, per reply, the text streamed so far. Replies that held back their text (the team's secondaries) show only their start. */
function createReplyTracker() {
  const replies = new Map<string, TrackedReply>();
  return {
    observe(event: ChatEvent): void {
      switch (event.type) {
        case 'agent_start':
          if (!replies.has(event.messageId)) {
            replies.set(event.messageId, { messageId: event.messageId, agentId: event.agentId, text: '', ended: null, failure: null });
          }
          break;
        case 'delta': {
          const reply = replies.get(event.messageId);
          if (reply) reply.text += event.text;
          break;
        }
        case 'agent_end': {
          const reply = replies.get(event.messageId);
          if (reply) reply.ended = { status: event.status, truncated: event.truncated };
          break;
        }
        case 'error': {
          const reply = event.messageId === undefined ? undefined : replies.get(event.messageId);
          if (reply) reply.failure = { code: event.code, correlationId: event.correlationId };
          break;
        }
        case 'no_addition':
          // Nothing to keep: the executor writes a note for it, or nothing.
          if (event.messageId !== undefined) replies.delete(event.messageId);
          break;
        default:
          break;
      }
    },
    /** In the order the replies started. */
    replies: (): TrackedReply[] => [...replies.values()],
  };
}

/**
 * Starts a turn and runs it detached. Synchronous up to the start: the turn row and the
 * question are saved and the `turn` event is in the channel before this returns, so the
 * caller can answer the HTTP request at once. Idempotent by clientTurnId. Turns past their
 * deadline are reconciled first, so a stuck one frees its room and its slot; then a repeat is
 * answered, a busy room refused (409), and at the cap on running turns the new one is refused
 * (429) before anything is written. Throws only when the store itself fails before the turn
 * could start.
 */
export function startTurn(input: StartTurnInput, executor: RoomExecutor, deps: TurnRunnerDeps): StartTurnOutcome {
  const { store, log } = deps;
  const deadlineMs = deps.turnDeadlineMs ?? TURN_DEADLINE_MS;
  const graceMs = deps.deadlineGraceMs ?? DEADLINE_GRACE_MS;
  const finishRetryMs = deps.finishRetryMs ?? TERMINAL_SAVE_RETRY_MS;

  reconcileOverdueTurns(deps);

  let started: StartTurnResult;
  try {
    started = store.startTurn({
      workspaceId: deps.workspaceId,
      roomId: input.roomId,
      clientTurnId: input.clientTurnId,
      bootId: deps.bootId,
      deadlineAt: new Date(deps.now().getTime() + deadlineMs).toISOString(),
      maxRunningTurns: deps.maxRunningTurns ?? MAX_RUNNING_TURNS,
    });
  } catch (error) {
    if (error instanceof RoomBusyError) return { kind: 'busy', runningTurnId: error.runningTurnId };
    if (error instanceof ServerBusyError) return { kind: 'server_busy', running: error.running, limit: error.limit };
    throw error;
  }
  if (!started.created) {
    return started.turn.roomId === input.roomId ? { kind: 'duplicate', turn: started.turn } : { kind: 'other_room', turn: started.turn };
  }
  const { turn, thread } = started;

  let userMessage: Message;
  try {
    userMessage = store.appendUserMessage({ turnId: turn.id, text: input.text }).message;
  } catch (error) {
    // A running turn without its question would hold the room until a restart.
    const correlationId = deps.newId();
    log.error(`[turn] could not save the question of turn ${turn.id} (correlation ${correlationId}): ${describeError(error)}`);
    finishSafely(store, { turnId: turn.id, status: 'error', trace: null, errorCode: 'internal', correlationId }, log, finishRetryMs);
    throw error;
  }

  const channel = createTurnChannel({
    onListenerError: (error) => log.error(`[turn] a listener of turn ${turn.id} failed: ${describeError(error)}`),
  });
  channel.emit({
    type: 'turn',
    turnId: turn.id,
    threadId: thread.id,
    roomId: turn.roomId,
    clientTurnId: turn.clientTurnId,
    userMessageId: userMessage.id,
    startedAt: turn.startedAt,
  });

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('the turn deadline passed', 'TimeoutError')), deadlineMs);
  timer.unref?.();

  const replies = createReplyTracker();
  const run: TurnRun = {
    turn,
    thread,
    userMessage,
    question: input.text,
    timeZone: input.timeZone,
    signal: deadline.signal,
    emit: (event) => {
      replies.observe(event);
      channel.emit(event);
    },
  };

  const hasSavedReply = () =>
    store.listMessages(thread.id).some((message) => message.turnId === turn.id && message.author === 'agent' && message.text.trim() !== '');

  // The server is stopping: save the replies the stream had delivered, end the turn as
  // interrupted, and end the stream, so a connection that waits for this turn lets go.
  const interruptForShutdown = (signal: ShutdownSignal): void => {
    const correlationId = deps.newId();
    log.warn(`[turn] turn ${turn.id} is being interrupted: the server got ${signal} (correlation ${correlationId})`);
    const savedIds = new Set(store.listMessages(thread.id).map((message) => message.id));
    const cutOff: TrackedReply[] = [];
    for (const reply of replies.replies()) {
      if (savedIds.has(reply.messageId)) continue;
      const agent = deps.getAgent?.(reply.agentId);
      const finishedReply = reply.ended !== null;
      try {
        store.appendAgentMessage({
          id: reply.messageId,
          turnId: turn.id,
          agentId: reply.agentId,
          agentName: agent?.name ?? reply.agentId,
          agentVersion: agent?.version ?? 'unknown',
          promptHash: null,
          model: null,
          text: reply.text,
          status: reply.ended?.status ?? (reply.text === '' ? 'error' : 'partial'),
          truncated: reply.ended?.truncated ?? false,
          errorCode: finishedReply ? (reply.failure?.code ?? null) : 'server_shutdown',
          correlationId: finishedReply ? (reply.failure?.correlationId ?? null) : correlationId,
        });
        if (!finishedReply) cutOff.push(reply);
      } catch (error) {
        log.error(`[turn] could not save the reply ${reply.messageId} of turn ${turn.id} on ${signal} (correlation ${correlationId}): ${describeError(error)}`);
      }
    }
    const interrupted = store.interruptTurn({ turnId: turn.id, errorCode: 'server_shutdown', correlationId });
    if (interrupted.status !== 'interrupted') {
      log.warn(`[turn] turn ${turn.id} was already ${interrupted.status} when the server got ${signal}; left as it is`);
      return;
    }
    for (const reply of cutOff) {
      channel.emit({ type: 'error', code: 'server_shutdown', correlationId, messageId: reply.messageId });
      channel.emit({ type: 'agent_end', messageId: reply.messageId, status: reply.text === '' ? 'error' : 'partial', truncated: false });
    }
    channel.emit({ type: 'done', turnId: turn.id, status: 'interrupted' });
    channel.close();
    unregister();
  };
  const unregister = registerRunningTurn({ turnId: turn.id, interrupt: interruptForShutdown });

  const finished = (async (): Promise<Turn> => {
    let finishedTurn: Turn | null = null;
    try {
      let outcome: TurnOutcome;
      try {
        const result = await raceWithDeadline(callExecutor(executor, run), deadline.signal, graceMs);
        if (result === GAVE_UP) {
          const correlationId = deps.newId();
          log.error(`[turn] turn ${turn.id} was still running ${graceMs} ms after its deadline (correlation ${correlationId}); ending it as out of time`);
          outcome = { status: hasSavedReply() ? 'partial' : 'error', trace: null, errorCode: 'out_of_time', correlationId };
          channel.emit({ type: 'error', code: 'out_of_time', correlationId });
        } else {
          outcome = result;
        }
      } catch (error) {
        const correlationId = deps.newId();
        const code: ChatErrorCode = deadline.signal.aborted ? 'out_of_time' : 'internal';
        log.error(`[turn] turn ${turn.id} failed (correlation ${correlationId}): ${describeError(error)}`);
        outcome = { status: 'error', trace: null, errorCode: code, correlationId };
        channel.emit({ type: 'error', code, correlationId });
      }
      finishedTurn = finishSafely(
        store,
        {
          turnId: turn.id,
          status: outcome.status,
          trace: outcome.trace,
          errorCode: outcome.errorCode ?? null,
          correlationId: outcome.correlationId ?? null,
        },
        log,
        finishRetryMs,
      );
    } catch (error) {
      log.error(`[turn] turn ${turn.id} could not be finished: ${describeError(error)}`);
    } finally {
      clearTimeout(timer);
      unregister();
      // Every stream ends with done, carrying the status the store kept.
      const status: TerminalTurnStatus = finishedTurn === null || finishedTurn.status === 'running' ? 'error' : finishedTurn.status;
      channel.emit({ type: 'done', turnId: turn.id, status });
      channel.close();
    }
    return finishedTurn ?? turn;
  })();

  return { kind: 'started', turn, thread, userMessage, channel, finished };
}
