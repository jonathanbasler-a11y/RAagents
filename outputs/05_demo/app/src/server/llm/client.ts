import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type {
  CreateLlmClientOptions,
  LlmClient,
  LlmErrorKind,
  LlmRequest,
  LlmResult,
  LlmRouteConfig,
  LlmStreamEvent,
} from '@/shared/contracts';
import {
  LlmError,
  excerpt,
  failureForStatus,
  failureForThrown,
  redact,
  retryAfterMs,
  type Failure,
  type RedactionTargets,
} from './errors';
import { SseParser } from './sse';

// Retry policy: at most 3 attempts, short jittered backoff, about 4 s of total sleep.
const MAX_ATTEMPTS = 3;
const SLEEP_BUDGET_MS = 4000;
const BACKOFF_BASE_MS = 500;

const ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant']);

interface RememberedFailure {
  kind: LlmErrorKind;
  status?: number;
  reason: string;
  correlationId: string;
}

// Permanent refusals (auth, model) for this process, keyed by route, model and a hash of
// the endpoint and credentials, so a changed key or model gets a fresh try.
const rememberedFailures = new Map<string, RememberedFailure>();

function memoryKey(config: LlmRouteConfig): string {
  const credentials = createHash('sha256')
    .update(`${config.baseUrl}\n${config.apiKeyHeader ?? ''}\n${config.apiKey}`)
    .digest('hex')
    .slice(0, 16);
  return `${config.route}\n${config.model}\n${credentials}`;
}

/** A permanent refusal this process remembers for a route's settings. */
export interface RememberedRefusal {
  /** auth (the key) or model (the model is not allowed). */
  kind: LlmErrorKind;
  /** The call that was refused; the server log has its details under this id. */
  correlationId: string;
}

/**
 * Read-only: the refusal remembered for these settings, or null. While one is remembered,
 * every call with the same settings fails at once without a request, until the settings
 * change or the server restarts, so the health report must not say the route is usable.
 */
export function rememberedRefusal(config: LlmRouteConfig): RememberedRefusal | null {
  const remembered = rememberedFailures.get(memoryKey(config));
  return remembered ? { kind: remembered.kind, correlationId: remembered.correlationId } : null;
}

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;

function firstChoice(json: unknown): JsonObject | undefined {
  const choices = asObject(json)?.choices;
  if (!Array.isArray(choices)) return undefined;
  return asObject(choices.find((choice) => asObject(choice)?.index === 0) ?? choices[0]);
}

function finishReasonOf(choice: JsonObject | undefined): string | null {
  const reason = choice?.finish_reason;
  return typeof reason === 'string' && reason !== '' ? reason : null;
}

function reportedModel(json: unknown): string | undefined {
  const model = asObject(json)?.model;
  return typeof model === 'string' && model.trim() !== '' ? model : undefined;
}

/** Message content as text: a string, or the text parts of a content array. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof asObject(part)?.text === 'string' ? (asObject(part)?.text as string) : '')).join('');
}

const isTruncated = (finishReason: string | null) => finishReason === 'length' || finishReason === 'max_tokens';

// gpt-* models refuse max_tokens; GPT-5 and later also reason by default, which spends the
// output cap before any text, so reasoning is switched off for them.
function outputCapFields(model: string, maxTokens: number): JsonObject {
  const gpt = /^gpt-(\d+)/i.exec(model);
  if (!gpt) return { max_tokens: maxTokens };
  return Number(gpt[1]) >= 5
    ? { max_completion_tokens: maxTokens, reasoning_effort: 'none' }
    : { max_completion_tokens: maxTokens };
}

function validationProblem(request: LlmRequest): string | null {
  if (!Array.isArray(request.messages) || request.messages.length === 0) return 'the request has no messages';
  for (const [index, message] of request.messages.entries()) {
    if (!ROLES.has(message?.role)) return `message ${index + 1} has an unknown role`;
    if (typeof message.content !== 'string' || message.content.trim() === '') return `message ${index + 1} is empty`;
  }
  if (request.maxTokens !== undefined && !(Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0)) {
    return 'maxTokens must be a positive whole number';
  }
  return null;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${Number((ms / 1000).toFixed(1))} s`;
}

/** The state of one complete() or stream() call, shared by all its attempts. */
interface Call {
  correlationId: string;
  url: string;
  /** The call deadline combined with the caller's signal. */
  signal: AbortSignal;
  callerSignal?: AbortSignal;
  deadlineAt: number;
  attempt: number;
  slept: number;
}

