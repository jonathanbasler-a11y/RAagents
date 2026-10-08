// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, NewThreadResponse, RoomMessagesResponse } from '@/shared/contracts';
import type { ApiResult, ChatApi, PostTurnHandlers, PostTurnOutcome } from './chat-client';
import { ROSTER, THREAD, makeMessage, makeTurn, roomData } from './test-fixtures';
import type { TimelineItem } from './timeline';
import { useChatRoom, type RoomClient, type SendOutcome } from './use-chat-room';

const nameOf = (id: string) => ROSTER.find((agent) => agent.id === id)?.name ?? id;

function show(item: TimelineItem): string {
  if (item.kind === 'human') return `you: ${item.text}`;
  if (item.kind === 'agent') return `${item.agentName} [${item.state}]: ${item.text}`;
  if (item.kind === 'line') return `${item.tone}: ${item.text}`;
  return `panel ${item.turn.id}`;
}

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const EMPTY = roomData([], [], 'reglead');
const DONE: ChatEvent = { type: 'done', turnId: 't1', status: 'done' };
const STREAM_DONE: PostTurnOutcome = { kind: 'stream', clientTurnId: 'c1', done: DONE, broken: false };

const SAVED: RoomMessagesResponse = roomData(
  [
    makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Hello Rosa', seq: 1 }),
    makeMessage({ id: 'm1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Full reply', seq: 2 }),
  ],
  [makeTurn({ id: 't1', roomId: 'reglead' })],
  'reglead',
);

const RUNNING: RoomMessagesResponse = roomData(
  [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Hello Rosa', seq: 1 })],
  [makeTurn({ id: 't1', roomId: 'reglead', status: 'running', finishedAt: null })],
  'reglead',
);

function fakeClient(overrides: Partial<RoomClient> = {}) {
  return {
    getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(EMPTY)),
    postTurn: vi.fn<ChatApi['postTurn']>().mockResolvedValue(STREAM_DONE),
    newConversation: vi
      .fn<ChatApi['newConversation']>()
      .mockResolvedValue(ok({ thread: THREAD, archivedThreadId: 'old-thread' })),
    ...overrides,
  };
}

/** A postTurn whose events and outcome the test drives step by step. */
function controlledPostTurn() {
  const control: { handlers: PostTurnHandlers; finish: (outcome: PostTurnOutcome) => void } = {
    handlers: {},
    finish: () => undefined,
  };
  const postTurn = vi.fn<ChatApi['postTurn']>((_room, _text, handlers = {}) => {
    control.handlers = handlers;
    return new Promise<PostTurnOutcome>((resolve) => {
      control.finish = resolve;
    });
  });
  return { postTurn, control };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useChatRoom: loading', () => {
  it('loads the room on mount and becomes idle', async () => {
    const client = fakeClient({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(SAVED)) });

    const { result } = renderHook(() => useChatRoom('reglead', { client, nameOf }));

    expect(result.current.phase).toBe('loading');
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(client.getMessages).toHaveBeenCalledWith('reglead', expect.anything());
    expect(result.current.timeline.map(show)).toEqual(['you: Hello Rosa', 'Rosa [complete]: Full reply']);
    expect(result.current.busy).toBe(false);
  });

  it('does not fetch again when re-rendered with a new client object', async () => {
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(SAVED));
    const { result, rerender } = renderHook(() => useChatRoom('reglead', { client: { ...fakeClient(), getMessages }, nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    rerender();
    rerender();
    await act(async () => undefined);

    expect(getMessages).toHaveBeenCalledTimes(1);
  });

  it('shows a load error with its reference, and recovers on reload', async () => {
    const getMessages = vi
      .fn<ChatApi['getMessages']>()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        error: { error: 'internal', message: 'Something went wrong.', correlationId: 'corr-1' },
        message: 'Something went wrong.',
      })
      .mockResolvedValueOnce(ok(SAVED));
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ getMessages }), nameOf }));

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.loadError).toEqual({ message: 'Something went wrong.', correlationId: 'corr-1' });

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.loadError).toBeNull();
    expect(result.current.timeline).toHaveLength(2);
  });

  it('shows a running turn as in progress and polls every 2 seconds until it ends', async () => {
    vi.useFakeTimers();
    const getMessages = vi
      .fn<ChatApi['getMessages']>()
      .mockResolvedValueOnce(ok(RUNNING))
      .mockResolvedValueOnce(ok(RUNNING))
      .mockResolvedValueOnce(ok(SAVED));
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ getMessages }), nameOf }));

    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.phase).toBe('polling');
    expect(result.current.busy).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(getMessages).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('polling');

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(getMessages).toHaveBeenCalledTimes(3);
    expect(result.current.phase).toBe('idle');

    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(getMessages).toHaveBeenCalledTimes(3);
  });
});

