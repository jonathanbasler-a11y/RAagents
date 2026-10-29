import { describe, expect, it } from 'vitest';
import { blockNetwork, NETWORK_BLOCKED_MESSAGE, stripHostedSettings, stripModelCredentials } from './offline';

const CREDENTIAL_NAME = /^(LLM_|ANTHROPIC_|OPENAI_)/;

describe('stripModelCredentials', () => {
  it('removes LLM_, ANTHROPIC_ and OPENAI_ variables and keeps everything else', () => {
    const env: Record<string, string | undefined> = {
      LLM_API_KEY: 'fake-key',
      LLM_BASE_URL: 'http://127.0.0.1:9/v1',
      ANTHROPIC_API_KEY: 'fake-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
      PATH: '/usr/bin',
      MY_LLM_SETTING: 'kept',
    };

    const removed = stripModelCredentials(env);

    expect(removed).toEqual(['ANTHROPIC_API_KEY', 'LLM_API_KEY', 'LLM_BASE_URL', 'OPENAI_BASE_URL']);
    expect(env).toEqual({ PATH: '/usr/bin', MY_LLM_SETTING: 'kept' });
  });
});

describe('stripHostedSettings', () => {
  it('removes the hosted-copy settings (sign-in, banner, backup) and keeps everything else', () => {
    const env: Record<string, string | undefined> = {
      RAAGENTS_ADMIN_PASSWORD: 'a-long-admin-password-1',
      RAAGENTS_HOSTED_NOTICE: 'Hosted copy',
      RAAGENTS_REQUIRE_SIGN_IN: '1',
      LITESTREAM_REPLICA_URL: 's3://bucket/chat.db',
      CHAT_DB_PATH: '/tmp/chat.db',
      PATH: '/usr/bin',
    };

    expect(stripHostedSettings(env)).toEqual(['LITESTREAM_REPLICA_URL', 'RAAGENTS_ADMIN_PASSWORD', 'RAAGENTS_HOSTED_NOTICE', 'RAAGENTS_REQUIRE_SIGN_IN']);
    expect(env).toEqual({ CHAT_DB_PATH: '/tmp/chat.db', PATH: '/usr/bin' });
  });
});

describe('blockNetwork', () => {
  it('replaces fetch with a function that throws', () => {
    const target = { fetch: (async () => new Response('ok')) as typeof fetch };

    blockNetwork(target);

    expect(() => target.fetch('http://127.0.0.1:9/')).toThrow(NETWORK_BLOCKED_MESSAGE);
  });
});

describe('the shared setup file', () => {
  it('leaves no hosted-copy settings in process.env, so a shell that has them set changes no test', () => {
    expect(Object.keys(process.env).filter((name) => /^(RAAGENTS_|LITESTREAM_)/.test(name))).toEqual([]);
  });

  it('leaves no model credential variables in process.env', () => {
    expect(Object.keys(process.env).filter((name) => CREDENTIAL_NAME.test(name))).toEqual([]);
  });

  it('blocks the global fetch', () => {
    expect(() => fetch('http://127.0.0.1:9/')).toThrow('network is blocked in tests');
  });
});
