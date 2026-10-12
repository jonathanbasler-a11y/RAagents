import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { AgentId, ChatEvent, Store } from '@/shared/contracts';
import { gate, sequentialIds } from './test-support';
import { createStore } from './store';
import {
  installShutdownHandler,
  interruptRunningTurns,
  registerRunningTurn,
  registeredTurnIds,
  type ShutdownProcess,
  type ShutdownSignal,
} from './shutdown';
import { startTurn, type RoomExecutor, type StartTurnInput, type TurnRunnerDeps } from './turn-runner';

// A simulated signal: the tests hand the handler a stand-in for `process`, so no real signal
// is sent and nothing exits. Turns run through the real runner and a real store (with a boot id).

const NOW = new Date('2026-10-07T20:45:00.000Z');

let dir: string;
let store: Store;
let runnerIds: () => string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'shutdown-test-'));
  store = createStore(path.join(dir, 'chat.db'), { now: () => NOW, newId: sequentialIds('row'), bootId: 'boot-1' });
  runnerIds = sequentialIds('runner');
});

afterEach(() => {
  // Anything a test left registered must not leak into the next one.
  for (const turnId of registeredTurnIds()) registerRunningTurn({ turnId, interrupt: () => undefined })();
  store.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

interface FakeProcess {
  proc: ShutdownProcess;
  exits: number[];
  raise(signal: ShutdownSignal): void;
  count(signal: ShutdownSignal): number;
  addOtherListener(signal: ShutdownSignal): () => void;
}

function fakeProcess(): FakeProcess {
  const listeners = new Map<ShutdownSignal, Array<(signal: ShutdownSignal) => void>>();
  const exits: number[] = [];
  const list = (signal: ShutdownSignal) => listeners.get(signal) ?? [];
  const proc: ShutdownProcess = {
    prependListener(signal, listener) {
      listeners.set(signal, [listener, ...list(signal)]);
      return proc;
    },
    removeListener(signal, listener) {
      listeners.set(
        signal,
        list(signal).filter((entry) => entry !== listener),
      );
      return proc;
    },
    listenerCount: (signal) => list(signal).length,
    exit(code) {
      exits.push(code ?? 0);
    },
  };
  return {
    proc,
    exits,
    raise: (signal) => {
      for (const listener of [...list(signal)]) listener(signal);
    },
    count: (signal) => list(signal).length,
    addOtherListener(signal) {
      const other = () => undefined;
      listeners.set(signal, [...list(signal), other]);
      return () => listeners.set(signal, list(signal).filter((entry) => entry !== other));
    },
  };
}

const AGENTS: Record<string, { name: string; version: string }> = {
  lead: { name: 'Rosa', version: '1.0.0' },
  cmc: { name: 'Carlos', version: '2.1.0' },
};

function deps(overrides: Partial<TurnRunnerDeps> = {}): TurnRunnerDeps {
  return {
    store,
    bootId: 'boot-1',
    workspaceId: 'demo',
    now: () => NOW,
    newId: runnerIds,
    log: console,
    getAgent: (id: AgentId) => AGENTS[id],
    ...overrides,
  };
}

function input(overrides: Partial<StartTurnInput> = {}): StartTurnInput {
  return { roomId: 'lead', clientTurnId: 'client-1', text: 'What would you check first?', timeZone: 'Europe/Paris', ...overrides };
}

/** An executor that streams the given parts, saves nothing, then waits for `hold`. */
function streamingExecutor(agentId: string, messageId: string, parts: string[], hold: Promise<void>): RoomExecutor {
  return async (run) => {
    run.emit({ type: 'agent_start', agentId, messageId, role: 'solo' });
    for (const text of parts) run.emit({ type: 'delta', messageId, text });
    await hold;
    return { status: 'done', trace: null };
  };
}

function start(startInput: StartTurnInput, executor: RoomExecutor, overrides: Partial<TurnRunnerDeps> = {}) {
  const outcome = startTurn(startInput, executor, deps(overrides));
  if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
  const events: ChatEvent[] = [];
  outcome.channel.subscribe((event) => events.push(event));
  return { ...outcome, events };
}

describe('installShutdownHandler', () => {
  it('installs once per process object: a second call adds nothing, and says so', () => {
    const fake = fakeProcess();

    expect(installShutdownHandler({ process: fake.proc })).toBe(true);
    expect(installShutdownHandler({ process: fake.proc })).toBe(false);

    expect(fake.count('SIGINT')).toBe(1);
    expect(fake.count('SIGTERM')).toBe(1);
  });

  it('installs again for another process object (the guard is per process, not per call)', () => {
    const first = fakeProcess();
    const second = fakeProcess();

    expect(installShutdownHandler({ process: first.proc })).toBe(true);
    expect(installShutdownHandler({ process: second.proc })).toBe(true);
  });

  it('runs before other listeners, so a listener that exits at once cannot skip the saving', () => {
    const order: string[] = [];
    const fake = fakeProcess();
    fake.proc.prependListener('SIGTERM', () => order.push('early-other'));
    installShutdownHandler({ process: fake.proc });
    registerRunningTurn({ turnId: 'probe', interrupt: () => order.push('saved') });

    fake.raise('SIGTERM');

    expect(order.indexOf('saved')).toBeLessThan(order.indexOf('early-other'));
  });
});

describe('a shutdown signal while turns run', () => {
  it('saves the reply that was still streaming with the text received so far, marked server_shutdown, and interrupts the turn', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('lead', 'reply-1', ['Check the ', 'label first'], hold.promise));

    fake.raise('SIGTERM');

    const messages = store.listMessages(turn.thread.id);
    expect(messages.map((message) => [message.author, message.text])).toEqual([
      ['human', 'What would you check first?'],
      ['agent', 'Check the label first'],
    ]);
    const reply = messages[1];
    expect(reply).toMatchObject({
      id: 'reply-1',
      agentId: 'lead',
      agentName: 'Rosa',
      agentVersion: '1.0.0',
      status: 'partial',
      truncated: false,
      errorCode: 'server_shutdown',
      correlationId: expect.any(String),
    });
    const saved = store.getTurn(turn.turn.id);
    expect(saved).toMatchObject({ status: 'interrupted', errorCode: 'server_shutdown', correlationId: reply.correlationId });
    expect(store.getRunningTurn('demo', 'lead')).toBeNull();
    hold.release();
    await turn.finished;
  });

  it('ends the stream with the cut-off reply and done interrupted, so the server can close the connection', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('lead', 'reply-1', ['Partial'], hold.promise));

    fake.raise('SIGTERM');

    const correlationId = store.getTurn(turn.turn.id)?.correlationId;
    expect(turn.events.slice(-3)).toEqual([
      { type: 'error', code: 'server_shutdown', correlationId, messageId: 'reply-1' },
      { type: 'agent_end', messageId: 'reply-1', status: 'partial', truncated: false },
      { type: 'done', turnId: turn.turn.id, status: 'interrupted' },
    ]);
    expect(turn.channel.closed).toBe(true);
    hold.release();
    await turn.finished;
  });

  it('gives each turn its own correlation id, and one id for everything saved for that turn', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const first = start(input(), streamingExecutor('lead', 'reply-1', ['One'], hold.promise));
    const second = start(input({ roomId: 'cmc', clientTurnId: 'client-2' }), streamingExecutor('cmc', 'reply-2', ['Two'], hold.promise));

    fake.raise('SIGINT');

    const firstTurn = store.getTurn(first.turn.id);
    const secondTurn = store.getTurn(second.turn.id);
    expect(firstTurn?.status).toBe('interrupted');
    expect(secondTurn?.status).toBe('interrupted');
    expect(firstTurn?.correlationId).toEqual(expect.any(String));
    expect(firstTurn?.correlationId).not.toBe(secondTurn?.correlationId);
    expect(store.listMessages(first.thread.id).at(-1)).toMatchObject({ text: 'One', correlationId: firstTurn?.correlationId });
    expect(store.listMessages(second.thread.id).at(-1)).toMatchObject({ text: 'Two', correlationId: secondTurn?.correlationId });
    hold.release();
    await Promise.all([first.finished, second.finished]);
  });

  it('saves a reply that had not produced any text yet as an error with no text, still marked server_shutdown', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('lead', 'reply-1', [], hold.promise));

    fake.raise('SIGTERM');

    expect(store.listMessages(turn.thread.id).at(-1)).toMatchObject({ text: '', status: 'error', errorCode: 'server_shutdown' });
    hold.release();
    await turn.finished;
  });

  it('keeps a reply that had finished but was not saved yet exactly as it ended, and does not mark it cut off', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const executor: RoomExecutor = async (run) => {
      run.emit({ type: 'agent_start', agentId: 'lead', messageId: 'reply-1', role: 'primary' });
      run.emit({ type: 'delta', messageId: 'reply-1', text: 'All of it.' });
      run.emit({ type: 'agent_end', messageId: 'reply-1', status: 'complete', truncated: false });
      run.emit({ type: 'agent_start', agentId: 'cmc', messageId: 'reply-2', role: 'secondary' });
      run.emit({ type: 'delta', messageId: 'reply-2', text: 'Half of' });
      await hold.promise;
      return { status: 'done', trace: null };
    };
    const turn = start(input({ roomId: 'team' }), executor);

    fake.raise('SIGTERM');

    const replies = store.listMessages(turn.thread.id).filter((message) => message.author === 'agent');
    expect(replies.map((reply) => [reply.agentName, reply.text, reply.status, reply.errorCode])).toEqual([
      ['Rosa', 'All of it.', 'complete', null],
      ['Carlos', 'Half of', 'partial', 'server_shutdown'],
    ]);
    hold.release();
    await turn.finished;
  });

  it('does not save a second copy of a reply the executor already saved', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const executor: RoomExecutor = async (run) => {
      run.emit({ type: 'agent_start', agentId: 'lead', messageId: 'reply-1', role: 'primary' });
      run.emit({ type: 'delta', messageId: 'reply-1', text: 'Saved text.' });
      run.emit({ type: 'agent_end', messageId: 'reply-1', status: 'complete', truncated: false });
      store.appendAgentMessage({
        id: 'reply-1',
        turnId: run.turn.id,
        agentId: 'lead',
        agentName: 'Rosa',
        agentVersion: '1.0.0',
        promptHash: 'hash',
        model: 'model-x',
        text: 'Saved text.',
        status: 'complete',
        truncated: false,
      });
      await hold.promise;
      return { status: 'done', trace: null };
    };
    const turn = start(input(), executor);

    fake.raise('SIGTERM');

    const replies = store.listMessages(turn.thread.id).filter((message) => message.author === 'agent');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ model: 'model-x', errorCode: null });
    hold.release();
    await turn.finished;
  });

  it('does not let a late finish of the executor change the saved turn or add a reply', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('lead', 'reply-1', ['Partial'], hold.promise));
    fake.raise('SIGTERM');
    const before = store.listMessages(turn.thread.id);

    hold.release();
    const finished = await turn.finished;

    expect(finished.status).toBe('interrupted');
    expect(store.getTurn(turn.turn.id)).toMatchObject({ status: 'interrupted', errorCode: 'server_shutdown' });
    expect(store.listMessages(turn.thread.id)).toEqual(before);
  });

  it('leaves a turn that already ended alone, and takes it off the list of running turns', async () => {
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), async () => ({ status: 'done', trace: null }));
    await turn.finished;
    expect(registeredTurnIds()).not.toContain(turn.turn.id);

    fake.raise('SIGTERM');

    expect(store.getTurn(turn.turn.id)).toMatchObject({ status: 'done', errorCode: null });
  });

  it('names the agent by its id when the roster no longer knows it, instead of dropping the text', async () => {
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('gone', 'reply-1', ['Text'], hold.promise));

    fake.raise('SIGTERM');

    expect(store.listMessages(turn.thread.id).at(-1)).toMatchObject({ agentName: 'gone', agentVersion: 'unknown', text: 'Text' });
    hold.release();
    await turn.finished;
  });

  it('logs what it did, with the correlation id the browser can show', async () => {
    const logs = captureLogs();
    const hold = gate();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    const turn = start(input(), streamingExecutor('lead', 'reply-1', ['Text'], hold.promise));

    fake.raise('SIGTERM');

    const correlationId = store.getTurn(turn.turn.id)?.correlationId as string;
    expect(logs.warnings().join('\n')).toContain(correlationId);
    expect(logs.warnings().join('\n')).toContain('SIGTERM');
    hold.release();
    await turn.finished;
  });
});

