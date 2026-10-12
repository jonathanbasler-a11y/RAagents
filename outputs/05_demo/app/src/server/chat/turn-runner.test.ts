import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import {
  DEADLINE_GRACE_MS,
  MAX_RUNNING_TURNS,
  STALE_TURN_MARGIN_MS,
  TERMINAL_SAVE_RETRIES,
  TURN_DEADLINE_MS,
  reconcileOverdueTurns,
  startTurn,
  type RoomExecutor,
  type StartTurnInput,
  type TurnRunnerDeps,
} from '@/server/chat/turn-runner';
import { openDatabase } from '@/server/db/sqlite';
import { eventually, gate, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import type { ChatEvent, Store, TurnTrace } from '@/shared/contracts';

const TRACE: TurnTrace = {
  route: { source: 'direct', primary: 'lead', secondaries: [], notConsulted: [], notes: [], synthesis: false },
  agents: [],
};

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  temp.cleanup();
});

function deps(overrides: Partial<TurnRunnerDeps> = {}): TurnRunnerDeps {
  return {
    store: temp.store,
    bootId: 'boot-1',
    workspaceId: 'demo',
    now: () => new Date('2026-10-07T20:45:00.000Z'),
    newId: sequentialIds('runner'),
    log: console,
    ...overrides,
  };
}

function input(overrides: Partial<StartTurnInput> = {}): StartTurnInput {
  return { roomId: 'lead', clientTurnId: 'client-1', text: 'What would you check first?', timeZone: 'Europe/Paris', ...overrides };
}

function collect(outcome: ReturnType<typeof startTurn>): ChatEvent[] {
  const events: ChatEvent[] = [];
  if (outcome.kind === 'started') outcome.channel.subscribe((event) => events.push(event));
  return events;
}

