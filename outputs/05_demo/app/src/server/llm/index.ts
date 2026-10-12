import 'server-only';

// The model connection (OpenAI chat-completions wire format over an injected fetch).
// - readLlmConfig(route): one route's settings from LLM_* env names only; never throws.
// - createLlmClient({ config, fetch }): complete() and stream() with retries before the
//   first token, a deadline per call, typed LlmErrors and redacted server-side logging.
// - rememberedRefusal(config): the auth or model refusal remembered for these settings, if any.
// - checkEnvFilePermissions(): warns once if .env.local is readable by group or others.
// - modelFamily(model): the vendor family, to check that the judge differs from the agents.

export { readLlmConfig } from './config';
export { createLlmClient, rememberedRefusal, type RememberedRefusal } from './client';
export { LlmError } from './errors';
export { checkEnvFilePermissions, type EnvFileCheckOptions } from './env-file';
export { modelFamily, type ModelFamily } from './family';