describe('useChatRoom: sending', () => {
  it('streams events into live bubbles, then reloads the room from the API', async () => {
    const { postTurn, control } = controlledPostTurn();
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValueOnce(ok(EMPTY)).mockResolvedValueOnce(ok(SAVED));
    const { result } = renderHook(() =>
      useChatRoom('reglead', { client: fakeClient({ postTurn, getMessages }), nameOf, soloAgentId: 'reglead' }),
    );
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let sending: Promise<SendOutcome> = Promise.resolve({ status: 'ignored' });
    act(() => {
      sending = result.current.send('Hello Rosa');
    });
    expect(result.current.phase).toBe('sending');
    expect(result.current.busy).toBe(true);
    expect(result.current.timeline.map(show)).toEqual(['you: Hello Rosa', 'Rosa [thinking]: ']);

    act(() => {
      control.handlers.onResponse?.(200);
      control.handlers.onEvent?.({
        type: 'turn',
        turnId: 't1',
        threadId: 'th1',
        roomId: 'reglead',
        clientTurnId: 'c1',
        userMessageId: 'u1',
        startedAt: '2026-10-07T09:00:00.000Z',
      });
      control.handlers.onEvent?.({ type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'solo' });
      control.handlers.onEvent?.({ type: 'delta', messageId: 'm1', text: 'Full ' });
    });
    expect(result.current.phase).toBe('streaming');
    expect(result.current.timeline.map(show)).toEqual(['you: Hello Rosa', 'Rosa [streaming]: Full ']);

    await act(async () => {
      control.finish(STREAM_DONE);
      await sending;
    });

    await expect(sending).resolves.toEqual({ status: 'sent' });
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('idle');
    expect(result.current.timeline.map(show)).toEqual(['you: Hello Rosa', 'Rosa [complete]: Full reply']);
  });

  it('ignores a second send while a turn runs (a double click sends once)', async () => {
    const { postTurn } = controlledPostTurn();
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ postTurn }), nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let second: Promise<SendOutcome> = Promise.resolve({ status: 'sent' });
    act(() => {
      void result.current.send('Once');
      second = result.current.send('Once');
    });

    await expect(second).resolves.toEqual({ status: 'ignored' });
    expect(postTurn).toHaveBeenCalledTimes(1);
  });

  it('when the stream is lost before done, polls the API and never sends again', async () => {
    vi.useFakeTimers();
    const getMessages = vi
      .fn<ChatApi['getMessages']>()
      .mockResolvedValueOnce(ok(EMPTY))
      .mockResolvedValueOnce(ok(SAVED));
    const postTurn = vi
      .fn<ChatApi['postTurn']>()
      .mockResolvedValue({ kind: 'stream', clientTurnId: 'c1', done: null, broken: true });
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ getMessages, postTurn }), nameOf }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Hello Rosa');
    });

    expect(outcome).toEqual({ status: 'sent' });
    expect(result.current.phase).toBe('polling');
    expect(result.current.notice?.tone).toBe('info');

    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBeNull();
    expect(postTurn).toHaveBeenCalledTimes(1);
    expect(result.current.timeline.map(show)).toEqual(['you: Hello Rosa', 'Rosa [complete]: Full reply']);
  });

  it('a busy room (409) leaves the text unsent and follows the running turn', async () => {
    const postTurn = vi.fn<ChatApi['postTurn']>().mockResolvedValue({
      kind: 'rejected',
      clientTurnId: 'c1',
      status: 409,
      error: { error: 'room_busy', message: 'A turn is running in this room.', correlationId: 'corr-2', runningTurnId: 't0' },
    });
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ postTurn }), nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Too soon');
    });

    expect(outcome).toMatchObject({ status: 'not_sent' });
    expect(result.current.phase).toBe('polling');
    expect(result.current.timeline).toEqual([]);
  });

  it('a setup refusal (503) reports the setup problem and leaves the text unsent', async () => {
    const onSetupProblem = vi.fn();
    const postTurn = vi.fn<ChatApi['postTurn']>().mockResolvedValue({
      kind: 'rejected',
      clientTurnId: 'c1',
      status: 503,
      error: { error: 'llm_not_configured', message: 'Not set up.', correlationId: 'corr-3' },
    });
    const { result } = renderHook(() =>
      useChatRoom('reglead', { client: fakeClient({ postTurn }), nameOf, onSetupProblem }),
    );
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Hello');
    });

    expect(outcome).toMatchObject({ status: 'not_sent' });
    expect(onSetupProblem).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toMatchObject({ tone: 'error', correlationId: 'corr-3' });
  });

  it.each([
    ['llm_auth', 1],
    ['llm_model', 1],
    ['llm_outage', 0],
  ] as const)('a reply that fails with %s asks for the setup state again %i time(s)', async (code, times) => {
    const onSetupProblem = vi.fn();
    const { postTurn, control } = controlledPostTurn();
    const { result } = renderHook(() =>
      useChatRoom('reglead', { client: fakeClient({ postTurn }), nameOf, soloAgentId: 'reglead', onSetupProblem }),
    );
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    act(() => {
      void result.current.send('Hello Rosa');
    });
    act(() => {
      control.handlers.onResponse?.(200);
      control.handlers.onEvent?.({ type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'solo' });
      control.handlers.onEvent?.({ type: 'error', code, correlationId: 'corr-6', messageId: 'm1' });
    });

    expect(onSetupProblem).toHaveBeenCalledTimes(times);
    await act(async () => control.finish(STREAM_DONE));
  });

  it('after a network failure, checks the API: nothing saved means not sent', async () => {
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(EMPTY));
    const postTurn = vi
      .fn<ChatApi['postTurn']>()
      .mockResolvedValue({ kind: 'network_error', clientTurnId: 'c1', message: 'Could not reach the server.' });
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ getMessages, postTurn }), nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Hello');
    });

    expect(outcome).toMatchObject({ status: 'not_sent' });
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(result.current.notice?.tone).toBe('error');
    expect(result.current.timeline).toEqual([]);
  });

  it('after a network failure, checks the API: a running turn means it was sent', async () => {
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValueOnce(ok(EMPTY)).mockResolvedValue(ok(RUNNING));
    const postTurn = vi
      .fn<ChatApi['postTurn']>()
      .mockResolvedValue({ kind: 'network_error', clientTurnId: 'c1', message: 'Could not reach the server.' });
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ getMessages, postTurn }), nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Hello Rosa');
    });

    expect(outcome).toEqual({ status: 'sent' });
    expect(result.current.phase).toBe('polling');
    expect(postTurn).toHaveBeenCalledTimes(1);
  });
});

