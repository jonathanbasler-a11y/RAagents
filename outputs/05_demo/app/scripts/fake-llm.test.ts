import { describe, expect, it } from 'vitest';
import { fixtureSpec } from '@/server/agents/test-fixtures';
import { createLlmClient, LlmError } from '@/server/llm';
import { buildAgentPrompt } from '@/server/prompts';
import { captureLogs, collect, recordingSleep, testConfig } from '@/server/llm/test-support/fake-gateway';
import type { LlmMessage, LlmStreamEvent } from '@/shared/contracts';
import { createFakeLlm, NO_ADDITION, parseArgs } from './fake-llm.mjs';

// The fake runs in-process here: its handler takes a Request and returns a Response, so the
// app's real client talks to it through an injected fetch. No socket is opened.

function clientFor(fake: ReturnType<typeof createFakeLlm>, overrides: Partial<ReturnType<typeof testConfig>> = {}) {
  const config = testConfig({ baseUrl: 'http://fake-llm.test/v1', apiKey: 'fake-key-1', model: 'fake-model', ...overrides });
  return createLlmClient({
    config,
    fetch: (input, init) => fake.handle(new Request(input, init)),
    sleep: async () => {},
  });
}

const asAgent = (name: string, question = 'What would you check first?'): LlmMessage[] => [
  { role: 'system', content: `Shared rules...\n\n## Your brief\nYou are ${name}. Your capability: Something.` },
  { role: 'user', content: question },
];

const instant = { sleep: async () => {} };

describe('fake LLM: normal replies', () => {
  it('streams a labelled stand-in reply in several chunks, ending with stop and [DONE]', async () => {
    const fake = createFakeLlm(instant);

    const events = await collect<LlmStreamEvent>(clientFor(fake).stream({ messages: asAgent('Rosa') }));

    const deltas = events.filter((event) => event.type === 'delta');
    expect(deltas.length).toBeGreaterThan(2);
    const end = events.at(-1);
    expect(end).toMatchObject({ type: 'end', result: { finishReason: 'stop', truncated: false, partial: false, model: 'fake-model' } });
    const text = end?.type === 'end' ? end.result.text : '';
    expect(text).toMatch(/^Fake reply from Rosa/);
    expect(text).toContain('local fake model');
    expect(text).toContain('What would you check first?');
  });

  it('answers a plain (non-streaming) call', async () => {
    const result = await clientFor(createFakeLlm(instant)).complete({ messages: asAgent('Clara') });

    expect(result).toMatchObject({ finishReason: 'stop', model: 'fake-model' });
    expect(result.text).toMatch(/^Fake reply from Clara/);
  });

  it('replies exactly NO_ADDITION for the agents it was told to, and normally for the others', async () => {
    const fake = createFakeLlm({ ...instant, noAddition: ['Carlos'] });

    const carlos = await clientFor(fake).complete({ messages: asAgent('Carlos') });
    const streamed = await collect<LlmStreamEvent>(clientFor(fake).stream({ messages: asAgent('Carlos') }));
    const rosa = await clientFor(fake).complete({ messages: asAgent('Rosa') });

    expect(carlos.text).toBe(NO_ADDITION);
    expect(streamed.at(-1)).toMatchObject({ type: 'end', result: { text: NO_ADDITION } });
    expect(rosa.text).not.toBe(NO_ADDITION);
  });

  it('reads the agent from the brief of a real prompt, not from the shared rules before it', async () => {
    const fake = createFakeLlm({ ...instant, noAddition: ['Carlos'] });
    const prompt = (id: 'cmc' | 'lead') =>
      buildAgentPrompt({
        agent: fixtureSpec(id),
        teammates: [],
        room: 'one-to-one',
        role: 'solo',
        now: new Date('2026-10-07T20:45:00.000Z'),
        timeZone: 'Europe/Paris',
        history: [{ role: 'user', content: 'What would you check first?' }],
      }).messages;

    const carlos = await clientFor(fake).complete({ messages: prompt('cmc') });
    const rosa = await clientFor(fake).complete({ messages: prompt('lead') });

    expect(carlos.text).toBe(NO_ADDITION);
    expect(rosa.text).toMatch(/^Fake reply from Rosa:/);
  });

  it('waits the configured delay between streamed chunks', async () => {
    const { sleep, delays } = recordingSleep();

    await collect(clientFor(createFakeLlm({ sleep, delayMs: 7 })).stream({ messages: asAgent('Rosa') }));

    expect(delays.length).toBeGreaterThan(1);
    expect(new Set(delays)).toEqual(new Set([7]));
  });
});

