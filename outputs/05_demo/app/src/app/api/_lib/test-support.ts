// Test-only harness for the API handlers: a real store on a temporary file, the real agent
// registry over temporary fixture specs, and a scripted model endpoint. Not imported by app code.
import { loadRegistry, toPublicAgent } from '@/server/agents';
import { fixtureSpecs, makeLayout, writeSpecs } from '@/server/agents/test-fixtures';
import { createChatRuntime, type ChatRuntime } from '@/server/chat/boot';
import { FROZEN_NOW, sequentialIds } from '@/server/chat/test-support';
import { openDatabase } from '@/server/db/sqlite';
import { createLlmClient, readLlmConfig, rememberedRefusal } from '@/server/llm';
import { DONE_EVENT, chunkEvent, createFakeFetch, testConfig, type FakeStep } from '@/server/llm/test-support/fake-gateway';
import type { AgentSpec, LlmConfigResult } from '@/shared/contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import type { ApiDeps } from './deps';

export const TURN_BODY = {
  text: 'What would you check first?',
  clientTurnId: '11111111-1111-4111-8111-111111111111',
  tz: 'Europe/Paris',
};

export interface ApiHarnessOptions {
  steps?: FakeStep[];
  specs?: AgentSpec[];
  /** Default: a configured agents route with fake values. */
  llmConfig?: (route: 'agents' | 'judge') => LlmConfigResult;
  overrides?: Partial<ApiDeps>;
}

export interface ApiHarness {
  deps: ApiDeps;
  runtime: ChatRuntime;
  fake: ReturnType<typeof createFakeFetch>;
  /** How often the handler asked for the chat runtime (the database). */
  runtimeCalls(): number;
  /** Rows in the chat database, counted straight from the file. */
  counts(): { threads: number; turns: number; messages: number };
  cleanup(): void;
}

export function apiHarness(options: ApiHarnessOptions = {}): ApiHarness {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'api-test-'));
  const dbPath = path.join(dataDir, 'chat.db');
  const layout = makeLayout();
  writeSpecs(layout, options.specs ?? fixtureSpecs());
  const registry = loadRegistry({ specsDir: layout.specsDir, publicDir: layout.publicDir });
  const runtime = createChatRuntime({ dbPath, bootId: 'boot-test', now: () => FROZEN_NOW, newId: sequentialIds('row') });
  const fake = createFakeFetch(options.steps ?? []);
  let runtimeCalls = 0;
  const config = testConfig();

  const deps: ApiDeps = {
    runtime: () => {
      runtimeCalls += 1;
      return runtime;
    },
    registry: {
      listAgents: () => [...registry.agents],
      getAgent: (id) => registry.get(id),
      listPublicAgents: () => registry.agents.map((agent) => toPublicAgent(agent)),
    },
    llmConfig: options.llmConfig ?? ((route) => (route === 'agents' ? { ok: true, config, warnings: [] } : readLlmConfig('judge', {}))),
    llmClient: (routeConfig) => createLlmClient({ config: routeConfig, fetch: fake.fetch, sleep: async () => {} }),
    // The real memory: testConfig() gives every harness a fresh key, so tests never share it.
    llmRefusal: rememberedRefusal,
    now: () => FROZEN_NOW,
    newId: sequentialIds('api'),
    log: console,
    ...options.overrides,
  };

  return {
    deps,
    runtime,
    fake,
    runtimeCalls: () => runtimeCalls,
    counts() {
      const db = openDatabase(dbPath);
      try {
        const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
        return { threads: count('threads'), turns: count('turns'), messages: count('messages') };
      } finally {
        db.close();
      }
    },
    cleanup() {
      runtime.store.close();
      layout.cleanup();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A same-origin JSON POST, as the app's own pages send it. A header set to undefined is left out. */
export function postRequest(
  urlPath: string,
  body: unknown,
  headers: Record<string, string | undefined> = {},
  init: RequestInit = {},
): Request {
  const merged = Object.entries({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return new Request(`http://localhost${urlPath}`, {
    method: 'POST',
    headers: merged,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

/** A complete streamed reply. */
export function streamedReply(...parts: string[]): Response {
  const body = [...parts.map((part, index) => chunkEvent(part, { role: index === 0 })), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * A streamed reply that sends `first`, waits for `hold`, then sends `rest` and [DONE].
 * Like a real connection, it breaks when the call's signal aborts.
 */
export function heldReply(first: string, hold: Promise<void>, rest: string, signal: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  let step = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
    async pull(controller) {
      step += 1;
      if (step === 1) {
        controller.enqueue(encoder.encode(chunkEvent(first, { role: true })));
      } else if (step === 2) {
        await hold;
        if (signal?.aborted) return;
        controller.enqueue(encoder.encode(chunkEvent(rest) + chunkEvent(null, { finishReason: 'stop' }) + DONE_EVENT));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export async function jsonOf<T = Record<string, unknown>>(response: Response): Promise<T> {
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  return (await response.json()) as T;
}
