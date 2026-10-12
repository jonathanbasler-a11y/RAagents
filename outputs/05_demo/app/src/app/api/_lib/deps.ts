import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAgent, listAgents, listPublicAgents } from '@/server/agents';
import { getChatRuntime, type ChatRuntime } from '@/server/chat/boot';
import { createLlmClient, readLlmConfig, rememberedRefusal, type RememberedRefusal } from '@/server/llm';
import { redact, type RedactionTargets } from '@/server/llm/errors';
import type { AgentId, AgentSpec, LlmClient, LlmConfigResult, LlmRouteConfig, LlmRouteName, PublicAgent } from '@/shared/contracts';

// What the API handlers need from the rest of the server. The route files pass apiDeps();
// tests pass a store on a temporary file, a temporary roster and a scripted model endpoint.

export interface ApiDeps {
  /** The process-wide chat runtime: opened, and stale turns reconciled, on first use. */
  runtime: () => ChatRuntime;
  /** The agent registry. Each call can throw AgentSpecError when the specs on disk are broken. */
  registry: {
    listAgents: () => AgentSpec[];
    /** Undefined for unknown and inactive agents. */
    getAgent: (id: AgentId) => AgentSpec | undefined;
    listPublicAgents: () => PublicAgent[];
  };
  /** One route's settings, from LLM_* env names only. Never throws. */
  llmConfig: (route: LlmRouteName) => LlmConfigResult;
  /** A model client for a configured route. */
  llmClient: (config: LlmRouteConfig) => LlmClient;
  /** The auth or model refusal the model client remembers for these settings (read-only), or null. */
  llmRefusal: (config: LlmRouteConfig) => RememberedRefusal | null;
  now: () => Date;
  newId: () => string;
  log: Pick<Console, 'error' | 'warn'>;
  /** Default: the turn runner's 180 s. */
  turnDeadlineMs?: number;
  /** Default: the SSE writer's 15 s. */
  heartbeatMs?: number;
}

/** Key and endpoint pairs whose values must never reach a log line (raw env values, even when a route is incomplete). */
function secretPairs(env: Readonly<Record<string, string | undefined>>): RedactionTargets[] {
  const value = (name: string) => env[name]?.trim() ?? '';
  return [
    { apiKey: value('LLM_API_KEY'), baseUrl: value('LLM_BASE_URL') },
    { apiKey: value('LLM_JUDGE_API_KEY'), baseUrl: value('LLM_JUDGE_BASE_URL') || value('LLM_BASE_URL') },
  ].filter((pair) => pair.apiKey !== '' || pair.baseUrl !== '');
}

function formatLogArgument(argument: unknown): string {
  if (argument instanceof Error) return argument.stack ?? `${argument.name}: ${argument.message}`;
  return typeof argument === 'string' ? argument : String(argument);
}

/**
 * console.error and console.warn, with the configured keys, gateway hosts, URLs and bearer
 * tokens removed from every line. Every server-side module the API calls logs through it.
 */
function redactingLog(env: Readonly<Record<string, string | undefined>> = process.env): Pick<Console, 'error' | 'warn'> {
  const clean = (args: unknown[]) => {
    const text = args.map(formatLogArgument).join(' ');
    return secretPairs(env).reduce((out, pair) => redact(out, pair), text);
  };
  return {
    error: (...args: unknown[]) => console.error(clean(args)),
    warn: (...args: unknown[]) => console.warn(clean(args)),
  };
}

/** The real dependencies: the process-wide runtime, registry and model connection. */
export function apiDeps(): ApiDeps {
  return {
    runtime: getChatRuntime,
    registry: { listAgents, getAgent, listPublicAgents },
    llmConfig: (route) => readLlmConfig(route),
    // The global fetch, looked up per call. The browser's request.signal is never involved:
    // runAgent passes the turn's own deadline signal.
    llmClient: (config) => createLlmClient({ config, fetch: (input, init) => globalThis.fetch(input, init) }),
    llmRefusal: rememberedRefusal,
    now: () => new Date(),
    newId: () => randomUUID(),
    log: redactingLog(),
  };
}
