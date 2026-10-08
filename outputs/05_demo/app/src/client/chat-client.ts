import type {
  AgentId,
  ApiErrorBody,
  ChatEvent,
  ChatLimits,
  HealthResponse,
  NewThreadRequest,
  NewThreadResponse,
  PostTurnRequest,
  RoomId,
  RoomMessagesResponse,
  SelectionResponse,
  SelectionUpdateRequest,
  TurnDuplicateResponse,
  TurnStatus,
} from '@/shared/contracts';
import { readChatEvents } from './sse';

/**
 * Browser client for the chat API. Every request goes to the same origin, so the
 * browser sets `Sec-Fetch-Site: same-origin` itself; every POST sends JSON.
 *
 * The one rule that matters most: once the server has answered a turn POST, the turn
 * is never POSTed again. Only a request that failed before any response may be tried
 * once more, with the same clientTurnId (the server treats a repeat as a no-op).
 */

export const TURN_TEXT_MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;
const RETRY_DELAY_MS = 500;

export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;
}

/**
 * A version 4 UUID. crypto.randomUUID exists only in secure contexts (HTTPS and
 * localhost); a page opened over plain HTTP from another host falls back to getRandomValues.
 */
export function createClientTurnId(cryptoLike: CryptoLike): string {
  if (typeof cryptoLike.randomUUID === 'function') return cryptoLike.randomUUID();
  const bytes = cryptoLike.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** ICU's name for a time zone it could not detect; not a zone the server can use. */
const UNKNOWN_TIME_ZONE = 'Etc/Unknown';

function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone !== UNKNOWN_TIME_ZONE ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface ChatClientDeps {
  /** Injected in tests. Default: the global fetch, looked up at call time. */
  fetch?: typeof fetch;
  newClientTurnId?: () => string;
  timeZone?: () => string;
  /** Wait before the single pre-response retry. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PostTurnHandlers {
  /** The server answered (any status). Called once, before any event. */
  onResponse?: (status: number) => void;
  onEvent?: (event: ChatEvent) => void;
  /** A payload that was not a well-formed event (it is skipped). */
  onInvalidEvent?: (data: string) => void;
}

export interface PostTurnOptions {
  /** Stops reading the stream. The turn keeps running on the server. */
  signal?: AbortSignal;
}

export type DoneEvent = Extract<ChatEvent, { type: 'done' }>;

export type PostTurnOutcome =
  /** The server streamed. done is null when the stream ended early or broke (broken: true). */
  | { kind: 'stream'; clientTurnId: string; done: DoneEvent | null; broken: boolean }
  /** The server had already seen this clientTurnId: follow the turn through the messages API. */
  | { kind: 'duplicate'; clientTurnId: string; turnId: string; status: TurnStatus }
  /** The server answered without a stream (4xx/5xx, or an unexpected 200). */
  | { kind: 'rejected'; clientTurnId: string; status: number; error: ApiErrorBody | null }
  /** No response at all, after the one retry. The server may or may not have the turn. */
  | { kind: 'network_error'; clientTurnId: string; message: string }
  | { kind: 'aborted'; clientTurnId: string }
  /** Refused before any request (empty or too long). */
  | { kind: 'invalid'; message: string };

export type ApiResult<T> =
  | { ok: true; data: T }
  /** status 0: the server could not be reached. */
  | { ok: false; status: number; error: ApiErrorBody | null; message: string };

export interface ChatApi {
  postTurn(room: RoomId, text: string, handlers?: PostTurnHandlers, options?: PostTurnOptions): Promise<PostTurnOutcome>;
  getMessages(room: RoomId, options?: { signal?: AbortSignal }): Promise<ApiResult<RoomMessagesResponse>>;
  newConversation(room: RoomId): Promise<ApiResult<NewThreadResponse>>;
  getHealth(): Promise<ApiResult<HealthResponse>>;
  getSelection(): Promise<ApiResult<SelectionResponse>>;
  setSelection(agentId: AgentId, selected: boolean): Promise<ApiResult<SelectionResponse>>;
}

const UNREACHABLE_MESSAGE = 'Could not reach the server. Check the connection and try again.';

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.error === 'string' && typeof body.message === 'string' && typeof body.correlationId === 'string';
}

function isDuplicate(value: unknown): value is TurnDuplicateResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return body.duplicate === true && typeof body.turnId === 'string' && typeof body.status === 'string';
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

