import { describe, expect, it } from 'vitest';
import type { LlmConfigResult } from '@/shared/contracts';
import { readLlmConfig } from './index';

// Fake values only. The host below is reserved for documentation and tests.
const AGENTS_ENV = {
  LLM_BASE_URL: 'https://gateway.example.test/v1/',
  LLM_API_KEY: 'test-key-agents-123',
  LLM_MODEL: 'vendor-a.model-1',
} as const;

function errorOf(result: LlmConfigResult) {
  if (result.ok) throw new Error('expected an unconfigured route');
  return result.error;
}

describe('readLlmConfig: agents route', () => {
  it('returns the route with the default token cap and the 120 s deadline when the three required variables are set', () => {
    expect(readLlmConfig('agents', AGENTS_ENV)).toEqual({
      ok: true,
      config: {
        route: 'agents',
        baseUrl: 'https://gateway.example.test/v1',
        apiKey: 'test-key-agents-123',
        apiKeyHeader: null,
        model: 'vendor-a.model-1',
        maxTokens: 1500,
        timeoutMs: 120_000,
      },
      warnings: [],
    });
  });

  it('refuses when nothing is set, naming every required variable', () => {
    const error = errorOf(readLlmConfig('agents', {}));

    expect(error.kind).toBe('config');
    expect(error.missing).toEqual(['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']);
    expect(error.message).toContain('LLM_BASE_URL');
  });

  it('has no default endpoint: a key and a model without a base URL are not enough', () => {
    const error = errorOf(readLlmConfig('agents', { LLM_API_KEY: 'test-key-1', LLM_MODEL: 'vendor-a.model-1' }));

    expect(error.missing).toEqual(['LLM_BASE_URL']);
  });

  it.each([
    'changeme',
    'CHANGE-ME',
    'change_me',
    'dummy',
    'none',
    'null',
    'undefined',
    'xxx',
    'XXXXXXXX',
    'todo',
    'TBD',
    'placeholder',
    'replace-me',
    '<your-key>',
    '${LLM_API_KEY}',
    'your-api-key',
    '   ',
  ])('treats the placeholder key %j as missing', (value) => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY: value }));

    expect(error.missing).toEqual(['LLM_API_KEY']);
  });

  it('treats a base URL with a template host as missing', () => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_BASE_URL: 'https://<your-gateway>/v1' }));

    expect(error.missing).toEqual(['LLM_BASE_URL']);
  });

  it('accepts ordinary fake values that are not placeholders', () => {
    const result = readLlmConfig('agents', {
      LLM_BASE_URL: 'http://127.0.0.1:4010/v1',
      LLM_API_KEY: 'fake-key',
      LLM_MODEL: 'fake-model',
    });

    expect(result.ok).toBe(true);
  });

  it.each(['gateway.example.test/v1', 'ftp://gateway.example.test/v1', 'https://user:pass@gateway.example.test/v1'])(
    'refuses the base URL %j: it must be a plain http(s) URL',
    (value) => {
      const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_BASE_URL: value }));

      expect(error.missing).toEqual(['LLM_BASE_URL']);
    },
  );

  it('refuses a key with whitespace inside, such as a pasted "Bearer <key>"', () => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY: 'Bearer test-key-123' }));

    expect(error.missing).toEqual(['LLM_API_KEY']);
  });

  it('trims surrounding whitespace from values', () => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY: '  test-key-agents-123\n', LLM_MODEL: ' vendor-a.model-1 ' });

    expect(result.ok && result.config.apiKey).toBe('test-key-agents-123');
    expect(result.ok && result.config.model).toBe('vendor-a.model-1');
  });

  it('sends the raw key in LLM_API_KEY_HEADER when set', () => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY_HEADER: 'x-gateway-key' });

    expect(result.ok && result.config.apiKeyHeader).toBe('x-gateway-key');
  });

  it.each([[undefined], [''], ['Authorization'], ['authorization']])(
    'uses "Authorization: Bearer" when LLM_API_KEY_HEADER is %j',
    (header) => {
      const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY_HEADER: header });

      expect(result.ok && result.config.apiKeyHeader).toBeNull();
    },
  );

  it('refuses a header name that is not a valid HTTP token', () => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_API_KEY_HEADER: 'x gateway key' }));

    expect(error.missing).toEqual(['LLM_API_KEY_HEADER']);
  });

  it('reads LLM_MAX_TOKENS as the output token cap', () => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_MAX_TOKENS: '800' });

    expect(result.ok && result.config.maxTokens).toBe(800);
    expect(result.warnings).toEqual([]);
  });

  it.each(['abc', '0', '-5', '12.5', '1e3'])('falls back to 1500 with a warning when LLM_MAX_TOKENS is %j', (value) => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_MAX_TOKENS: value });

    expect(result.ok && result.config.maxTokens).toBe(1500);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('LLM_MAX_TOKENS');
  });

  it('warns about a "latest" alias but still returns the route', () => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, LLM_MODEL: 'vendor-a.model-latest' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('LLM_MODEL');
  });

  it('warns when the key would travel over plain http to a host that is not local', () => {
    const remote = readLlmConfig('agents', { ...AGENTS_ENV, LLM_BASE_URL: 'http://gateway.example.test/v1' });
    const local = readLlmConfig('agents', { ...AGENTS_ENV, LLM_BASE_URL: 'http://localhost:4010/v1' });

    expect(remote.ok).toBe(true);
    expect(remote.warnings).toHaveLength(1);
    expect(remote.warnings[0]).toContain('LLM_BASE_URL');
    expect(local.warnings).toEqual([]);
  });

  it('never puts a value or a host into the error or the warnings', () => {
    // Every value carries the marker q7xk, which no message text contains.
    const result = readLlmConfig('agents', {
      LLM_BASE_URL: 'ftp://q7xk-host.example.test/v1',
      LLM_API_KEY: 'q7xk value 42',
      LLM_MODEL: 'q7xk.model-latest',
      LLM_MAX_TOKENS: 'q7xk-cap',
      LLM_API_KEY_HEADER: 'q7xk header',
    });
    const shown = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(shown).not.toContain('q7xk');
  });
});

