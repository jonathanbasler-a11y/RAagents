import { afterEach, describe, expect, it } from 'vitest';
import { AgentSpecError } from '@/server/agents';
import { readSse } from '@/server/chat/test-support';
import { readLlmConfig } from '@/server/llm';
import { captureLogs, jsonResponse } from '@/server/llm/test-support/fake-gateway';
import type { HealthReport } from '@/shared/contracts';
import { getHealth } from './health';
import { apiHarness, jsonOf, postRequest, TURN_BODY, type ApiHarness } from './test-support';
import { postTurn } from './turns';

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(...args: Parameters<typeof apiHarness>): ApiHarness {
  harness = apiHarness(...args);
  return harness;
}

type Report = HealthReport & {
  agentIssueCount: number;
  llmRoutes: Record<'agents' | 'judge', { configured: boolean; missing: string[] }>;
};

const FULL_ENV = {
  LLM_BASE_URL: 'https://gateway.hidden-host.example.test/v1',
  LLM_API_KEY: 'sk-agents-secret-value-123',
  LLM_MODEL: 'vendor-a.model-secret-1',
  LLM_JUDGE_MODEL: 'vendor-b.judge-secret-2',
  LLM_JUDGE_API_KEY: 'sk-judge-secret-value-456',
};

describe('GET /api/health', () => {
  it('reports ok with the agent count, the database, both model routes and the server start time', async () => {
    const api = setup({ llmConfig: (route) => readLlmConfig(route, FULL_ENV) });

    const response = getHealth(api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await jsonOf<Report>(response)).toEqual({
      status: 'ok',
      checks: { database: 'ok', agents: 'ok', llm: 'ok' },
      agentCount: 6,
      agentIssueCount: 0,
      llm: { configured: true, missing: [], message: null },
      llmRoutes: { agents: { configured: true, missing: [] }, judge: { configured: true, missing: [] } },
      startedAt: api.runtime.startedAt,
    });
  });

  it('never returns a key, a host or a model id', async () => {
    const api = setup({ llmConfig: (route) => readLlmConfig(route, FULL_ENV) });

    const text = JSON.stringify(await jsonOf(getHealth(api.deps)));

    for (const value of [...Object.values(FULL_ENV), 'hidden-host', 'secret']) expect(text).not.toContain(value);
  });

  it('reports degraded with the missing variable names, never values, when the agents route is not set up', async () => {
    const api = setup({ llmConfig: (route) => readLlmConfig(route, { LLM_API_KEY: 'sk-only-key-789' }) });

    const report = await jsonOf<Report>(getHealth(api.deps));

    expect(report.status).toBe('degraded');
    expect(report.checks.llm).toBe('not_configured');
    expect(report.llm.configured).toBe(false);
    expect(report.llm.missing).toEqual(['LLM_BASE_URL', 'LLM_MODEL']);
    expect(report.llm.message).toContain('LLM_BASE_URL');
    expect(report.llmRoutes.judge.configured).toBe(false);
    expect(JSON.stringify(report)).not.toContain('sk-only-key-789');
  });

  it.each([
    ['refused the key', jsonResponse({ error: { message: 'invalid api key' } }, 401), /refused the key[\s\S]*LLM_API_KEY[\s\S]*restart/],
    [
      'refused the model',
      jsonResponse({ error: { message: 'The model `m` does not exist', code: 'model_not_found' } }, 404),
      /does not allow the configured model[\s\S]*LLM_MODEL[\s\S]*restart/,
    ],
  ])('stops saying ok once the gateway %s: every later call would fail until a restart', async (_name, refusal, message) => {
    captureLogs();
    const api = setup({ steps: [refusal] });
    expect((await jsonOf<Report>(getHealth(api.deps))).status).toBe('ok');

    const turn = await postTurn(postRequest('/api/rooms/lead/turns', TURN_BODY), 'lead', api.deps);
    await readSse(turn.body as ReadableStream<Uint8Array>);
    const report = await jsonOf<Report>(getHealth(api.deps));

    expect(report.status).toBe('degraded');
    expect(report.checks.llm).toBe('error');
    expect(report.llm).toEqual({ configured: false, missing: [], message: expect.stringMatching(message) });
    expect(JSON.stringify(report)).not.toMatch(/test-key|gateway\.example\.test/);
  });

  it('keeps saying ok after an outage, which is not remembered (positive control)', async () => {
    captureLogs();
    const outage = () => jsonResponse({ error: { message: 'busy' } }, 500);
    const api = setup({ steps: [outage(), outage(), outage()] });

    const turn = await postTurn(postRequest('/api/rooms/lead/turns', TURN_BODY), 'lead', api.deps);
    await readSse(turn.body as ReadableStream<Uint8Array>);

    expect(api.fake.calls).toHaveLength(3);
    expect(await jsonOf<Report>(getHealth(api.deps))).toMatchObject({ status: 'ok', checks: { llm: 'ok' }, llm: { configured: true } });
  });

  it('reports error, still as a readable report, when the database cannot be opened', async () => {
    captureLogs();
    const api = setup({
      llmConfig: (route) => readLlmConfig(route, FULL_ENV),
      overrides: {
        runtime: () => {
          throw new Error('cannot open the database');
        },
      },
    });

    const response = getHealth(api.deps);

    expect(response.status).toBe(200);
    const report = await jsonOf<Report>(response);
    expect(report.status).toBe('error');
    expect(report.checks.database).toBe('error');
    expect(report.startedAt).toEqual(expect.any(String));
  });

  it('reports error with the number of spec issues when the roster is broken', async () => {
    captureLogs();
    const api = setup({
      llmConfig: (route) => readLlmConfig(route, FULL_ENV),
      overrides: {
        registry: {
          listAgents: () => {
            throw new AgentSpecError([
              { source: 'a.md', message: 'one' },
              { source: 'b.md', message: 'two' },
            ]);
          },
          getAgent: () => undefined,
          listPublicAgents: () => [],
        },
      },
    });

    const report = await jsonOf<Report>(getHealth(api.deps));

    expect(report).toMatchObject({ status: 'error', checks: { agents: 'error' }, agentCount: 0, agentIssueCount: 2 });
  });
});
