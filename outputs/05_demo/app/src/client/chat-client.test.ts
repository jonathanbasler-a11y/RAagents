import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@/shared/contracts';
import { createChatClient, createClientTurnId } from './chat-client';

const encoder = new TextEncoder();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function frame(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Splits text into pieces of `size` characters, so chunk boundaries fall mid-line and mid-JSON. */
function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function sseResponse(chunks: string[], failWith?: Error): Response {
  const queue = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (failWith) controller.error(failWith);
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const TURN: ChatEvent = {
  type: 'turn',
  turnId: 't1',
  threadId: 'th1',
  roomId: 'team',
  clientTurnId: 'cid-1',
  userMessageId: 'u1',
  startedAt: '2026-10-07T09:00:00.000Z',
};
const START: ChatEvent = { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' };
const DELTA_1: ChatEvent = { type: 'delta', messageId: 'm1', text: 'First, ' };
const DELTA_2: ChatEvent = { type: 'delta', messageId: 'm1', text: 'check the designation.' };
const END: ChatEvent = { type: 'agent_end', messageId: 'm1', status: 'complete', truncated: false };
const DONE: ChatEvent = { type: 'done', turnId: 't1', status: 'done' };

function client(fetchImpl: typeof fetch, ids: string[] = ['cid-1', 'cid-2', 'cid-3']) {
  const queue = [...ids];
  return createChatClient({
    fetch: fetchImpl,
    newClientTurnId: () => queue.shift() ?? 'cid-extra',
    timeZone: () => 'Europe/Paris',
    sleep: async () => undefined,
  });
}

function bodyOf(call: Parameters<typeof fetch>): unknown {
  return JSON.parse(String(call[1]?.body));
}

function headerOf(call: Parameters<typeof fetch>, name: string): string | null {
  return new Headers(call[1]?.headers).get(name);
}

describe('postTurn', () => {
  it('POSTs only the trimmed text, a client turn id and the time zone, as JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([frame(DONE)]));

    await client(fetchImpl).postTurn('team', '  Hello team \n');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toBe('/api/rooms/team/turns');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'content-type')).toBe('application/json');
    expect(bodyOf(call)).toEqual({ text: 'Hello team', clientTurnId: 'cid-1', tz: 'Europe/Paris' });
  });

  it('uses a random UUID and the browser time zone by default', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([frame(DONE)]));

    await createChatClient({ fetch: fetchImpl }).postTurn('reglead', 'Hi');

    const body = bodyOf(fetchImpl.mock.calls[0]) as { clientTurnId: string; tz: string };
    expect(body.clientTurnId).toMatch(UUID_V4);
    expect(body.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('sends UTC when the browser cannot tell its time zone ("Etc/Unknown"), which the server would refuse', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([frame(DONE)]));
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: 'Etc/Unknown' }) }) as unknown as Intl.DateTimeFormat,
    );

    await createChatClient({ fetch: fetchImpl }).postTurn('reglead', 'Hi');

    expect((bodyOf(fetchImpl.mock.calls[0]) as { tz: string }).tz).toBe('UTC');
  });

  it('gives every turn its own client turn id', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => sseResponse([frame(DONE)]));
    const chat = client(fetchImpl);

    await chat.postTurn('team', 'One');
    await chat.postTurn('team', 'Two');

    expect(bodyOf(fetchImpl.mock.calls[0])).toMatchObject({ clientTurnId: 'cid-1' });
    expect(bodyOf(fetchImpl.mock.calls[1])).toMatchObject({ clientTurnId: 'cid-2' });
  });

  it('delivers the events in order across chunk boundaries and reports done', async () => {
    const stream = [TURN, START, DELTA_1, DELTA_2, END, DONE].map(frame).join(': keep-alive\n\n');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(pieces(stream, 7)));
    const seen: string[] = [];

    const outcome = await client(fetchImpl).postTurn('team', 'Hello', {
      onResponse: (status) => seen.push(`response ${status}`),
      onEvent: (event) => seen.push(event.type === 'delta' ? `delta ${event.text}` : event.type),
    });

    expect(seen).toEqual([
      'response 200',
      'turn',
      'agent_start',
      'delta First, ',
      'delta check the designation.',
      'agent_end',
      'done',
    ]);
    expect(outcome).toEqual({ kind: 'stream', clientTurnId: 'cid-1', done: DONE, broken: false });
  });

  it('never re-POSTs after a 200, even when the stream breaks mid-reply', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse([frame(TURN), frame(START), frame(DELTA_1)], new TypeError('network error')));
    const events: ChatEvent[] = [];

    const outcome = await client(fetchImpl).postTurn('team', 'Hello', { onEvent: (event) => events.push(event) });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'stream', clientTurnId: 'cid-1', done: null, broken: true });
    expect(events.map((event) => event.type)).toEqual(['turn', 'agent_start', 'delta']);
  });

  it('never re-POSTs after a 200 whose stream ends without done', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([frame(TURN), frame(START)]));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'stream', clientTurnId: 'cid-1', done: null, broken: false });
  });

  it('retries once, with the same client turn id, when the request fails before any response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(sseResponse([frame(DONE)]));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchImpl.mock.calls[0])).toEqual(bodyOf(fetchImpl.mock.calls[1]));
    expect(bodyOf(fetchImpl.mock.calls[1])).toMatchObject({ clientTurnId: 'cid-1' });
    expect(outcome).toMatchObject({ kind: 'stream', done: DONE });
  });

  it('gives up after that one retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ kind: 'network_error', clientTurnId: 'cid-1' });
  });

  it('does not retry when the request was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError'));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello', {}, { signal: controller.signal });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'aborted', clientTurnId: 'cid-1' });
  });

  it.each([
    [409, { error: 'room_busy', message: 'A turn is running in this room.', correlationId: 'c-409', runningTurnId: 't0' }],
    [503, { error: 'llm_not_configured', message: 'The model connection is not set up.', correlationId: 'c-503' }],
  ])('returns an error response (%i) without retrying', async (status, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, body));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'rejected', clientTurnId: 'cid-1', status, error: body });
  });

  it('reports a JSON 200 for a client turn id the server has seen as a duplicate', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { duplicate: true, turnId: 't1', status: 'running' }));

    const outcome = await client(fetchImpl).postTurn('team', 'Hello');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'duplicate', clientTurnId: 'cid-1', turnId: 't1', status: 'running' });
  });

  it('refuses empty text and text over 8,000 characters without a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => sseResponse([frame(DONE)]));
    const chat = client(fetchImpl);

    expect(await chat.postTurn('team', '   ')).toMatchObject({ kind: 'invalid' });
    expect(await chat.postTurn('team', 'x'.repeat(8001))).toMatchObject({ kind: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();

    await chat.postTurn('team', `  ${'x'.repeat(8000)}  `);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('JSON helpers', () => {
  it('getMessages GETs the room messages without caching', async () => {
    const payload = { roomId: 'sp-orphan', thread: {}, messages: [], turns: [], runningTurn: null };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, payload));

    const result = await client(fetchImpl).getMessages('sp-orphan');

    expect(result).toEqual({ ok: true, data: payload });
    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toBe('/api/rooms/sp-orphan/messages');
    expect(call[1]?.method ?? 'GET').toBe('GET');
    expect(call[1]?.cache).toBe('no-store');
  });

  it('newConversation POSTs an empty JSON object to the room', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { thread: {}, archivedThreadId: 'old' }));

    await client(fetchImpl).newConversation('team');

    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toBe('/api/rooms/team/new');
    expect(call[1]?.method).toBe('POST');
    expect(headerOf(call, 'content-type')).toBe('application/json');
    expect(bodyOf(call)).toEqual({});
  });

  it('setSelection POSTs one switch; getSelection and getHealth GET their routes', async () => {
    const selection = { workspaceId: 'demo', selected: ['reglead'], source: 'saved' };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(200, selection));
    const chat = client(fetchImpl);

    await chat.setSelection('label', true);
    await chat.getSelection();
    await chat.getHealth();

    const [post, getSel, getHealth] = fetchImpl.mock.calls;
    expect(post[0]).toBe('/api/selection');
    expect(post[1]?.method).toBe('POST');
    expect(headerOf(post, 'content-type')).toBe('application/json');
    expect(bodyOf(post)).toEqual({ agentId: 'label', selected: true });
    expect(getSel[0]).toBe('/api/selection');
    expect(getSel[1]?.method ?? 'GET').toBe('GET');
    expect(getHealth[0]).toBe('/api/health');
  });

  it('returns the error body and its message for an error status', async () => {
    const body = { error: 'locked_agent', message: 'Team roles are always on.', correlationId: 'c-1' };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(409, body));

    const result = await client(fetchImpl).setSelection('orc', false);

    expect(result).toEqual({ ok: false, status: 409, error: body, message: 'Team roles are always on.' });
  });

  it('returns status 0 and a generic message when the server cannot be reached', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await client(fetchImpl).getHealth();

    expect(result).toMatchObject({ ok: false, status: 0, error: null });
    expect(result.ok === false && result.message).toMatch(/could not reach the server/i);
  });

  it('does not trust an error body that is not an API error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));

    const result = await client(fetchImpl).getMessages('team');

    expect(result).toMatchObject({ ok: false, status: 502, error: null });
    expect(result.ok === false && result.message).not.toContain('<html>');
  });
});

describe('createClientTurnId', () => {
  it('uses crypto.randomUUID when it exists', () => {
    expect(createClientTurnId({ randomUUID: () => 'from-random-uuid', getRandomValues: (array) => array })).toBe(
      'from-random-uuid',
    );
  });

  it('builds a version 4 UUID from getRandomValues where randomUUID is missing (plain-HTTP pages)', () => {
    const id = createClientTurnId({
      getRandomValues: <T extends ArrayBufferView | null>(array: T) => {
        if (array instanceof Uint8Array) array.fill(0xab);
        return array;
      },
    });

    expect(id).toMatch(UUID_V4);
  });
});
