import { describe, expect, it } from 'vitest';
import { createLlmClient, LlmError } from './index';
import {
  USER_ONLY,
  captureLogs,
  completionResponse,
  createFakeFetch,
  fetchFailed,
  hangUntilAborted,
  recordingSleep,
  brokenBodyResponse,
  socketClosed,
  systemError,
  testConfig,
  textResponse,
  type FakeStep,
} from './test-support/fake-gateway';

const NOW = Date.parse('2026-10-07T12:00:00Z');

function setup(steps: FakeStep[], options: { timeoutMs?: number; random?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const config = testConfig(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs });
  const { fetch, calls } = createFakeFetch(steps);
  const recorder = recordingSleep();
  const client = createLlmClient({
    config,
    fetch,
    sleep: options.sleep ?? recorder.sleep,
    random: options.random ?? (() => 0.5),
    now: () => NOW,
  });
  return { client, calls, delays: recorder.delays, config, fetch };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

const unavailable = () => textResponse('{"error":{"message":"upstream unavailable"}}', 503);

describe('retries', () => {
  it.each([500, 502, 503, 504])('retries a %i and returns the next answer', async (status) => {
    const { client, calls, delays } = setup([textResponse('{"error":"server error"}', status), completionResponse('Back')]);
    captureLogs();

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThan(0);
  });

  it('retries a 429 and a 408', async () => {
    const { client, calls } = setup([
      textResponse('{"error":"slow down"}', 429),
      textResponse('{"error":"request timeout"}', 408),
      completionResponse('Back'),
    ]);
    captureLogs();

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(3);
  });

  it('makes at most 3 attempts, then reports the outage with the attempt count', async () => {
    const { client, calls, delays } = setup([unavailable(), unavailable(), unavailable()]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'outage', status: 503, permanent: false });
    expect(error.message).toContain('3 attempts');
    expect(calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
  });

  it('spreads retries with random jitter and keeps the total sleep within about 4 seconds', async () => {
    const low = setup([unavailable(), unavailable(), unavailable()], { random: () => 0 });
    const high = setup([unavailable(), unavailable(), unavailable()], { random: () => 0.999 });
    captureLogs();

    await failure(low.client.complete({ messages: USER_ONLY }));
    await failure(high.client.complete({ messages: USER_ONLY }));

    expect(low.delays).not.toEqual(high.delays);
    for (const delays of [low.delays, high.delays]) {
      expect(delays.every((ms) => ms > 0)).toBe(true);
      expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(4000);
    }
  });

  it('logs each retry with the same correlation id as the final error', async () => {
    const { client } = setup([unavailable(), unavailable(), unavailable()]);
    const logs = captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(logs.warnings()).toHaveLength(2);
    for (const line of logs.warnings()) expect(line).toContain(error.correlationId);
  });
});

describe('Retry-After', () => {
  it('waits as long as Retry-After asks, in seconds', async () => {
    const { client, delays } = setup([textResponse('{}', 429, { 'retry-after': '2' }), completionResponse('Back')]);
    captureLogs();

    await client.complete({ messages: USER_ONLY });

    expect(delays).toEqual([2000]);
  });

  it('reads retry-after-ms', async () => {
    const { client, delays } = setup([textResponse('{}', 429, { 'retry-after-ms': '1500' }), completionResponse('Back')]);
    captureLogs();

    await client.complete({ messages: USER_ONLY });

    expect(delays).toEqual([1500]);
  });

  it('reads Retry-After as an HTTP date against the injected clock', async () => {
    const at = new Date(NOW + 3000).toUTCString();
    const { client, delays } = setup([textResponse('{}', 503, { 'retry-after': at }), completionResponse('Back')]);
    captureLogs();

    await client.complete({ messages: USER_ONLY });

    expect(delays).toEqual([3000]);
  });

  it('gives up at once, honestly, when Retry-After exceeds the retry budget', async () => {
    const { client, calls, delays } = setup([textResponse('{}', 429, { 'retry-after': '30' })]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'rate_limit', status: 429, retryAfterMs: 30_000 });
    expect(error.message).toContain('30 s');
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('stops once the waits so far would push past the budget', async () => {
    const wait = () => textResponse('{}', 429, { 'retry-after-ms': '2500' });
    const { client, calls, delays } = setup([wait(), wait()]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('rate_limit');
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([2500]);
  });

  it('does not wait past the call deadline', async () => {
    const { client, calls, delays } = setup([textResponse('{}', 429, { 'retry-after': '1' })], { timeoutMs: 500 });
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('rate_limit');
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });
});

describe('connection errors, classified through the cause chain', () => {
  it.each([
    ['ECONNRESET', fetchFailed(systemError('ECONNRESET', 'read ECONNRESET'))],
    ['EPIPE', fetchFailed(systemError('EPIPE', 'write EPIPE'))],
    ['a socket closed mid-response', socketClosed()],
  ])('retries a connection reset (%s)', async (_name, error) => {
    const { client, calls } = setup([error, completionResponse('Back')]);
    captureLogs();

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
  });

  it('retries when the reply body breaks while it is read', async () => {
    const { client, calls } = setup([brokenBodyResponse(200, socketClosed()), completionResponse('Back')]);
    captureLogs();

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
  });

  it('retries a connect timeout and reports it as a timeout when it persists', async () => {
    const timeout = () => fetchFailed(systemError('UND_ERR_CONNECT_TIMEOUT', 'Connect Timeout Error (attempted address: 10.1.2.3:443, timeout: 10000ms)'));
    const { client, calls } = setup([timeout(), timeout(), timeout()]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('timeout');
    expect(calls).toHaveLength(3);
  });

  it('looks inside AggregateError members (one error per address tried)', async () => {
    const dualStack = fetchFailed(
      new AggregateError([
        systemError('ETIMEDOUT', 'connect ETIMEDOUT 10.1.2.3:443'),
        systemError('ENETUNREACH', 'connect ENETUNREACH fd00::1:443'),
      ]),
    );
    const { client, calls } = setup([dualStack, completionResponse('Back')]);
    captureLogs();

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])('never retries a DNS failure (%s)', async (code) => {
    const { client, calls, delays } = setup([fetchFailed(systemError(code, `getaddrinfo ${code} gateway.example.test`))]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'dns', permanent: false });
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it.each(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'never retries a TLS failure (%s)',
    async (code) => {
      const { client, calls } = setup([fetchFailed(systemError(code, 'certificate problem'))]);
      captureLogs();

      const error = await failure(client.complete({ messages: USER_ONLY }));

      expect(error).toMatchObject({ kind: 'tls', permanent: false });
      expect(calls).toHaveLength(1);
    },
  );

  it('reports the port fetch refuses as a config problem and never retries it', async () => {
    const { client, calls } = setup([fetchFailed(new Error('bad port'))]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('config');
    expect(error.message).toContain('LLM_BASE_URL');
    expect(calls).toHaveLength(1);
  });

  it('does not retry a refused connection', async () => {
    const { client, calls } = setup([fetchFailed(systemError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:4010'))]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('network');
    expect(calls).toHaveLength(1);
  });

  it('does not remember a DNS failure: the next call tries again', async () => {
    const { client, calls } = setup([fetchFailed(systemError('ENOTFOUND', 'getaddrinfo ENOTFOUND gateway.example.test')), completionResponse('Back')]);
    captureLogs();

    await failure(client.complete({ messages: USER_ONLY }));
    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
  });
});

describe('deadlines', () => {
  it('gives each call a deadline: a reply that never comes ends as a timeout, without a retry', async () => {
    const { client, calls } = setup([hangUntilAborted], { timeoutMs: 30 });
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'timeout', permanent: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it('does not remember a timeout: the next call tries again', async () => {
    const { client, calls } = setup([hangUntilAborted, completionResponse('Back')], { timeoutMs: 30 });
    captureLogs();

    await failure(client.complete({ messages: USER_ONLY }));
    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Back');
    expect(calls).toHaveLength(2);
  });

  it("stops when the caller's signal aborts, and reports a timeout", async () => {
    const turn = new AbortController();
    const { client, calls } = setup([
      (call) => {
        setTimeout(() => turn.abort(), 5);
        return hangUntilAborted(call);
      },
    ]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY, signal: turn.signal }));

    expect(error.kind).toBe('timeout');
    expect(calls).toHaveLength(1);
  });

  it("makes no call when the caller's signal has already aborted", async () => {
    const turn = new AbortController();
    turn.abort();
    const { client, calls } = setup([]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY, signal: turn.signal }));

    expect(error.kind).toBe('timeout');
    expect(calls).toHaveLength(0);
  });

  it('cuts a retry wait short when the caller aborts during it', async () => {
    const turn = new AbortController();
    const { client, calls } = setup([unavailable()], {
      sleep: () => {
        setTimeout(() => turn.abort(), 5);
        return new Promise<void>(() => {});
      },
    });
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY, signal: turn.signal }));

    expect(error.kind).toBe('timeout');
    expect(calls).toHaveLength(1);
  });
});
