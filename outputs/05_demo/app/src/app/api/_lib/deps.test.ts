import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthReport } from '@/shared/contracts';
import { apiDeps } from './deps';
import { getHealth } from './health';
import { apiHarness, jsonOf, type ApiHarness } from './test-support';

describe('apiDeps().log', () => {
  it('strips the configured keys and gateway hosts from every server log line', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-agents-secret-123');
    vi.stubEnv('LLM_BASE_URL', 'https://gateway.hidden-host.example.test/v1');
    vi.stubEnv('LLM_JUDGE_API_KEY', 'sk-judge-secret-456');
    vi.stubEnv('LLM_JUDGE_BASE_URL', 'https://judge.other-host.example.test/v1');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { log } = apiDeps();
    log.error('call failed with sk-agents-secret-123 at gateway.hidden-host.example.test', new Error('judge sk-judge-secret-456'));
    log.warn('retrying judge.other-host.example.test');

    const written = [...error.mock.calls, ...warn.mock.calls].flat().map(String).join('\n');
    for (const secret of ['sk-agents-secret-123', 'sk-judge-secret-456', 'hidden-host', 'other-host']) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain('call failed');
    expect(written).toContain('retrying');
  });

  it('writes the message as it is when no secret is configured (positive control)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    apiDeps().log.error('[api] plain message (correlation abc)');

    expect(error).toHaveBeenCalledWith('[api] plain message (correlation abc)');
  });
});

describe('apiDeps().llmConfig and the health report: plain http to a remote host', () => {
  let harness: ApiHarness | undefined;

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  function stubLlmEnv(baseUrl: string, allowPlainHttp?: string) {
    vi.stubEnv('LLM_BASE_URL', baseUrl);
    vi.stubEnv('LLM_API_KEY', 'sk-agents-secret-123');
    vi.stubEnv('LLM_MODEL', 'vendor-a.model-1');
    vi.stubEnv('LLM_ALLOW_PLAIN_HTTP', allowPlainHttp);
  }

  async function healthFor(): Promise<HealthReport & { llmRoutes: Record<string, { configured: boolean; missing: string[] }> }> {
    harness = apiHarness({ llmConfig: apiDeps().llmConfig });
    return jsonOf(getHealth(harness.deps));
  }

  it('reads the process environment: a remote http base URL leaves the route not configured and the health report says why', async () => {
    stubLlmEnv('http://gateway.hidden-host.example.test/v1');

    const result = apiDeps().llmConfig('agents');
    const report = await healthFor();

    expect(result.ok).toBe(false);
    expect(report.llm.configured).toBe(false);
    expect(report.llm.missing).toEqual(['LLM_BASE_URL']);
    expect(report.llm.message).toContain('LLM_BASE_URL');
    expect(report.llm.message).toMatch(/plain http/);
    expect(report.llmRoutes.agents).toEqual({ configured: false, missing: ['LLM_BASE_URL'] });
    expect(JSON.stringify(report)).not.toContain('hidden-host');
  });

  it('is configured for https and for loopback http (positive controls)', async () => {
    stubLlmEnv('https://gateway.hidden-host.example.test/v1');
    expect(apiDeps().llmConfig('agents').ok).toBe(true);

    stubLlmEnv('http://127.0.0.1:4010/v1');
    expect(apiDeps().llmConfig('agents').ok).toBe(true);
    expect((await healthFor()).llm.configured).toBe(true);
  });

  it('is configured again with LLM_ALLOW_PLAIN_HTTP=1', () => {
    stubLlmEnv('http://gateway.hidden-host.example.test/v1', '1');

    expect(apiDeps().llmConfig('agents').ok).toBe(true);
  });
});
