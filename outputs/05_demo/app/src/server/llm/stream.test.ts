import { describe, expect, it } from 'vitest';
import type { LlmStreamEvent } from '@/shared/contracts';
import { createLlmClient, LlmError } from './index';
import {
  DONE_EVENT,
  REPORTED_MODEL,
  USAGE_EVENT,
  USER_ONLY,
  captureLogs,
  chunkEvent,
  collect,
  createFakeFetch,
  socketClosed,
  sseResponse,
  testConfig,
  textResponse,
  type FakeStep,
} from './test-support/fake-gateway';

function setup(steps: FakeStep[], overrides: Parameters<typeof testConfig>[0] = {}) {
  const config = testConfig(overrides);
  const { fetch, calls } = createFakeFetch(steps);
  const delays: number[] = [];
  const client = createLlmClient({
    config,
    fetch,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5,
    now: () => 1_760_000_000_000,
  });
  return { client, calls, delays, config };
}

const deltas = (events: LlmStreamEvent[]) => events.flatMap((event) => (event.type === 'delta' ? [event.text] : []));

function endOf(events: LlmStreamEvent[]) {
  const last = events[events.length - 1];
  if (last?.type !== 'end') throw new Error('the stream did not end with an end event');
  expect(events.filter((event) => event.type === 'end')).toHaveLength(1);
  return last.result;
}

async function streamFailure(events: AsyncIterable<LlmStreamEvent>): Promise<{ error: LlmError; seen: LlmStreamEvent[] }> {
  const seen: LlmStreamEvent[] = [];
  try {
    for await (const event of events) seen.push(event);
  } catch (error) {
    if (error instanceof LlmError) return { error, seen };
    throw error;
  }
  throw new Error('expected the stream to fail');
}

/** Cuts a text into pieces of `size` bytes, so events, "data:" prefixes and characters split anywhere. */
function bytesOf(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) pieces.push(bytes.slice(i, i + size));
  return pieces;
}

