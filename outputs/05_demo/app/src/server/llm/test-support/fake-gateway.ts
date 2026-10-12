// Test-only helpers for the LLM client: a scripted fetch, real Response objects with
// fake bodies, and network errors shaped like the ones Node's fetch (undici) throws.
// Fake values only; the host is reserved for documentation and tests.
import { vi } from 'vitest';
import type { LlmRouteConfig } from '@/shared/contracts';

export const TEST_HOST = 'gateway.example.test';
export const REPORTED_MODEL = 'vendor-a.model-1-20260101';

let configCount = 0;

/**
 * A route config with fake values. Every call gets a fresh key, so a permanent failure one
 * test makes the client remember can never reach another test.
 */
export function testConfig(overrides: Partial<LlmRouteConfig> = {}): LlmRouteConfig {
  configCount += 1;
  return {
    route: 'agents',
    baseUrl: `https://${TEST_HOST}/v1`,
    apiKey: `test-key-${configCount}-q9w8e7r6`,
    apiKeyHeader: null,
    model: 'vendor-a.model-1',
    maxTokens: 1500,
    timeoutMs: 120_000,
    ...overrides,
  };
}

export const USER_ONLY = [{ role: 'user' as const, content: 'Say hello.' }];

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
  redirect: RequestRedirect | undefined;
}

/** One scripted answer: a Response, an Error to throw, or a function of the call. */
export type FakeStep = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

/** A fetch that answers with `steps` in order and records every call. An extra call throws. */
export function createFakeFetch(steps: FakeStep[]) {
  const queue = [...steps];
  const calls: RecordedCall[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      signal: init?.signal ?? null,
      redirect: init?.redirect,
    };
    calls.push(call);
    const step = queue.shift();
    if (step === undefined) throw new Error(`unexpected fetch call #${calls.length}`);
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(call);
    return step;
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(text: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A complete chat-completions reply, shaped like the OpenAI wire format. */
export function completionResponse(
  content: unknown,
  options: { model?: string | null; finishReason?: string | null } = {},
): Response {
  const body: Record<string, unknown> = {
    id: 'chatcmpl-test-1',
    object: 'chat.completion',
    created: 1_760_000_000,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: options.finishReason === undefined ? 'stop' : options.finishReason,
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  };
  if (options.model !== null) body.model = options.model ?? REPORTED_MODEL;
  return jsonResponse(body);
}

/** One SSE event carrying a chat.completion.chunk. */
export function chunkEvent(
  content: string | null,
  options: { finishReason?: string | null; role?: boolean; model?: string } = {},
): string {
  const delta: Record<string, unknown> = {};
  if (options.role) delta.role = 'assistant';
  if (content !== null) delta.content = content;
  const chunk = {
    id: 'chatcmpl-test-1',
    object: 'chat.completion.chunk',
    created: 1_760_000_000,
    model: options.model ?? REPORTED_MODEL,
    choices: [{ index: 0, delta, finish_reason: options.finishReason ?? null }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** The usage-only chunk some gateways send last: `choices` is empty. */
export const USAGE_EVENT = `data: ${JSON.stringify({
  id: 'chatcmpl-test-1',
  object: 'chat.completion.chunk',
  created: 1_760_000_000,
  model: REPORTED_MODEL,
  choices: [],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
})}\n\n`;

export const DONE_EVENT = 'data: [DONE]\n\n';

export type StreamEnd = 'close' | 'hang' | { error: unknown };

/**
 * A 200 text/event-stream Response whose body yields `parts` one read at a time, then
 * closes, errors, or hangs. Like undici, it errors with the signal's reason on abort.
 */
export function sseResponse(
  parts: Array<string | Uint8Array>,
  options: { end?: StreamEnd; signal?: AbortSignal | null; onCancel?: () => void } = {},
): Response {
  const encoder = new TextEncoder();
  const queue = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
  const end = options.end ?? 'close';
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const signal = options.signal;
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) {
        controller.enqueue(next);
        return;
      }
      if (end === 'close') controller.close();
      else if (end === 'hang') return new Promise<void>(() => {});
      else controller.error(end.error);
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A Response whose body breaks while it is read (a connection dropped mid-body). */
export function brokenBodyResponse(status: number, error: unknown): Response {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(error);
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** What fetch throws when the connection fails: TypeError "fetch failed" with the cause attached. */
export function fetchFailed(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause });
}

/** A Node system error, e.g. code ENOTFOUND or ECONNRESET. */
export function systemError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** What reading a body throws when the server closes the socket mid-response. */
export function socketClosed(): TypeError {
  const cause = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
  return new TypeError('terminated', { cause });
}

/** A fetch step that never answers; it rejects with the signal's reason once aborted. */
export function hangUntilAborted(call: RecordedCall): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = call.signal;
    if (!signal) return; // never settles: the test fails on its own timeout
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** A sleep that records the requested delays and returns at once. */
export function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

/** Silences console.error and console.warn for the test and returns what was logged. */
export function captureLogs() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const join = (calls: unknown[][]) => calls.map((args) => args.map(String).join(' '));
  return {
    errors: () => join(error.mock.calls),
    warnings: () => join(warn.mock.calls),
    all: () => [...join(error.mock.calls), ...join(warn.mock.calls)].join('\n'),
  };
}

/** Collects every event of a stream. */
export async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of events) out.push(event);
  return out;
}
