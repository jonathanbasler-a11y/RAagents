import 'server-only';
import type {
  ChatErrorCode,
  ChatEvent,
  ChatLimits,
  Message,
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
import { RoomBusyError } from './store';

// The durable turn (BUILD-LEARNINGS Part 8, durable runs): the question is saved, the turn
// runs DETACHED from the HTTP response with a top-level catch, emits into an in-memory
// channel that the SSE response subscribes to, and always reaches a terminal status. A
// browser that disconnects only stops listening; the turn finishes and saves its result.
// The turn's deadline is its own signal: the browser's request.signal never reaches it.

export const TURN_DEADLINE_MS: ChatLimits['turnDeadlineMs'] = 180_000;
/** After the deadline aborts the turn signal, how long the room's executor gets to wrap up before the runner ends the turn itself. */
export const DEADLINE_GRACE_MS = 10_000;

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

function finishSafely(store: Store, input: FinishTurnInput, log: TurnRunnerDeps['log']): Turn | null {
  try {
    return store.finishTurn(input);
  } catch (error) {
    log.error(`[turn] could not save the end of turn ${input.turnId}; it holds its room until the server restarts: ${describeError(error)}`);
    try {
      return store.getTurn(input.turnId);
    } catch {
      return null;
    }
  }
}

/**
 * Starts a turn and runs it detached. Synchronous up to the start: the turn row and the
 * question are saved and the `turn` event is in the channel before this returns, so the
 * caller can answer the HTTP request at once. Idempotent by clientTurnId. Throws only
 * when the store itself fails before the turn could start.
 */
export function startTurn(input: StartTurnInput, executor: RoomExecutor, deps: TurnRunnerDeps): StartTurnOutcome {
  const { store, log } = deps;
  const deadlineMs = deps.turnDeadlineMs ?? TURN_DEADLINE_MS;
  const graceMs = deps.deadlineGraceMs ?? DEADLINE_GRACE_MS;

  let started: StartTurnResult;
  try {
    started = store.startTurn({
      workspaceId: deps.workspaceId,
      roomId: input.roomId,
      clientTurnId: input.clientTurnId,
      bootId: deps.bootId,
      deadlineAt: new Date(deps.now().getTime() + deadlineMs).toISOString(),
    });
  } catch (error) {
    if (error instanceof RoomBusyError) return { kind: 'busy', runningTurnId: error.runningTurnId };
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
    finishSafely(store, { turnId: turn.id, status: 'error', trace: null, errorCode: 'internal', correlationId }, log);
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

  const run: TurnRun = {
    turn,
    thread,
    userMessage,
    question: input.text,
    timeZone: input.timeZone,
    signal: deadline.signal,
    emit: (event) => channel.emit(event),
  };

  const hasSavedReply = () =>
    store.listMessages(thread.id).some((message) => message.turnId === turn.id && message.author === 'agent' && message.text.trim() !== '');

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
      );
    } catch (error) {
      log.error(`[turn] turn ${turn.id} could not be finished: ${describeError(error)}`);
    } finally {
      clearTimeout(timer);
      // Every stream ends with done, carrying the status the store kept.
      const status: TerminalTurnStatus = finishedTurn === null || finishedTurn.status === 'running' ? 'error' : finishedTurn.status;
      channel.emit({ type: 'done', turnId: turn.id, status });
      channel.close();
    }
    return finishedTurn ?? turn;
  })();

  return { kind: 'started', turn, thread, userMessage, channel, finished };
}