describe('startTurn', () => {
  it('saves the question, emits turn first, runs the executor detached and finishes the turn with its outcome', async () => {
    const hold = gate();
    let calls = 0;
    const executor: RoomExecutor = async (run) => {
      calls += 1;
      run.emit({ type: 'note', text: 'executor-ran' });
      await hold.promise;
      return { status: 'done', trace: TRACE };
    };

    const outcome = startTurn(input(), executor, deps());
    expect(outcome.kind).toBe('started');
    if (outcome.kind !== 'started') return;
    const events = collect(outcome);

    // Detached: startTurn returned while the executor still runs, and the turn holds the room.
    expect(calls).toBe(1);
    expect(temp.store.getTurn(outcome.turn.id)?.status).toBe('running');
    expect(outcome.userMessage).toMatchObject({ author: 'human', text: 'What would you check first?', turnId: outcome.turn.id });

    hold.release();
    const finished = await outcome.finished;

    expect(finished).toMatchObject({ id: outcome.turn.id, status: 'done', trace: TRACE });
    expect(events[0]).toEqual({
      type: 'turn',
      turnId: outcome.turn.id,
      threadId: outcome.thread.id,
      roomId: 'lead',
      clientTurnId: 'client-1',
      userMessageId: outcome.userMessage.id,
      startedAt: outcome.turn.startedAt,
    });
    expect(events.slice(1)).toEqual([
      { type: 'note', text: 'executor-ran' },
      { type: 'done', turnId: outcome.turn.id, status: 'done' },
    ]);
    expect(outcome.channel.closed).toBe(true);
  });

  it('answers a repeated clientTurnId with the existing turn and runs nothing new', async () => {
    let calls = 0;
    const executor: RoomExecutor = async () => {
      calls += 1;
      return { status: 'done', trace: TRACE };
    };
    const first = startTurn(input(), executor, deps());
    if (first.kind !== 'started') throw new Error('expected a started turn');
    await first.finished;

    const repeat = startTurn(input(), executor, deps());

    expect(repeat).toEqual({ kind: 'duplicate', turn: expect.objectContaining({ id: first.turn.id, status: 'done' }) });
    expect(calls).toBe(1);
    expect(temp.store.listTurns(first.thread.id)).toHaveLength(1);
    expect(temp.store.listMessages(first.thread.id).filter((message) => message.author === 'human')).toHaveLength(1);
  });

  it('answers a repeat that arrives while the first is still running with the running turn', () => {
    const hold = gate();
    const executor: RoomExecutor = async () => {
      await hold.promise;
      return { status: 'done', trace: TRACE };
    };
    const first = startTurn(input(), executor, deps());
    if (first.kind !== 'started') throw new Error('expected a started turn');

    const repeat = startTurn(input(), executor, deps());

    expect(repeat).toEqual({ kind: 'duplicate', turn: expect.objectContaining({ id: first.turn.id, status: 'running' }) });
    hold.release();
  });

  it('refuses a second turn in the same room while one runs, naming the running turn', async () => {
    const hold = gate();
    const executor: RoomExecutor = async () => {
      await hold.promise;
      return { status: 'done', trace: TRACE };
    };
    const first = startTurn(input(), executor, deps());
    if (first.kind !== 'started') throw new Error('expected a started turn');

    const second = startTurn(input({ clientTurnId: 'client-2' }), executor, deps());

    expect(second).toEqual({ kind: 'busy', runningTurnId: first.turn.id });
    hold.release();
    await first.finished;
    // The room is free again once the turn has ended (positive control).
    expect(startTurn(input({ clientTurnId: 'client-3' }), executor, deps()).kind).toBe('started');
  });

  it('refuses a clientTurnId that was already used in another room', async () => {
    const executor: RoomExecutor = async () => ({ status: 'done', trace: TRACE });
    const first = startTurn(input(), executor, deps());
    if (first.kind !== 'started') throw new Error('expected a started turn');
    await first.finished;

    const elsewhere = startTurn(input({ roomId: 'cmc' }), executor, deps());

    expect(elsewhere).toEqual({ kind: 'other_room', turn: expect.objectContaining({ id: first.turn.id, roomId: 'lead' }) });
  });

  it('ends a turn whose executor throws as error, with an internal code and a correlation id, and still sends done', async () => {
    const logs = captureLogs();
    const executor: RoomExecutor = async () => {
      throw new Error('executor exploded');
    };

    const outcome = startTurn(input(), executor, deps());
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const events = collect(outcome);
    const finished = await outcome.finished;

    expect(finished).toMatchObject({ status: 'error', errorCode: 'internal', correlationId: expect.any(String) });
    expect(events.slice(1)).toEqual([
      { type: 'error', code: 'internal', correlationId: finished.correlationId },
      { type: 'done', turnId: outcome.turn.id, status: 'error' },
    ]);
    expect(logs.errors().join('\n')).toContain(finished.correlationId as string);
    expect(logs.errors().join('\n')).toContain('executor exploded');
  });

  it('aborts the turn signal at the deadline, and finishes a turn whose executor never returns as out_of_time', async () => {
    captureLogs();
    let signal: AbortSignal | undefined;
    const executor: RoomExecutor = (run) => {
      signal = run.signal;
      return new Promise(() => {});
    };

    const outcome = startTurn(input(), executor, deps({ turnDeadlineMs: 20, deadlineGraceMs: 20 }));
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const events = collect(outcome);
    const finished = await outcome.finished;

    expect(signal?.aborted).toBe(true);
    expect(finished).toMatchObject({ status: 'error', errorCode: 'out_of_time' });
    expect(events.at(-1)).toEqual({ type: 'done', turnId: outcome.turn.id, status: 'error' });
  });

  it('stores the deadline on the turn row: 180 seconds after the start by default', () => {
    const outcome = startTurn(input(), async () => ({ status: 'done', trace: TRACE }), deps());
    if (outcome.kind !== 'started') throw new Error('expected a started turn');

    expect(outcome.turn.deadlineAt).toBe('2026-10-07T20:48:00.000Z');
  });

  it('sends done with the status the store kept, such as interrupted when another process reconciled the turn', async () => {
    const hold = gate();
    const executor: RoomExecutor = async () => {
      await hold.promise;
      return { status: 'done', trace: TRACE };
    };
    const outcome = startTurn(input(), executor, deps());
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const events = collect(outcome);

    temp.store.reconcileStaleTurns('a-newer-process');
    hold.release();
    const finished = await outcome.finished;

    expect(finished.status).toBe('interrupted');
    expect(events.at(-1)).toEqual({ type: 'done', turnId: outcome.turn.id, status: 'interrupted' });
  });

  it('keeps running and finishing when nobody listens any more', async () => {
    const hold = gate();
    const executor: RoomExecutor = async (run) => {
      await hold.promise;
      run.emit({ type: 'note', text: 'after the listener left' });
      return { status: 'done', trace: TRACE };
    };
    const outcome = startTurn(input(), executor, deps());
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const unsubscribe = outcome.channel.subscribe(() => {});

    unsubscribe();
    hold.release();

    await expect(outcome.finished).resolves.toMatchObject({ status: 'done' });
  });
});

