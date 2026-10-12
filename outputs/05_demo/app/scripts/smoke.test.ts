import { describe, expect, it } from 'vitest';
import {
  DONE_EVENT,
  TEST_HOST,
  captureLogs,
  chunkEvent,
  completionResponse,
  createFakeFetch,
  sseResponse,
  textResponse,
  type RecordedCall,
} from '../src/server/llm/test-support/fake-gateway';
import { runSmoke } from './smoke';

// Fake values only; the host is reserved for documentation and tests.
const AGENTS_KEY = 'smoke-key-agents-1a2b3c';
const JUDGE_KEY = 'smoke-key-judge-4d5e6f';
const AGENTS = { LLM_BASE_URL: `https://${TEST_HOST}/v1`, LLM_API_KEY: AGENTS_KEY, LLM_MODEL: 'anthropic.claude-test-1' };
const JUDGE = { LLM_JUDGE_MODEL: 'gpt-5.6-sol-test', LLM_JUDGE_API_KEY: JUDGE_KEY };

type Answer = (call: RecordedCall) => Response | Promise<Response>;

/** A healthy gateway: answers "OK" as the requested model, streaming when asked to. */
const healthy: Answer = (call) => {
  const model = String(call.body.model);
  if (call.body.stream !== true) return completionResponse('OK', { model });
  return sseResponse([chunkEvent('OK', { model }), chunkEvent(null, { finishReason: 'stop', model }), DONE_EVENT], {
    signal: call.signal,
  });
};

let run = 0;

/**
 * Runs the smoke against a fake gateway. Each run gets its own keys (the base key plus a
 * suffix), because the client remembers a refused key for the whole process.
 */
async function smoke(env: Record<string, string>, answer: Answer = healthy) {
  run += 1;
  const unique = { ...env };
  for (const name of ['LLM_API_KEY', 'LLM_JUDGE_API_KEY']) if (unique[name]) unique[name] += `-run${run}`;
  const { fetch, calls } = createFakeFetch(Array.from({ length: 10 }, () => answer));
  const logs = captureLogs();
  const lines: string[] = [];
  let clock = 0;
  const code = await runSmoke({ env: unique, fetch, print: (line) => lines.push(line), now: () => (clock += 25) });
  return { code, calls, output: lines.join('\n'), logs: logs.all() };
}

describe('npm run smoke', () => {
  it('exits 2 and names the missing variables when nothing is configured, without calling anything', async () => {
    const { code, calls, output } = await smoke({});

    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/agents\s+not configured/);
    expect(output).toContain('LLM_BASE_URL');
    expect(output).toMatch(/judge\s+not configured/);
  });

  it('says the app reads only LLM_* names when only ANTHROPIC_* variables are set', async () => {
    const { code, output } = await smoke({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://proxy.example.test' });

    expect(code).toBe(2);
    expect(output).toContain('reads only LLM_*');
  });

  it('exits 0 when every call answers and the judge family differs, printing status, model, family, finish reason and latency', async () => {
    const { code, calls, output } = await smoke({ ...AGENTS, ...JUDGE });
    const lines = output.split('\n');
    const line = (pattern: RegExp) => lines.find((candidate) => pattern.test(candidate)) ?? '';

    expect(code).toBe(0);
    expect(calls.map((call) => [call.body.model, call.body.stream === true])).toEqual([
      ['anthropic.claude-test-1', false],
      ['anthropic.claude-test-1', true],
      ['gpt-5.6-sol-test', false],
    ]);
    for (const [pattern, family] of [
      [/^agents\s+plain\b/, 'anthropic'],
      [/^agents\s+stream\b/, 'anthropic'],
      [/^judge\s+plain\b/, 'openai'],
    ] as const) {
      expect(line(pattern)).toMatch(new RegExp(`OK .*HTTP 200 .*model=\\S+ .*family=${family} .*finish=stop .*\\d+ ms`));
    }
    expect(output).toMatch(/judge family \(openai\) differs from the agents' family \(anthropic\)/);
  });

  it('exits 1 when the judge is the same family as the agents', async () => {
    const { code, output } = await smoke({ ...AGENTS, ...JUDGE, LLM_JUDGE_MODEL: 'anthropic.claude-test-2' });

    expect(code).toBe(1);
    expect(output).toMatch(/FAIL.*same family/);
  });

  it('exits 1 when a configured route fails, printing the error kind, the status and the correlation id', async () => {
    const refuseAgents: Answer = (call) =>
      call.headers.get('authorization')?.startsWith(`Bearer ${AGENTS_KEY}`)
        ? textResponse('{"error":"invalid key"}', 401)
        : healthy(call);

    const { code, output } = await smoke({ ...AGENTS, ...JUDGE }, refuseAgents);

    expect(code).toBe(1);
    expect(output).toMatch(/^agents\s+plain\s+FAIL auth, HTTP 401.*correlation [0-9a-f-]{36}/m);
    expect(output).toMatch(/^judge\s+plain\s+OK/m);
  });

  it('fails a streamed answer that breaks off as partial', async () => {
    const breakStreams: Answer = (call) =>
      call.body.stream === true ? sseResponse([chunkEvent('O', { model: String(call.body.model) })], { signal: call.signal }) : healthy(call);

    const { code, output } = await smoke({ ...AGENTS }, breakStreams);

    expect(code).toBe(1);
    expect(output).toMatch(/^agents\s+stream\s+FAIL.*partial/m);
  });

  it('labels a rate limit as inconclusive', async () => {
    const limited: Answer = () => textResponse('{"error":"slow down"}', 429, { 'retry-after': '120' });

    const { code, output } = await smoke({ ...AGENTS }, limited);

    expect(code).toBe(1);
    expect(output).toMatch(/FAIL rate_limit.*inconclusive/);
  });

  it('checks the agents route alone when the judge is not configured', async () => {
    const { code, output } = await smoke({ ...AGENTS });

    expect(code).toBe(0);
    expect(output).toMatch(/judge\s+not configured/);
  });

  it('warns about a "latest" alias', async () => {
    const { output } = await smoke({ ...AGENTS, LLM_MODEL: 'anthropic.claude-latest' });

    expect(output).toMatch(/warning: .*latest/);
  });

  it('never prints a key or the host, even when the gateway echoes them back', async () => {
    const leaky: Answer = (call) =>
      textResponse(`{"error":"bad key ${call.headers.get('authorization')} at https://${TEST_HOST}/v1 (${TEST_HOST})"}`, 401);

    const { output, logs } = await smoke({ ...AGENTS, ...JUDGE }, leaky);

    for (const secret of [AGENTS_KEY, JUDGE_KEY, TEST_HOST]) {
      expect(output).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
  });
});