describe('fake LLM: modes chosen by model name', () => {
  it('"slow" streams with the slow delay', async () => {
    const { sleep, delays } = recordingSleep();

    await collect(clientFor(createFakeLlm({ sleep, slowDelayMs: 900 }), { model: 'fake-slow' }).stream({ messages: asAgent('Rosa') }));

    expect(delays).toContain(900);
  });

  it('"truncate" stops at the output cap', async () => {
    const result = await clientFor(createFakeLlm(instant), { model: 'fake-truncate' }).complete({ messages: asAgent('Rosa') });

    expect(result.truncated).toBe(true);
    expect(result.finishReason).toBe('length');
  });

  it('"break" ends the stream after the first text without [DONE], so the reply is partial', async () => {
    captureLogs();
    const events = await collect<LlmStreamEvent>(clientFor(createFakeLlm(instant), { model: 'fake-break' }).stream({ messages: asAgent('Rosa') }));

    expect(events.at(-1)).toMatchObject({ type: 'end', result: { partial: true } });
  });

  it.each([
    ['fake-fail-500', 'outage'],
    ['fake-fail-429', 'rate_limit'],
    ['fake-fail-401', 'auth'],
    ['fake-fail-model', 'model'],
  ])('"%s" fails with the matching error kind', async (model, kind) => {
    captureLogs();

    const call = clientFor(createFakeLlm(instant), { model }).complete({ messages: asAgent('Rosa') });

    await expect(call).rejects.toBeInstanceOf(LlmError);
    await expect(call).rejects.toMatchObject({ kind });
  });

  it('refuses a key that is not a fake one', async () => {
    captureLogs();

    await expect(clientFor(createFakeLlm(instant), { apiKey: 'sk-real-looking-key' }).complete({ messages: asAgent('Rosa') })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('accepts the key in a custom header too', async () => {
    const result = await clientFor(createFakeLlm(instant), { apiKeyHeader: 'x-api-key' }).complete({ messages: asAgent('Rosa') });

    expect(result.text).toMatch(/^Fake reply/);
  });

  it('refuses max_tokens for gpt-* models, as the real backend does, and accepts max_completion_tokens', async () => {
    const fake = createFakeLlm(instant);
    const raw = (body: Record<string, unknown>) =>
      fake.handle(
        new Request('http://fake-llm.test/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer fake-key' },
          body: JSON.stringify({ messages: asAgent('Rosa'), ...body }),
        }),
      );

    expect((await raw({ model: 'gpt-5-fake', max_tokens: 100 })).status).toBe(400);
    expect((await raw({ model: 'gpt-5-fake', max_completion_tokens: 100 })).status).toBe(200);
    // The app's own client sends max_completion_tokens for gpt-* models (positive control).
    await expect(clientFor(fake, { model: 'gpt-5-fake' }).complete({ messages: asAgent('Rosa') })).resolves.toMatchObject({
      model: 'gpt-5-fake',
    });
  });
});

describe('fake LLM: other requests', () => {
  it('answers GET / for readiness checks, and 404 for unknown paths', async () => {
    const fake = createFakeLlm(instant);

    expect((await fake.handle(new Request('http://fake-llm.test/'))).status).toBe(200);
    expect((await fake.handle(new Request('http://fake-llm.test/v1/embeddings', { method: 'POST' }))).status).toBe(404);
  });
});

describe('parseArgs', () => {
  it('reads the port, host, delays and NO_ADDITION agents from flags, then env, then defaults', () => {
    expect(parseArgs(['--port=4100', '--delay-ms=5', '--no-addition=Carlos, Lena'], {})).toMatchObject({
      port: 4100,
      host: '127.0.0.1',
      delayMs: 5,
      noAddition: ['Carlos', 'Lena'],
    });
    expect(parseArgs([], { FAKE_LLM_PORT: '4200', FAKE_LLM_NO_ADDITION: 'Ines' })).toMatchObject({ port: 4200, noAddition: ['Ines'] });
    expect(parseArgs([], {})).toMatchObject({ port: 4011, host: '127.0.0.1', noAddition: [] });
  });

  it('refuses unknown flags and bad numbers', () => {
    expect(() => parseArgs(['--prot=1'], {})).toThrow(/unknown option/);
    expect(() => parseArgs(['--port=abc'], {})).toThrow(/port/);
  });
});