// COR-3: a turn whose terminal save fails must not hold its room (and the browser's polling) until a restart.
describe('startTurn: a terminal save that fails', () => {
  /** A store whose finishTurn throws on its first `failures` calls, then saves for real. */
  function flakyFinish(failures: number) {
    let calls = 0;
    const store: Store = {
      ...temp.store,
      finishTurn(finishInput) {
        calls += 1;
        if (calls <= failures) throw new Error('disk I/O error');
        return temp.store.finishTurn(finishInput);
      },
    };
    return { store, calls: () => calls };
  }
  const done: RoomExecutor = async () => ({ status: 'done', trace: TRACE });

  it('saves the end of the turn when the first save fails once, so the room is free again', async () => {
    const logs = captureLogs();
    const flaky = flakyFinish(1);

    const outcome = startTurn(input(), done, deps({ store: flaky.store }));
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const events = collect(outcome);
    const finished = await outcome.finished;

    expect(temp.store.getTurn(outcome.turn.id)?.status).toBe('done');
    expect(finished.status).toBe('done');
    expect(events.at(-1)).toEqual({ type: 'done', turnId: outcome.turn.id, status: 'done' });
    expect(temp.store.getRunningTurn('demo', 'lead')).toBeNull();
    expect(startTurn(input({ clientTurnId: 'client-2' }), done, deps()).kind).toBe('started');
    expect(logs.errors().join('\n')).toContain('disk I/O error');
  });

  it('saves the end of the turn without its trace when the trace cannot be written', async () => {
    captureLogs();
    const circular: Record<string, unknown> = { route: TRACE.route, agents: [] };
    circular.self = circular;
    const executor: RoomExecutor = async () => ({ status: 'done', trace: circular as unknown as TurnTrace });

    const outcome = startTurn(input(), executor, deps());
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const finished = await outcome.finished;

    expect(finished.status).toBe('done');
    expect(temp.store.getTurn(outcome.turn.id)?.status).toBe('done');
    expect(temp.store.getRunningTurn('demo', 'lead')).toBeNull();
  });

  it('keeps trying in the background while the store is down, then frees the room once it takes the save', async () => {
    const logs = captureLogs();
    const flaky = flakyFinish(3);

    const outcome = startTurn(input(), done, deps({ store: flaky.store, finishRetryMs: 5 }));
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    const events = collect(outcome);
    const finished = await outcome.finished;

    // The stream ends at once, with what the store holds: not finished, so it says error.
    expect(finished.status).toBe('running');
    expect(events.at(-1)).toEqual({ type: 'done', turnId: outcome.turn.id, status: 'error' });
    await eventually(() => expect(temp.store.getTurn(outcome.turn.id)?.status).toBe('done'));
    expect(temp.store.getRunningTurn('demo', 'lead')).toBeNull();
    expect(logs.errors().join('\n')).toContain('disk I/O error');
  });

  it('gives up after a bounded number of background tries, and says so in the log', async () => {
    const logs = captureLogs();
    const flaky = flakyFinish(Number.POSITIVE_INFINITY);

    const outcome = startTurn(input(), done, deps({ store: flaky.store, finishRetryMs: 1 }));
    if (outcome.kind !== 'started') throw new Error('expected a started turn');
    await outcome.finished;
    await eventually(() => expect(logs.errors().join('\n')).toContain('gave up'));
    const calls = flaky.calls();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(flaky.calls()).toBe(calls);
    expect(calls).toBeLessThanOrEqual(3 + TERMINAL_SAVE_RETRIES);
    expect(temp.store.getTurn(outcome.turn.id)?.status).toBe('running');
  });
});

