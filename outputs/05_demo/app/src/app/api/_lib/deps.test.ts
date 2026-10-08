import { describe, expect, it, vi } from 'vitest';
import { apiDeps } from './deps';

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
