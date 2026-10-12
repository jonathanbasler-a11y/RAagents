import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeChatRuntime, createChatRuntime, defaultChatDbPath, getChatRuntime } from '@/server/chat/boot';
import { createStore } from '@/server/chat/store';
import type { ShutdownProcess, ShutdownSignal } from '@/server/chat/shutdown';
import { tempStore, type TempStore } from '@/server/chat/test-support';

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  closeChatRuntime();
  temp.cleanup();
});

function leaveRunningTurn(bootId: string, deadlineAt = '2026-10-07T20:48:00.000Z'): string {
  const { turn } = temp.store.startTurn({ workspaceId: 'demo', roomId: 'lead', clientTurnId: `client-${bootId}`, bootId, deadlineAt });
  return turn.id;
}

/** A stand-in for `process`: records the listeners, never exits. */
function fakeProcess() {
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
    exit: (code) => {
      exits.push(code ?? 0);
    },
  };
  return { proc, exits, count: (signal: ShutdownSignal) => list(signal).length, raise: (signal: ShutdownSignal) => list(signal).forEach((l) => l(signal)) };
}

describe('createChatRuntime', () => {
  it('marks running turns left by an earlier process as interrupted, and frees the room', () => {
    const turnId = leaveRunningTurn('earlier-process');

    const runtime = createChatRuntime({ dbPath: temp.dbPath, bootId: 'this-process', now: () => new Date('2026-10-07T20:46:00.000Z') });

    expect(runtime.reconciled).toBe(1);
    expect(runtime.store.getTurn(turnId)?.status).toBe('interrupted');
    expect(runtime.store.getRunningTurn('demo', 'lead')).toBeNull();
    runtime.store.close();
  });

  it('leaves a running turn of the same boot alone while it is within its deadline (positive control)', () => {
    const turnId = leaveRunningTurn('this-process');

    const runtime = createChatRuntime({ dbPath: temp.dbPath, bootId: 'this-process', now: () => new Date('2026-10-07T20:46:00.000Z') });

    expect(runtime.reconciled).toBe(0);
    expect(runtime.store.getTurn(turnId)?.status).toBe('running');
    runtime.store.close();
  });

  it("opens the store with the runtime's boot id, so it can interrupt this process's turns and no others", () => {
    const earlier = leaveRunningTurn('earlier-process', '2030-01-01T00:00:00.000Z');
    const runtime = createChatRuntime({ dbPath: temp.dbPath, bootId: 'this-process', now: () => new Date('2026-10-07T20:46:00.000Z') });
    const { turn } = runtime.store.startTurn({
      workspaceId: 'demo',
      roomId: 'cmc',
      clientTurnId: 'client-own',
      bootId: runtime.bootId,
      deadlineAt: '2030-01-01T00:00:00.000Z',
    });

    const own = runtime.store.interruptTurn({ turnId: turn.id, errorCode: 'server_shutdown', correlationId: 'corr-1' });

    expect(own).toMatchObject({ status: 'interrupted', errorCode: 'server_shutdown' });
    // `earlier` was reconciled at boot already; a turn of another boot started later is left alone.
    expect(runtime.store.getTurn(earlier)?.status).toBe('interrupted');
    const foreign = temp.store.startTurn({
      workspaceId: 'demo',
      roomId: 'labels',
      clientTurnId: 'client-foreign',
      bootId: 'another-process',
      deadlineAt: '2030-01-01T00:00:00.000Z',
    });
    expect(runtime.store.interruptTurn({ turnId: foreign.turn.id, errorCode: 'server_shutdown', correlationId: 'corr-2' }).status).toBe('running');
    runtime.store.close();
  });

  it('gives each runtime a boot id, the demo workspace and the time this server process started', () => {
    const runtime = createChatRuntime({ dbPath: temp.dbPath });

    expect(runtime.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(runtime.workspaceId).toBe('demo');
    expect(Date.parse(runtime.startedAt)).toBeLessThanOrEqual(Date.now());
    expect(new Date(runtime.startedAt).toISOString()).toBe(runtime.startedAt);
    runtime.store.close();
  });
});

describe('defaultChatDbPath', () => {
  it('uses CHAT_DB_PATH when it is set, resolved from the working directory', () => {
    expect(defaultChatDbPath({ CHAT_DB_PATH: 'tmp/other.db' }, '/srv/app')).toBe(path.resolve('/srv/app', 'tmp/other.db'));
  });

  it('falls back to .data/chat.db in the working directory', () => {
    expect(defaultChatDbPath({}, '/srv/app')).toBe(path.join('/srv/app', '.data', 'chat.db'));
    expect(defaultChatDbPath({ CHAT_DB_PATH: '  ' }, '/srv/app')).toBe(path.join('/srv/app', '.data', 'chat.db'));
  });
});

describe('getChatRuntime', () => {
  it('creates one runtime per process, reconciles on first use only, and shares it between callers', () => {
    vi.stubEnv('CHAT_DB_PATH', temp.dbPath);
    const turnId = leaveRunningTurn('earlier-process');

    const fake = fakeProcess();
    const first = getChatRuntime({ shutdownProcess: fake.proc });
    const second = getChatRuntime({ shutdownProcess: fake.proc });

    expect(second).toBe(first);
    expect(first.reconciled).toBe(1);
    expect(first.store.getTurn(turnId)?.status).toBe('interrupted');
  });

  it('keeps the runtime on globalThis, so a second copy of this module in another route bundle shares it', () => {
    vi.stubEnv('CHAT_DB_PATH', temp.dbPath);
    const runtime = getChatRuntime({ shutdownProcess: fakeProcess().proc });

    const shared = Object.getOwnPropertySymbols(globalThis)
      .map((symbol) => (globalThis as Record<symbol, unknown>)[symbol])
      .filter((value) => value === runtime);

    expect(shared).toHaveLength(1);
  });

  it('is reopened after closeChatRuntime, on the same file', () => {
    vi.stubEnv('CHAT_DB_PATH', temp.dbPath);
    const fake = fakeProcess();
    const first = getChatRuntime({ shutdownProcess: fake.proc });
    const { turn } = first.store.startTurn({
      workspaceId: 'demo',
      roomId: 'lead',
      clientTurnId: 'client-x',
      bootId: first.bootId,
      deadlineAt: '2030-01-01T00:00:00.000Z',
    });

    closeChatRuntime();
    const reopened = getChatRuntime({ shutdownProcess: fake.proc });

    expect(reopened).not.toBe(first);
    const check = createStore(temp.dbPath);
    expect(check.getTurn(turn.id)).not.toBeNull();
    check.close();
  });

  it('installs the shutdown handler once per process: later calls, and a reopen, add no listeners', () => {
    vi.stubEnv('CHAT_DB_PATH', temp.dbPath);
    const fake = fakeProcess();

    getChatRuntime({ shutdownProcess: fake.proc });
    getChatRuntime({ shutdownProcess: fake.proc });
    closeChatRuntime();
    getChatRuntime({ shutdownProcess: fake.proc });

    expect(fake.count('SIGINT')).toBe(1);
    expect(fake.count('SIGTERM')).toBe(1);
  });

  it('lets the process exit on a signal, after saving', () => {
    vi.stubEnv('CHAT_DB_PATH', temp.dbPath);
    const fake = fakeProcess();
    getChatRuntime({ shutdownProcess: fake.proc });

    fake.raise('SIGTERM');

    expect(fake.exits).toEqual([143]);
  });
});