describe('startTurn: the cap on turns running at once', () => {
  const held = () => {
    const hold = gate();
    const executor: RoomExecutor = async () => {
      await hold.promise;
      return { status: 'done', trace: TRACE };
    };
    return { hold, executor };
  };
  const rowCounts = () => {
    const db = openDatabase(temp.dbPath);
    try {
      const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
      return { threads: count('threads'), turns: count('turns'), messages: count('messages') };
    } finally {
      db.close();
    }
  };

  it('is two turns at once', () => {
    expect(MAX_RUNNING_TURNS).toBe(2);
  });

  it('runs three concurrent turns in three rooms: the third is refused with server_busy and nothing is written for it', async () => {
    const { hold, executor } = held();
    let thirdCalls = 0;
    const first = startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), executor, deps());
    const second = startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), executor, deps());
    expect([first.kind, second.kind]).toEqual(['started', 'started']);
    const before = rowCounts();

    const third = startTurn(
      input({ roomId: 'labels', clientTurnId: 'client-3' }),
      async () => {
        thirdCalls += 1;
        return { status: 'done', trace: TRACE };
      },
      deps(),
    );

    expect(third).toEqual({ kind: 'server_busy', running: 2, limit: 2 });
    expect(thirdCalls).toBe(0);
    expect(rowCounts()).toEqual(before);
    expect(rowCounts()).toEqual({ threads: 2, turns: 2, messages: 2 });
    expect(temp.store.getRunningTurn('demo', 'labels')).toBeNull();
    hold.release();
    if (first.kind === 'started') await first.finished;
    if (second.kind === 'started') await second.finished;
  });

  it('frees a slot when a turn ends: the refused question can be sent again', async () => {
    const a = held();
    const b = held();
    const first = startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), a.executor, deps());
    const second = startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), b.executor, deps());
    expect(startTurn(input({ roomId: 'labels', clientTurnId: 'client-3' }), a.executor, deps()).kind).toBe('server_busy');

    a.hold.release();
    if (first.kind === 'started') await first.finished;

    const retried = startTurn(input({ roomId: 'labels', clientTurnId: 'client-3' }), b.executor, deps());
    expect(retried.kind).toBe('started');
    b.hold.release();
    if (second.kind === 'started') await second.finished;
    if (retried.kind === 'started') await retried.finished;
  });

  it('answers a repeated clientTurnId with the existing turn even at the cap, and a busy room with the room, not the server', async () => {
    const { hold, executor } = held();
    const first = startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), executor, deps());
    startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), executor, deps());
    if (first.kind !== 'started') throw new Error('expected a started turn');

    const repeat = startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), executor, deps());
    const sameRoom = startTurn(input({ roomId: 'lead', clientTurnId: 'client-9' }), executor, deps());

    expect(repeat).toEqual({ kind: 'duplicate', turn: expect.objectContaining({ id: first.turn.id }) });
    expect(sameRoom).toEqual({ kind: 'busy', runningTurnId: first.turn.id });
    hold.release();
  });

  it('counts the turns in the store, so a second copy of this module (another bundle) sees the same two', async () => {
    const { hold, executor } = held();
    startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), executor, deps());
    startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), executor, deps());

    // A fresh deps object, as another copy of the module would build: no shared memory, only the store.
    const other = startTurn(input({ roomId: 'labels', clientTurnId: 'client-3' }), executor, deps({ newId: sequentialIds('other') }));

    expect(other.kind).toBe('server_busy');
    hold.release();
  });

  it('honours a different cap when the caller sets one', async () => {
    const { hold, executor } = held();
    startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), executor, deps({ maxRunningTurns: 1 }));

    const second = startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), executor, deps({ maxRunningTurns: 1 }));

    expect(second).toEqual({ kind: 'server_busy', running: 1, limit: 1 });
    hold.release();
  });
});