describe('useChatRoom: never stuck', () => {
  it('an unexpected failure while sending leaves the room usable and the text unsent', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const postTurn = vi.fn<ChatApi['postTurn']>().mockRejectedValue(new Error('unexpected'));
    const client = fakeClient({ postTurn });
    const { result } = renderHook(() => useChatRoom('reglead', { client, nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let outcome: SendOutcome | undefined;
    await act(async () => {
      outcome = await result.current.send('Hello');
    });

    expect(outcome).toMatchObject({ status: 'not_sent' });
    expect(result.current.phase).toBe('idle');
    expect(result.current.busy).toBe(false);
    expect(logged).toHaveBeenCalled();
  });

  it('a messages request that rejects shows the load error instead of loading forever', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const getMessages = vi.fn<ChatApi['getMessages']>().mockRejectedValue(new Error('unexpected'));
    const client = fakeClient({ getMessages });
    const { result } = renderHook(() => useChatRoom('reglead', { client, nameOf }));

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.loadError?.message).toMatch(/could not load/i);
    expect(logged).toHaveBeenCalled();
  });
});

describe('useChatRoom: new conversation', () => {
  it('archives the thread and reloads the empty room', async () => {
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValueOnce(ok(SAVED)).mockResolvedValueOnce(ok(EMPTY));
    const client = fakeClient({ getMessages });
    const { result } = renderHook(() => useChatRoom('reglead', { client, nameOf }));
    await waitFor(() => expect(result.current.timeline).toHaveLength(2));

    await act(async () => {
      await result.current.newConversation();
    });

    expect(client.newConversation).toHaveBeenCalledWith('reglead');
    expect(result.current.timeline).toEqual([]);
    expect(result.current.phase).toBe('idle');
  });

  it('drops a reply kept from the old thread (cut off, never saved) once the new conversation loads', async () => {
    const interrupted = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Hello Rosa', seq: 1 })],
      [makeTurn({ id: 't1', roomId: 'reglead', status: 'interrupted' })],
      'reglead',
    );
    const fresh: RoomMessagesResponse = { ...roomData([], [], 'reglead'), thread: { ...THREAD, id: 'th2', roomId: 'reglead' } };
    const { postTurn, control } = controlledPostTurn();
    const getMessages = vi
      .fn<ChatApi['getMessages']>()
      .mockResolvedValueOnce(ok(EMPTY))
      .mockResolvedValueOnce(ok(interrupted))
      .mockResolvedValueOnce(ok(fresh));
    const { result } = renderHook(() =>
      useChatRoom('reglead', { client: fakeClient({ postTurn, getMessages }), nameOf, soloAgentId: 'reglead', pollIntervalMs: 5 }),
    );
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    // A reply streams, then the server restarts: the stream breaks and the reply is never saved.
    let sending: Promise<SendOutcome> = Promise.resolve({ status: 'ignored' });
    act(() => {
      sending = result.current.send('Hello Rosa');
    });
    act(() => {
      control.handlers.onResponse?.(200);
      control.handlers.onEvent?.({ type: 'turn', turnId: 't1', threadId: 'th1', roomId: 'reglead', clientTurnId: 'c1', userMessageId: 'u1', startedAt: '2026-10-07T09:00:00.000Z' });
      control.handlers.onEvent?.({ type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'solo' });
      control.handlers.onEvent?.({ type: 'delta', messageId: 'm1', text: 'Partial reply' });
    });
    await act(async () => {
      control.finish({ kind: 'stream', clientTurnId: 'c1', done: null, broken: true });
      await sending;
    });
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.timeline.map(show)).toContain('Rosa [partial]: Partial reply');

    await act(async () => {
      await result.current.newConversation();
    });

    expect(result.current.data?.thread.id).toBe('th2');
    expect(result.current.timeline).toEqual([]);
  });

  it('is busy while the new conversation is being started, so the composer takes no text that could be lost', async () => {
    let finish: (value: ApiResult<NewThreadResponse>) => void = () => undefined;
    const newConversation = vi.fn<ChatApi['newConversation']>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useChatRoom('reglead', { client: fakeClient({ newConversation }), nameOf }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    let starting: Promise<boolean> = Promise.resolve(false);
    act(() => {
      starting = result.current.newConversation();
    });

    expect(result.current.busy).toBe(true);
    await act(async () => {
      finish(ok({ thread: THREAD, archivedThreadId: 'th0' }));
      await starting;
    });
    expect(result.current.busy).toBe(false);
  });

  it('keeps the thread and says why when a turn is still running', async () => {
    const newConversation = vi.fn<ChatApi['newConversation']>().mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: 'room_busy', message: 'A turn is running in this room.', correlationId: 'corr-4' },
      message: 'A turn is running in this room.',
    });
    const getMessages = vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(SAVED));
    const { result } = renderHook(() =>
      useChatRoom('reglead', { client: fakeClient({ getMessages, newConversation }), nameOf }),
    );
    await waitFor(() => expect(result.current.phase).toBe('idle'));

    await act(async () => {
      await result.current.newConversation();
    });

    expect(result.current.timeline).toHaveLength(2);
    expect(result.current.notice).toMatchObject({ text: expect.stringMatching(/running/i) });
    expect(result.current.busy).toBe(false);
  });
});
