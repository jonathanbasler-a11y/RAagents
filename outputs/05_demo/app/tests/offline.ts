// Offline guards used by tests/setup.ts. Kept separate so they can be tested directly.

export const NETWORK_BLOCKED_MESSAGE = 'network is blocked in tests';

export const MODEL_CREDENTIAL_PREFIXES = ['LLM_', 'ANTHROPIC_', 'OPENAI_'] as const;

/** Deletes every model credential variable from `env`; returns the removed names, sorted. */
export function stripModelCredentials(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env)
    .filter((name) => MODEL_CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort();
  for (const name of removed) delete env[name];
  return removed;
}

export const HOSTED_SETTING_PREFIXES = ['RAAGENTS_', 'LITESTREAM_'] as const;

/**
 * Deletes the hosted-copy settings (sign-in, banner, backup) from `env`; returns the removed names, sorted. The shared
 * prompt block is fixed when its module is imported, so a hosted notice in the shell would change every prompt a test sees.
 */
export function stripHostedSettings(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env)
    .filter((name) => HOSTED_SETTING_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort();
  for (const name of removed) delete env[name];
  return removed;
}

/**
 * Replaces `target.fetch` with a function that throws NETWORK_BLOCKED_MESSAGE.
 * It throws synchronously, so even an un-awaited call fails the test loudly.
 * Code that needs HTTP takes an injected fetch instead.
 */
export function blockNetwork(target: { fetch: typeof fetch }): void {
  target.fetch = () => {
    throw new Error(NETWORK_BLOCKED_MESSAGE);
  };
}