// A turn past its deadline and grace must never hold its room (or a slot) for good.
describe('startTurn: a turn past its deadline never holds its room forever', () => {
  let clockMs: number;
  let clocked: TempStore;
  const T0 = Date.parse('2026-10-07T20:45:00.000Z');
  const hung: RoomExecutor = () => new Promise(() => {});
  const STALE_AFTER_MS = TURN_DEADLINE_MS + DEADLINE_GRACE_MS + STALE_TURN_MARGIN_MS;

  beforeEach(() => {
    clockMs = T0;
    clocked = tempStore({ now: () => new Date(clockMs) });
  });

  afterEach(() => {
    clocked.cleanup();
  });

  const clockedDeps = (overrides: Partial<TurnRunnerDeps> = {}) => deps({ store: clocked.store, now: () => new Date(clockMs), ...overrides });

  it('frees the room of a turn whose runner is stuck, once deadline plus grace have passed, and starts the new turn', () => {
    const logs = captureLogs();
    const stuck = startTurn(input({ clientTurnId: 'client-1' }), hung, clockedDeps());
    if (stuck.kind !== 'started') throw new Error('expected a started turn');

    // At the boundary the turn still counts as running: its runner may be wrapping up.
    clockMs = T0 + STALE_AFTER_MS;
    expect(startTurn(input({ clientTurnId: 'client-2' }), hung, clockedDeps())).toEqual({ kind: 'busy', runningTurnId: stuck.turn.id });
    expect(clocked.store.getTurn(stuck.turn.id)?.status).toBe('running');

    clockMs = T0 + STALE_AFTER_MS + 1;
    const next = startTurn(input({ clientTurnId: 'client-2' }), hung, clockedDeps());

    expect(next.kind).toBe('started');
    expect(clocked.store.getTurn(stuck.turn.id)).toMatchObject({ status: 'interrupted', errorCode: 'out_of_time' });
    expect(logs.warnings().join('\n')).toContain('marked interrupted');
  });

  it('does it before the busy check, and before the cap: stuck turns in other rooms do not use up the slots', () => {
    startTurn(input({ roomId: 'lead', clientTurnId: 'client-1' }), hung, clockedDeps());
    startTurn(input({ roomId: 'cmc', clientTurnId: 'client-2' }), hung, clockedDeps());
    expect(startTurn(input({ roomId: 'labels', clientTurnId: 'client-3' }), hung, clockedDeps()).kind).toBe('server_busy');

    clockMs = T0 + STALE_AFTER_MS + 1;
    const third = startTurn(input({ roomId: 'labels', clientTurnId: 'client-3' }), hung, clockedDeps());

    expect(third.kind).toBe('started');
    expect(clocked.store.getRunningTurn('demo', 'lead')).toBeNull();
    expect(clocked.store.getRunningTurn('demo', 'cmc')).toBeNull();
  });

  it('leaves a turn alone that the runner will end itself: within the deadline plus the runner grace plus the margin', () => {
    const stuck = startTurn(input({ clientTurnId: 'client-1' }), hung, clockedDeps());
    if (stuck.kind !== 'started') throw new Error('expected a started turn');

    clockMs = T0 + TURN_DEADLINE_MS + DEADLINE_GRACE_MS;

    expect(reconcileOverdueTurns({ store: clocked.store, bootId: 'boot-1', log: console })).toBe(0);
    expect(clocked.store.getTurn(stuck.turn.id)?.status).toBe('running');
  });

  it('keeps going when the check itself fails: it is logged, and the start is left to the store', () => {
    const logs = captureLogs();
    const store = {
      ...clocked.store,
      reconcileStaleTurns() {
        throw new Error('database is locked');
      },
    };

    const outcome = startTurn(input({ clientTurnId: 'client-1' }), hung, clockedDeps({ store }));

    expect(outcome.kind).toBe('started');
    expect(logs.errors().join('\n')).toContain('database is locked');
  });
});