async function readJson(response: Response): Promise<unknown> {
  if (!isJson(response)) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function roomPath(room: RoomId, leaf: 'turns' | 'messages' | 'new'): string {
  return `/api/rooms/${encodeURIComponent(room)}/${leaf}`;
}

export function createChatClient(deps: ChatClientDeps = {}): ChatApi {
  // Never call an injected or global fetch as a method: some browsers throw "Illegal invocation".
  const fetchFn: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const newId = deps.newClientTurnId ?? (() => createClientTurnId(globalThis.crypto));
  const timeZone = deps.timeZone ?? browserTimeZone;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await fetchFn(path, { cache: 'no-store', ...init });
    } catch {
      return { ok: false, status: 0, error: null, message: UNREACHABLE_MESSAGE };
    }
    const body = await readJson(response);
    if (response.ok && body !== undefined) return { ok: true, data: body as T };
    const error = isApiErrorBody(body) ? body : null;
    const message = error?.message ?? `The server answered with status ${response.status}.`;
    return { ok: false, status: response.status, error, message };
  }

  function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return requestJson<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function postTurn(
    room: RoomId,
    text: string,
    handlers: PostTurnHandlers = {},
    options: PostTurnOptions = {},
  ): Promise<PostTurnOutcome> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { kind: 'invalid', message: 'Type a question first.' };
    if (trimmed.length > TURN_TEXT_MAX_CHARS) {
      return { kind: 'invalid', message: `Questions can be at most ${TURN_TEXT_MAX_CHARS.toLocaleString('en')} characters.` };
    }

    const { signal } = options;
    const request: PostTurnRequest = { text: trimmed, clientTurnId: newId(), tz: timeZone() };
    const { clientTurnId } = request;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal,
    };

    let response: Response;
    try {
      response = await fetchFn(roomPath(room, 'turns'), init);
    } catch (error) {
      if (isAbort(error, signal)) return { kind: 'aborted', clientTurnId };
      // No response at all: the one permitted retry, with the same clientTurnId.
      await sleep(RETRY_DELAY_MS);
      if (signal?.aborted) return { kind: 'aborted', clientTurnId };
      try {
        response = await fetchFn(roomPath(room, 'turns'), init);
      } catch (retryError) {
        if (isAbort(retryError, signal)) return { kind: 'aborted', clientTurnId };
        return { kind: 'network_error', clientTurnId, message: UNREACHABLE_MESSAGE };
      }
    }

    // The server has answered. From here on this turn is never POSTed again.
    handlers.onResponse?.(response.status);

    if (!response.ok) {
      const body = await readJson(response);
      return { kind: 'rejected', clientTurnId, status: response.status, error: isApiErrorBody(body) ? body : null };
    }
    if (isJson(response)) {
      const body = await readJson(response);
      if (isDuplicate(body)) return { kind: 'duplicate', clientTurnId, turnId: body.turnId, status: body.status };
      return { kind: 'rejected', clientTurnId, status: response.status, error: isApiErrorBody(body) ? body : null };
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/event-stream') || !response.body) {
      return { kind: 'rejected', clientTurnId, status: response.status, error: null };
    }

    let done: DoneEvent | null = null;
    const end = await readChatEvents(
      response.body,
      (event) => {
        if (event.type === 'done') done = event;
        handlers.onEvent?.(event);
      },
      { signal, onInvalid: handlers.onInvalidEvent },
    );
    if (end.reason === 'aborted') return { kind: 'aborted', clientTurnId };
    return { kind: 'stream', clientTurnId, done, broken: end.reason === 'error' };
  }

  return {
    postTurn,
    getMessages: (room, options = {}) =>
      requestJson<RoomMessagesResponse>(roomPath(room, 'messages'), {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      }),
    newConversation: (room) => postJson<NewThreadResponse>(roomPath(room, 'new'), {} satisfies NewThreadRequest),
    getHealth: () => requestJson<HealthResponse>('/api/health', { headers: { Accept: 'application/json' } }),
    getSelection: () => requestJson<SelectionResponse>('/api/selection', { headers: { Accept: 'application/json' } }),
    setSelection: (agentId, selected) =>
      postJson<SelectionResponse>('/api/selection', { agentId, selected } satisfies SelectionUpdateRequest),
  };
}

/** The app's client: global fetch, crypto and Intl, looked up when each call is made. */
export const chatClient: ChatApi = createChatClient();

export const { postTurn, getMessages, newConversation, getHealth, getSelection, setSelection } = chatClient;