const HELLO = [chunkEvent('', { role: true }), chunkEvent('Hel'), chunkEvent('lo'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT];

describe('stream(): the request', () => {
  it('asks for an event stream with stream: true', async () => {
    const { client, calls } = setup([(call) => sseResponse(HELLO, { signal: call.signal })]);

    await collect(client.stream({ messages: USER_ONLY }));

    expect(calls[0].body).toMatchObject({ model: 'vendor-a.model-1', stream: true, max_tokens: 1500 });
    expect(calls[0].headers.get('accept')).toBe('text/event-stream');
  });
});

describe('stream(): parsing', () => {
  it('yields the deltas in order, then one end with the whole text, the finish reason and the reported model', async () => {
    const { client } = setup([(call) => sseResponse(HELLO, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(deltas(events)).toEqual(['Hel', 'lo']);
    expect(endOf(events)).toEqual({ text: 'Hello', finishReason: 'stop', truncated: false, partial: false, model: REPORTED_MODEL });
  });

  it('reassembles events, "data:" prefixes and multi-byte characters split across reads', async () => {
    const wire = [chunkEvent('Grüße, '), chunkEvent('naïve café '), chunkEvent('✓'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT].join('');
    const { client } = setup([(call) => sseResponse(bytesOf(wire, 7), { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Grüße, naïve café ✓', partial: false });
  });

  it('accepts CRLF line endings', async () => {
    const wire = HELLO.map((event) => event.replace(/\n/g, '\r\n'));
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', finishReason: 'stop', partial: false });
  });

  it('joins a data field spread over several lines, even when each CRLF is cut between reads', async () => {
    const wire =
      'data: {"choices":[{"index":0,\r\ndata: "delta":{"content":"Hi"}}]}\r\n\r\n' +
      chunkEvent(null, { finishReason: 'stop' }).replace(/\n/g, '\r\n') +
      'data: [DONE]\r\n\r\n';
    const { client } = setup([(call) => sseResponse(bytesOf(wire, 1), { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hi', finishReason: 'stop', partial: false });
  });

  it('ignores ":" keep-alive comment lines', async () => {
    const wire = [': keep-alive\n\n', chunkEvent('Hel'), ':\n\n', ': ping\n', chunkEvent('lo'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT];
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: false });
  });

  it('skips a usage chunk whose choices are empty', async () => {
    const wire = [chunkEvent('Hello'), chunkEvent(null, { finishReason: 'stop' }), USAGE_EVENT, DONE_EVENT];
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', finishReason: 'stop', partial: false });
  });

  it('stops at [DONE]: nothing after it is read into the answer', async () => {
    const wire = [chunkEvent('Hello'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT, chunkEvent(' extra')];
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events).text).toBe('Hello');
  });

  it.each(['length', 'max_tokens'])('marks finish reason %s as truncated', async (reason) => {
    const wire = [chunkEvent('Hello th'), chunkEvent(null, { finishReason: reason }), DONE_EVENT];
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello th', finishReason: reason, truncated: true, partial: false });
  });

  it('holds back leading whitespace until real text arrives, then keeps it', async () => {
    const wire = [chunkEvent('\n\n'), chunkEvent('Hi'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT];
    const { client } = setup([(call) => sseResponse(wire, { signal: call.signal })]);

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(deltas(events)).toEqual(['\n\nHi']);
    expect(endOf(events).text).toBe('\n\nHi');
  });
});

describe('stream(): partial and failed answers', () => {
  it('marks the answer partial, keeping the text, when the stream ends without [DONE]', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('Hello'), chunkEvent(' wor')], { signal: call.signal })]);
    const logs = captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello wor', partial: true, errorKind: 'network' });
    expect(logs.warnings().join('\n')).toContain('partial');
  });

  it('gives a partial answer the correlation id of the log line that says why it broke off', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('Hello')], { signal: call.signal, end: { error: socketClosed() } })]);
    const logs = captureLogs();

    const result = endOf(await collect(client.stream({ messages: USER_ONLY })));

    expect(result.correlationId).toEqual(expect.any(String));
    expect(logs.warnings().join('\n')).toContain(`answer is partial (correlation ${result.correlationId})`);
  });

  it('marks the answer partial when an error object arrives mid-stream, and logs it redacted', async () => {
    const { client, config } = setup([
      (call) => {
        // A careless provider echoes the key it received.
        const echoedKey = (call.headers.get('authorization') ?? '').replace('Bearer ', '');
        const failure = `data: {"error":{"message":"overloaded at 10.9.8.7 for key ${echoedKey}"}}\n\n`;
        return sseResponse([chunkEvent('Hello'), failure, DONE_EVENT], { signal: call.signal });
      },
    ]);
    const logs = captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: true, errorKind: 'outage' });
    expect(logs.all()).toContain('overloaded');
    expect(logs.all()).not.toContain('10.9.8.7');
    expect(logs.all()).not.toContain(config.apiKey);
  });

  it('marks the answer partial when a data line is not JSON', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('Hello'), 'data: {"choices": [\n\n', DONE_EVENT], { signal: call.signal })]);
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: true, errorKind: 'outage' });
  });

  it('never retries after the first token: a reset mid-answer ends it as partial', async () => {
    const { client, calls } = setup([(call) => sseResponse([chunkEvent('Hello')], { signal: call.signal, end: { error: socketClosed() } })]);
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: true, errorKind: 'network' });
    expect(calls).toHaveLength(1);
  });

  it('retries a reset that happens before the first token', async () => {
    const { client, calls } = setup([
      (call) => sseResponse([chunkEvent('', { role: true })], { signal: call.signal, end: { error: socketClosed() } }),
      (call) => sseResponse(HELLO, { signal: call.signal }),
    ]);
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(deltas(events)).toEqual(['Hel', 'lo']);
    expect(endOf(events).partial).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('retries a 503 before the stream starts', async () => {
    const { client, calls } = setup([textResponse('{"error":"unavailable"}', 503), (call) => sseResponse(HELLO, { signal: call.signal })]);
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events).text).toBe('Hello');
    expect(calls).toHaveLength(2);
  });

  it('retries when an error object arrives before any text', async () => {
    const { client, calls } = setup([
      (call) => sseResponse(['data: {"error":{"message":"overloaded"}}\n\n'], { signal: call.signal }),
      (call) => sseResponse(HELLO, { signal: call.signal }),
    ]);
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events).text).toBe('Hello');
    expect(calls).toHaveLength(2);
  });

  it('throws before any delta when the stream carries no text at all', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('', { role: true }), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT], { signal: call.signal })]);
    captureLogs();

    const { error, seen } = await streamFailure(client.stream({ messages: USER_ONLY }));

    expect(error.kind).toBe('outage');
    expect(seen).toEqual([]);
  });

  it('throws before any delta when the text is only whitespace', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('  \n'), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT], { signal: call.signal })]);
    captureLogs();

    const { seen } = await streamFailure(client.stream({ messages: USER_ONLY }));

    expect(seen).toEqual([]);
  });

  it('throws a typed error before any delta on a refused key', async () => {
    const { client, calls } = setup([textResponse('{"error":"invalid key"}', 401)]);
    captureLogs();

    const { error, seen } = await streamFailure(client.stream({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'auth', permanent: true });
    expect(seen).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('ends as partial with a timeout when the call deadline passes mid-answer', async () => {
    const { client } = setup([(call) => sseResponse([chunkEvent('Hello')], { signal: call.signal, end: 'hang' })], { timeoutMs: 40 });
    captureLogs();

    const events = await collect(client.stream({ messages: USER_ONLY }));

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: true, errorKind: 'timeout' });
  });

  it("ends as partial with a timeout when the caller's signal aborts mid-answer", async () => {
    const turn = new AbortController();
    const { client } = setup([(call) => sseResponse([chunkEvent('Hello')], { signal: call.signal, end: 'hang' })]);
    captureLogs();

    const events: LlmStreamEvent[] = [];
    for await (const event of client.stream({ messages: USER_ONLY, signal: turn.signal })) {
      events.push(event);
      if (event.type === 'delta') turn.abort();
    }

    expect(endOf(events)).toMatchObject({ text: 'Hello', partial: true, errorKind: 'timeout' });
  });

  it('releases the connection when the reader stops early', async () => {
    let cancelled = false;
    const { client } = setup([
      (call) =>
        sseResponse([chunkEvent('Hello'), chunkEvent(' there')], {
          signal: call.signal,
          end: 'hang',
          onCancel: () => {
            cancelled = true;
          },
        }),
    ]);

    for await (const event of client.stream({ messages: USER_ONLY })) {
      if (event.type === 'delta') break;
    }

    expect(cancelled).toBe(true);
  });
});