type StreamOutcome = { result: LlmResult; partialFailure?: Failure } | { failure: Failure };

/** A client for one route over the injected fetch (OpenAI chat-completions wire format). */
export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const { config } = options;
  const fetchFn = options.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const targets: RedactionTargets = { apiKey: config.apiKey, baseUrl: config.baseUrl };

  const log = (level: 'warn' | 'error', message: string) => {
    console[level](redact(`[llm] ${config.route} route: ${message}`, targets));
  };

  function toError(correlationId: string, attempts: number, failure: Failure): LlmError {
    const status = failure.status === undefined ? '' : ` HTTP ${failure.status}`;
    const detail = failure.detail ? ` Detail: ${failure.detail}` : '';
    const tries = attempts === 0 ? 'before any request' : `after ${attempts} attempt${attempts === 1 ? '' : 's'}`;
    log(
      'error',
      `call failed (correlation ${correlationId}): ${failure.kind}${status} ${tries}, model ${config.model}. ${failure.reason}.${detail}`,
    );
    if (failure.permanent) {
      rememberedFailures.set(memoryKey(config), { kind: failure.kind, status: failure.status, reason: failure.reason, correlationId });
    }
    return new LlmError(
      {
        kind: failure.kind,
        message: attempts > 1 ? `${failure.reason} (after ${attempts} attempts)` : failure.reason,
        status: failure.status,
        retryAfterMs: failure.retryAfterMs,
        permanent: failure.permanent,
      },
      { correlationId },
    );
  }

  function deadlineFailure(call: Pick<Call, 'callerSignal'>): Failure {
    const byCaller = call.callerSignal?.aborted === true;
    return {
      kind: 'timeout',
      retryable: false,
      permanent: false,
      reason: byCaller
        ? "the caller's deadline passed before the reply was complete"
        : `no complete reply within the ${formatDuration(config.timeoutMs)} call deadline`,
    };
  }

  /** Validates the request and sets up the call; throws LlmError when no request may be sent. */
  function begin(request: LlmRequest): Call {
    const correlationId = randomUUID();
    const problem = validationProblem(request);
    if (problem !== null) {
      throw toError(correlationId, 0, { kind: 'request', retryable: false, permanent: false, reason: `invalid request: ${problem}` });
    }
    const prior = rememberedFailures.get(memoryKey(config));
    if (prior) {
      log('error', `call refused without a request (correlation ${correlationId}): ${prior.kind} failure remembered from correlation ${prior.correlationId}.`);
      throw new LlmError(
        {
          kind: prior.kind,
          status: prior.status,
          permanent: true,
          message: `${prior.reason}; not tried again in this process (fix it, then restart)`,
        },
        { correlationId },
      );
    }
    if (request.signal?.aborted) throw toError(correlationId, 0, deadlineFailure({ callerSignal: request.signal }));
    let url: string;
    try {
      const endpoint = new URL(config.baseUrl);
      endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/chat/completions`;
      url = endpoint.toString();
    } catch {
      throw toError(correlationId, 0, { kind: 'config', retryable: false, permanent: false, reason: 'LLM_BASE_URL is not a valid URL' });
    }
    const deadline = AbortSignal.timeout(config.timeoutMs);
    return {
      correlationId,
      url,
      signal: request.signal ? AbortSignal.any([request.signal, deadline]) : deadline,
      callerSignal: request.signal,
      deadlineAt: now() + config.timeoutMs,
      attempt: 1,
      slept: 0,
    };
  }

  function send(call: Call, request: LlmRequest, stream: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
    };
    if (config.apiKeyHeader) headers[config.apiKeyHeader] = config.apiKey;
    else headers.authorization = `Bearer ${config.apiKey}`;
    const body: JsonObject = {
      model: config.model,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      ...outputCapFields(config.model, request.maxTokens ?? config.maxTokens),
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (stream) body.stream = true;
    // redirect: manual, so the key is never sent on to wherever a redirect points.
    return fetchFn(call.url, { method: 'POST', headers, body: JSON.stringify(body), signal: call.signal, redirect: 'manual' });
  }

  async function responseFailure(response: Response): Promise<Failure> {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // the status alone still classifies the failure
    }
    return {
      ...failureForStatus(response.status, body),
      retryAfterMs: retryAfterMs(response.headers, now()),
      detail: body === '' ? undefined : excerpt(body, targets),
    };
  }

  function thrownFailure(call: Call, error: unknown): Failure {
    return call.signal.aborted ? deadlineFailure(call) : failureForThrown(error, targets);
  }

  function emptyReply(finishReason: string | null, status: number, body: string): Failure {
    const detail = body === '' ? undefined : excerpt(body, targets);
    const base = { status, retryable: false, permanent: false, detail };
    if (isTruncated(finishReason)) {
      return { ...base, kind: 'request', reason: 'the output token cap ran out before any text (raise LLM_MAX_TOKENS)' };
    }
    if (finishReason === 'content_filter') return { ...base, kind: 'request', reason: 'the model endpoint filtered the reply' };
    return { ...base, kind: 'outage', reason: 'the model endpoint sent an empty reply' };
  }

  /** The delay before the next attempt, or the failure that ends the call. */
  function retryPlan(call: Call, failure: Failure): { delay: number } | { stop: Failure } {
    if (!failure.retryable || call.attempt >= MAX_ATTEMPTS || call.signal.aborted) return { stop: failure };
    const asked = failure.retryAfterMs;
    const delay = asked ?? Math.round(BACKOFF_BASE_MS * 2 ** (call.attempt - 1) * (0.75 + 0.5 * random()));
    if (call.slept + delay <= SLEEP_BUDGET_MS && now() + delay < call.deadlineAt) return { delay };
    if (asked === undefined) return { stop: failure };
    return { stop: { ...failure, reason: `${failure.reason}; it asked to wait ${formatDuration(asked)}, longer than the retry budget allows` } };
  }

  /** Sleeps before a retry. Resolves false if the call was aborted meanwhile. */
  async function pause(call: Call, delay: number): Promise<boolean> {
    const { signal } = call;
    if (signal.aborted) return false;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<false>((resolve) => {
      onAbort = () => resolve(false);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([sleep(delay).then(() => true as const), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  /** After a failed attempt: waits and returns, or throws the LlmError that ends the call. */
  async function retryOrThrow(call: Call, failure: Failure): Promise<void> {
    const plan = retryPlan(call, failure);
    if ('stop' in plan) throw toError(call.correlationId, call.attempt, plan.stop);
    const status = failure.status === undefined ? '' : ` HTTP ${failure.status}`;
    log(
      'warn',
      `attempt ${call.attempt}/${MAX_ATTEMPTS} failed (correlation ${call.correlationId}): ${failure.kind}${status}; ` +
        `retrying in ${plan.delay} ms. ${failure.reason}.${failure.detail ? ` Detail: ${failure.detail}` : ''}`,
    );
    if (!(await pause(call, plan.delay))) throw toError(call.correlationId, call.attempt, deadlineFailure(call));
    call.slept += plan.delay;
    call.attempt += 1;
  }

  async function readCompletion(response: Response): Promise<{ result: LlmResult } | { failure: Failure }> {
    const raw = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return {
        failure: {
          kind: 'outage',
          status: response.status,
          retryable: false,
          permanent: false,
          reason: 'the model endpoint sent a reply that is not JSON',
          detail: excerpt(raw, targets),
        },
      };
    }
    const choice = firstChoice(json);
    const finishReason = finishReasonOf(choice);
    const text = textOf(asObject(choice?.message)?.content);
    if (text.trim() === '') return { failure: emptyReply(finishReason, response.status, raw) };
    return {
      result: { text, finishReason, truncated: isTruncated(finishReason), partial: false, model: reportedModel(json) ?? config.model },
    };
  }

  async function complete(request: LlmRequest): Promise<LlmResult> {
    const call = begin(request);
    for (;;) {
      let failure: Failure;
      try {
        const response = await send(call, request, false);
        const outcome = response.ok ? await readCompletion(response) : { failure: await responseFailure(response) };
        if ('result' in outcome) return outcome.result;
        failure = outcome.failure;
      } catch (error) {
        failure = thrownFailure(call, error);
      }
      await retryOrThrow(call, failure);
    }
  }

  /**
   * Reads one event stream. Yields deltas as they arrive and returns the outcome. Never
   * throws for stream problems: before the first delta it returns a failure (which may be
   * retried); after it, a partial result.
   */
  async function* readStream(call: Call, response: Response): AsyncGenerator<LlmStreamEvent, StreamOutcome> {
    if (response.body === null) {
      return { failure: { kind: 'network', retryable: true, permanent: false, reason: 'the stream had no body' } };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let text = '';
    let heldWhitespace = '';
    let started = false;
    let finishReason: string | null = null;
    let model: string | undefined;
    let sawDone = false;
    let problem: Failure | undefined;

    try {
      reading: for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          problem = thrownFailure(call, error);
          break;
        }
        const events = chunk.done
          ? [...parser.push(decoder.decode()), ...parser.finish()]
          : parser.push(decoder.decode(chunk.value, { stream: true }));
        for (const event of events) {
          const data = event.data.trim();
          if (data === '') continue;
          if (data === '[DONE]') {
            sawDone = true;
            break reading;
          }
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            problem = {
              kind: 'outage',
              retryable: false,
              permanent: false,
              reason: 'the stream carried data that is not JSON',
              detail: excerpt(data, targets),
            };
            break reading;
          }
          if (event.event === 'error' || asObject(json)?.error !== undefined) {
            problem = {
              kind: 'outage',
              retryable: true,
              permanent: false,
              reason: 'the model endpoint reported an error inside the stream',
              detail: excerpt(data, targets),
            };
            break reading;
          }
          model ??= reportedModel(json);
          const choice = firstChoice(json);
          if (!choice) continue; // e.g. the usage chunk, whose choices are empty
          finishReason = finishReasonOf(choice) ?? finishReason;
          const piece = textOf(asObject(choice.delta)?.content);
          if (piece === '') continue;
          if (!started && piece.trim() === '') {
            heldWhitespace += piece; // the first delta must carry real text
            continue;
          }
          const out = heldWhitespace + piece;
          heldWhitespace = '';
          text += out;
          started = true;
          yield { type: 'delta', text: out };
        }
        if (chunk.done) break;
      }
    } finally {
      // Releases the connection on every exit: [DONE], a failure, or a reader that stopped early.
      reader.cancel().catch(() => {});
    }

    if (problem === undefined && !sawDone) {
      problem = { kind: 'network', retryable: true, permanent: false, reason: 'the stream ended before [DONE]' };
    }
    const result: LlmResult = {
      text,
      finishReason,
      truncated: isTruncated(finishReason),
      partial: false,
      model: model ?? config.model,
    };
    if (!started) return { failure: problem ?? emptyReply(finishReason, response.status, '') };
    if (problem === undefined) return { result };
    // The id of the "answer is partial" log line, so the browser's reference leads to the cause.
    return { result: { ...result, partial: true, errorKind: problem.kind, correlationId: call.correlationId }, partialFailure: problem };
  }

  async function* stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent, void, undefined> {
    const call = begin(request);
    for (;;) {
      let response: Response;
      try {
        response = await send(call, request, true);
      } catch (error) {
        await retryOrThrow(call, thrownFailure(call, error));
        continue;
      }
      if (!response.ok) {
        await retryOrThrow(call, await responseFailure(response));
        continue;
      }
      // Not inside a try: once a delta is out, nothing may lead to a retry.
      const outcome = yield* readStream(call, response);
      if ('failure' in outcome) {
        await retryOrThrow(call, outcome.failure);
        continue;
      }
      if (outcome.partialFailure) {
        const lost = outcome.partialFailure;
        log(
          'warn',
          `answer is partial (correlation ${call.correlationId}): ${lost.kind}. ${lost.reason}.` +
            (lost.detail ? ` Detail: ${lost.detail}` : ''),
        );
      }
      yield { type: 'end', result: outcome.result };
      return;
    }
  }

  return {
    route: config.route,
    model: config.model,
    complete,
    stream,
  };
}
