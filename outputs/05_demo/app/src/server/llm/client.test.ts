import { describe, expect, it } from 'vitest';
import type { LlmMessage } from '@/shared/contracts';
import { createLlmClient, LlmError } from './index';
import {
  REPORTED_MODEL,
  TEST_HOST,
  USER_ONLY,
  captureLogs,
  completionResponse,
  createFakeFetch,
  recordingSleep,
  testConfig,
  textResponse,
  type FakeStep,
} from './test-support/fake-gateway';

function setup(steps: FakeStep[], overrides: Parameters<typeof testConfig>[0] = {}) {
  const config = testConfig(overrides);
  const { fetch, calls } = createFakeFetch(steps);
  const { sleep, delays } = recordingSleep();
  const client = createLlmClient({ config, fetch, sleep, random: () => 0.5, now: () => 1_760_000_000_000 });
  return { config, client, calls, delays, fetch };
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

describe('complete(): the request', () => {
  it('posts the OpenAI chat-completions body to <base>/chat/completions with a Bearer key and the route token cap', async () => {
    const { client, calls, config } = setup([completionResponse('Hello there')]);
    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are a test persona.' },
      { role: 'user', content: 'Say hello.' },
    ];

    await client.complete({ messages });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://${TEST_HOST}/v1/chat/completions`);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${config.apiKey}`);
    expect(calls[0].headers.get('content-type')).toBe('application/json');
    expect(calls[0].body).toEqual({ model: 'vendor-a.model-1', messages, max_tokens: 1500 });
  });

  it('sends the raw key in the configured header instead of Authorization', async () => {
    const { client, calls, config } = setup([completionResponse('Hi')], { apiKeyHeader: 'x-gateway-key' });

    await client.complete({ messages: USER_ONLY });

    expect(calls[0].headers.get('x-gateway-key')).toBe(config.apiKey);
    expect(calls[0].headers.has('authorization')).toBe(false);
  });

  it('lets the request override the token cap and set a temperature', async () => {
    const { client, calls } = setup([completionResponse('Hi')]);

    await client.complete({ messages: USER_ONLY, maxTokens: 64, temperature: 0 });

    expect(calls[0].body).toMatchObject({ max_tokens: 64, temperature: 0 });
  });

  it('sends max_completion_tokens with reasoning off to gpt-* models, which refuse max_tokens', async () => {
    const { client, calls } = setup([completionResponse('Hi')], { model: 'gpt-5.6-test-model' });

    await client.complete({ messages: USER_ONLY });

    expect(calls[0].body).toEqual({
      model: 'gpt-5.6-test-model',
      messages: USER_ONLY,
      max_completion_tokens: 1500,
      reasoning_effort: 'none',
    });
  });

  it('keeps a query string on the base URL', async () => {
    const { client, calls } = setup([completionResponse('Hi')], {
      baseUrl: `https://${TEST_HOST}/v1?api-version=2026-01-01`,
    });

    await client.complete({ messages: USER_ONLY });

    expect(calls[0].url).toBe(`https://${TEST_HOST}/v1/chat/completions?api-version=2026-01-01`);
  });

  it('does not follow redirects, so a key never travels to another host', async () => {
    const { client, calls } = setup([textResponse('', 307, { location: 'https://elsewhere.example.test/v1' })]);

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(calls[0].redirect).toBe('manual');
    expect(error.kind).toBe('request');
    expect(calls).toHaveLength(1);
  });
});

describe('complete(): outgoing message validation', () => {
  it.each<[string, LlmMessage[]]>([
    ['no messages', []],
    ['an empty message', [{ role: 'user', content: '' }]],
    ['a whitespace-only message', [{ role: 'system', content: 'Rules.' }, { role: 'user', content: '  \n ' }]],
    ['an unknown role', [{ role: 'tool' as LlmMessage['role'], content: 'x' }]],
  ])('refuses %s with a request error and makes no call', async (_case, messages) => {
    const { client, calls } = setup([]);

    const error = await failure(client.complete({ messages }));

    expect(error.kind).toBe('request');
    expect(error.permanent).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a token cap that is not a positive whole number', async () => {
    const { client, calls } = setup([]);

    const error = await failure(client.complete({ messages: USER_ONLY, maxTokens: 0 }));

    expect(error.kind).toBe('request');
    expect(calls).toHaveLength(0);
  });
});

describe('complete(): the reply', () => {
  it('returns the text, the finish reason and the model the gateway reported', async () => {
    const { client } = setup([completionResponse('Hello there')]);

    await expect(client.complete({ messages: USER_ONLY })).resolves.toEqual({
      text: 'Hello there',
      finishReason: 'stop',
      truncated: false,
      partial: false,
      model: REPORTED_MODEL,
    });
  });

  it('falls back to the configured model id when the gateway reports none', async () => {
    const { client } = setup([completionResponse('Hi', { model: null })]);

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.model).toBe('vendor-a.model-1');
  });

  it('joins text parts when the content arrives as an array', async () => {
    const { client } = setup([
      completionResponse([
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'there' },
      ]),
    ]);

    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Hello there');
  });

  it.each(['length', 'max_tokens'])('marks finish reason %s as truncated and keeps the text', async (reason) => {
    const { client } = setup([completionResponse('Hello th', { finishReason: reason })]);

    const result = await client.complete({ messages: USER_ONLY });

    expect(result).toMatchObject({ text: 'Hello th', finishReason: reason, truncated: true, partial: false });
  });

  it('throws an outage error, without retrying, when the reply has no text', async () => {
    const { client, calls } = setup([completionResponse('   ')]);

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('outage');
    expect(calls).toHaveLength(1);
  });

  it('throws a request error when the output cap ran out before any text', async () => {
    const { client } = setup([completionResponse('', { finishReason: 'length' })]);

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('request');
  });

  it('throws an outage error, without retrying, when a 200 reply is not JSON', async () => {
    const { client, calls } = setup([new Response('<html>portal</html>', { status: 200 })]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error.kind).toBe('outage');
    expect(calls).toHaveLength(1);
  });
});