describe('readLlmConfig: ANTHROPIC_* and OPENAI_* variables', () => {
  it('says the app reads only LLM_* when only ANTHROPIC_* variables are set', () => {
    const error = errorOf(readLlmConfig('agents', { ANTHROPIC_BASE_URL: 'https://proxy.example.test', ANTHROPIC_API_KEY: 'k' }));

    expect(error.missing).toEqual(['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']);
    expect(error.message).toContain('reads only LLM_*');
  });

  it('says the same when OPENAI_* variables are set and an LLM_* value is missing', () => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_MODEL: '', OPENAI_API_KEY: 'k' }));

    expect(error.message).toContain('reads only LLM_*');
  });

  it('does not mention other providers when none of their variables are set', () => {
    const error = errorOf(readLlmConfig('agents', {}));

    expect(error.message).not.toContain('ANTHROPIC');
  });

  it('leaves the note out when every LLM_* value is set and one is merely malformed', () => {
    const error = errorOf(readLlmConfig('agents', { ...AGENTS_ENV, LLM_BASE_URL: 'gateway.example.test/v1', ANTHROPIC_API_KEY: 'k' }));

    expect(error.missing).toEqual(['LLM_BASE_URL']);
    expect(error.message).not.toContain('ANTHROPIC');
  });

  it('ignores ANTHROPIC_* variables when the LLM_* settings are complete', () => {
    const result = readLlmConfig('agents', { ...AGENTS_ENV, ANTHROPIC_API_KEY: 'k' });

    expect(result).toMatchObject({ ok: true, warnings: [] });
  });
});

describe('readLlmConfig: judge route', () => {
  it('uses its own model and key and inherits the base URL, the header and the token cap from the agents route', () => {
    const result = readLlmConfig('judge', {
      ...AGENTS_ENV,
      LLM_API_KEY_HEADER: 'x-gateway-key',
      LLM_MAX_TOKENS: '900',
      LLM_JUDGE_MODEL: 'vendor-b.model-2',
      LLM_JUDGE_API_KEY: 'test-key-judge-456',
    });

    expect(result).toEqual({
      ok: true,
      config: {
        route: 'judge',
        baseUrl: 'https://gateway.example.test/v1',
        apiKey: 'test-key-judge-456',
        apiKeyHeader: 'x-gateway-key',
        model: 'vendor-b.model-2',
        maxTokens: 900,
        timeoutMs: 120_000,
      },
      warnings: [],
    });
  });

  it('prefers LLM_JUDGE_BASE_URL and LLM_JUDGE_API_KEY_HEADER when they are set', () => {
    const result = readLlmConfig('judge', {
      ...AGENTS_ENV,
      LLM_API_KEY_HEADER: 'x-gateway-key',
      LLM_JUDGE_MODEL: 'vendor-b.model-2',
      LLM_JUDGE_API_KEY: 'test-key-judge-456',
      LLM_JUDGE_BASE_URL: 'https://judge.example.test/v2',
      LLM_JUDGE_API_KEY_HEADER: 'Authorization',
    });

    expect(result.ok && result.config.baseUrl).toBe('https://judge.example.test/v2');
    expect(result.ok && result.config.apiKeyHeader).toBeNull();
  });

  it('never borrows the agents key', () => {
    const error = errorOf(readLlmConfig('judge', { ...AGENTS_ENV, LLM_JUDGE_MODEL: 'vendor-b.model-2' }));

    expect(error.missing).toEqual(['LLM_JUDGE_API_KEY']);
  });

  it('names LLM_BASE_URL first when neither base URL is set', () => {
    const error = errorOf(readLlmConfig('judge', {}));

    expect(error.missing).toEqual(['LLM_BASE_URL', 'LLM_JUDGE_API_KEY', 'LLM_JUDGE_MODEL']);
  });

  it('says which base URL holds the placeholder when the judge falls back to an unset LLM_BASE_URL', () => {
    const error = errorOf(
      readLlmConfig('judge', { LLM_JUDGE_BASE_URL: '<judge-url>', LLM_JUDGE_MODEL: 'vendor-b.model-2', LLM_JUDGE_API_KEY: 'test-key-9' }),
    );

    expect(error.missing).toEqual(['LLM_BASE_URL']);
    expect(error.message).toContain('LLM_JUDGE_BASE_URL holds a placeholder');
    expect(error.message).toContain('LLM_BASE_URL is not set');
  });

  it('names LLM_JUDGE_BASE_URL when its own value is unusable', () => {
    const error = errorOf(
      readLlmConfig('judge', {
        ...AGENTS_ENV,
        LLM_JUDGE_MODEL: 'vendor-b.model-2',
        LLM_JUDGE_API_KEY: 'test-key-judge-456',
        LLM_JUDGE_BASE_URL: 'judge.example.test',
      }),
    );

    expect(error.missing).toEqual(['LLM_JUDGE_BASE_URL']);
  });

  it('warns about a "latest" judge alias, naming LLM_JUDGE_MODEL', () => {
    const result = readLlmConfig('judge', {
      ...AGENTS_ENV,
      LLM_JUDGE_MODEL: 'vendor-b-latest',
      LLM_JUDGE_API_KEY: 'test-key-judge-456',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('LLM_JUDGE_MODEL');
  });
});