describe('a shutdown signal: the process still exits', () => {
  it('exits with the conventional code after saving when nothing else listens (130 for SIGINT, 143 for SIGTERM)', () => {
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });

    fake.raise('SIGINT');
    expect(fake.exits).toEqual([130]);

    const other = fakeProcess();
    installShutdownHandler({ process: other.proc });
    other.raise('SIGTERM');
    expect(other.exits).toEqual([143]);
  });

  it('exits even when there is no turn to save', () => {
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });

    fake.raise('SIGTERM');

    expect(fake.exits).toEqual([143]);
  });

  it('exits even when saving a turn fails, and says so in the log', async () => {
    const logs = captureLogs();
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    registerRunningTurn({
      turnId: 'broken',
      interrupt: () => {
        throw new Error('disk I/O error');
      },
    });
    const hold = gate();
    const turn = start(input(), streamingExecutor('lead', 'reply-1', ['Text'], hold.promise));

    fake.raise('SIGTERM');

    expect(fake.exits).toEqual([143]);
    expect(logs.errors().join('\n')).toContain('disk I/O error');
    // The other turn was still saved.
    expect(store.getTurn(turn.turn.id)?.status).toBe('interrupted');
    hold.release();
    await turn.finished;
  });

  it('takes its own listener off, so a second signal goes to whoever else listens or to the default', () => {
    const fake = fakeProcess();
    installShutdownHandler({ process: fake.proc });
    expect(fake.count('SIGTERM')).toBe(1);

    fake.raise('SIGTERM');

    expect(fake.count('SIGTERM')).toBe(0);
    expect(fake.count('SIGINT')).toBe(1);
  });

  it('leaves the exit to another listener that is still there (a server closing its connections), but exits itself if that takes too long', () => {
    vi.useFakeTimers();
    const fake = fakeProcess();
    fake.addOtherListener('SIGTERM');
    installShutdownHandler({ process: fake.proc, exitFallbackMs: 5_000 });

    fake.raise('SIGTERM');
    expect(fake.exits).toEqual([]);

    vi.advanceTimersByTime(4_999);
    expect(fake.exits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.exits).toEqual([143]);
  });
});

describe('interruptRunningTurns', () => {
  it('interrupts every registered turn once, in the order they started, and counts them', () => {
    const order: string[] = [];
    registerRunningTurn({ turnId: 'a', interrupt: (signal) => order.push(`a:${signal}`) });
    registerRunningTurn({ turnId: 'b', interrupt: (signal) => order.push(`b:${signal}`) });

    expect(interruptRunningTurns('SIGTERM', console)).toBe(2);
    expect(order).toEqual(['a:SIGTERM', 'b:SIGTERM']);
  });

  it('forgets a turn once it is unregistered', () => {
    const unregister = registerRunningTurn({ turnId: 'a', interrupt: () => undefined });
    expect(registeredTurnIds()).toContain('a');

    unregister();

    expect(registeredTurnIds()).not.toContain('a');
  });
});
