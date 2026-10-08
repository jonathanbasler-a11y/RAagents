import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { startTurn, type RoomExecutor, type StartTurnInput, type TurnRunnerDeps } from '@/server/chat/turn-runner';
import { gate, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import type { ChatEvent, TurnTrace } from '@/shared/contracts';

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