describe('complete(): HTTP errors', () => {
  it.each([401, 403])('treats %i as a permanent auth error and does not retry', async (status) => {
    const { client, calls } = setup([textResponse('{"error":{"message":"denied"}}', status)]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'auth', status, permanent: true });
    expect(calls).toHaveLength(1);
  });

  it.each([
    [412, '{"error":{"message":"Model vendor-a.model-1 is not allowed for this key"}}'],
    [404, '{"error":{"message":"The model `vendor-a.model-1` does not exist or you do not have access to it.","code":"model_not_found"}}'],
    [400, '{"error":{"message":"Invalid model: vendor-a.model-1"}}'],
  ])('treats %i that says the model is refused as a permanent model error', async (status, body) => {
    const { client, calls } = setup([textResponse(body, status)]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'model', status, permanent: true });
    expect(calls).toHaveLength(1);
  });

  it.each([
    [400, '{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model."}}'],
    [404, '<html><body>Not Found</body></html>'],
    [412, '{"error":{"message":"Precondition failed"}}'],
    [422, '{"error":{"message":"messages: field required"}}'],
  ])('treats %i that does not blame the model as a request error, not permanent and not retried', async (status, body) => {
    const { client, calls } = setup([textResponse(body, status)]);
    captureLogs();

    const error = await failure(client.complete({ messages: USER_ONLY }));

    expect(error).toMatchObject({ kind: 'request', status, permanent: false });
    expect(calls).toHaveLength(1);
  });

  it('keeps request errors apart from outages: a 400 is not retried, a 503 is', async () => {
    const refused = setup([textResponse('{"error":{"message":"bad request"}}', 400)]);
    const down = setup([textResponse('upstream unavailable', 503), completionResponse('Back')]);
    captureLogs();

    const error = await failure(refused.client.complete({ messages: USER_ONLY }));
    const result = await down.client.complete({ messages: USER_ONLY });

    expect(error.kind).toBe('request');
    expect(refused.calls).toHaveLength(1);
    expect(result.text).toBe('Back');
    expect(down.calls).toHaveLength(2);
  });
});

describe('complete(): permanent failures are remembered per process', () => {
  it('fails later calls for the same route and model at once, without a request, even from a new client', async () => {
    const config = testConfig();
    const { fetch, calls } = createFakeFetch([textResponse('{"error":"invalid key"}', 401)]);
    captureLogs();
    const first = createLlmClient({ config, fetch });
    const second = createLlmClient({ config, fetch });

    await failure(first.complete({ messages: USER_ONLY }));
    const again = await failure(first.complete({ messages: USER_ONLY }));
    const fromNewClient = await failure(second.complete({ messages: USER_ONLY }));

    expect(calls).toHaveLength(1);
    expect(again).toMatchObject({ kind: 'auth', permanent: true });
    expect(fromNewClient).toMatchObject({ kind: 'auth', permanent: true });
  });

  it('still calls a different model on the same route', async () => {
    const config = testConfig();
    const refused = createFakeFetch([textResponse('{"error":"Model vendor-a.model-1 is not allowed"}', 412)]);
    const other = createFakeFetch([completionResponse('Hi')]);
    captureLogs();

    await failure(createLlmClient({ config, fetch: refused.fetch }).complete({ messages: USER_ONLY }));
    const result = await createLlmClient({ config: { ...config, model: 'vendor-a.model-2' }, fetch: other.fetch }).complete({
      messages: USER_ONLY,
    });

    expect(result.text).toBe('Hi');
    expect(other.calls).toHaveLength(1);
  });

  it('does not remember a request error', async () => {
    const { client, calls } = setup([textResponse('{"error":"bad request"}', 400), completionResponse('Hi')]);
    captureLogs();

    await failure(client.complete({ messages: USER_ONLY }));
    const result = await client.complete({ messages: USER_ONLY });

    expect(result.text).toBe('Hi');
    expect(calls).toHaveLength(2);
  });
});

describe('errors and the server log', () => {
  it('logs the provider body with the key, host, URLs and IPs redacted, under the error correlation id', async () => {
    const config = testConfig();
    const body = JSON.stringify({
      error: {
        message: `Key ${config.apiKey} refused for https://${TEST_HOST}/v1/chat/completions from 10.20.30.40 via ${TEST_HOST}:443 (fd00:1:2::3)`,
      },
    });
    const { fetch } = createFakeFetch([textResponse(body, 401)]);
    const logs = captureLogs();

    const error = await failure(createLlmClient({ config, fetch }).complete({ messages: USER_ONLY }));
    const logged = logs.all();

    expect(error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logged).toContain(error.correlationId);
    expect(logged).toContain('refused for');
    for (const secret of [config.apiKey, TEST_HOST, '10.20.30.40', 'https://', 'fd00:1:2::3']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('keeps the provider body out of the error itself', async () => {
    const config = testConfig();
    const { fetch } = createFakeFetch([textResponse('{"error":{"message":"zebra-detail from upstream"}}', 403)]);
    captureLogs();

    const error = await failure(createLlmClient({ config, fetch }).complete({ messages: USER_ONLY }));

    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('zebra-detail');
    expect(error.message).not.toContain(TEST_HOST);
  });
});

describe('createLlmClient', () => {
  it('exposes the route and the configured model', () => {
    const { client } = setup([], { route: 'judge', model: 'vendor-b.model-2' });

    expect(client.route).toBe('judge');
    expect(client.model).toBe('vendor-b.model-2');
  });
});
