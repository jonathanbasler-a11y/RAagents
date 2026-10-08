import {
  CONTRIBUTION_ROLES,
  MESSAGE_STATUSES,
  TURN_STATUSES,
  type ChatEvent,
} from '@/shared/contracts';

/**
 * Server-sent events, read by hand from a fetch() body: the turn endpoint is a POST, so
 * EventSource cannot be used. Lines end with CRLF, LF or a lone CR; a line that starts
 * with ":" is a comment (keep-alive); `data:` lines are joined with "\n"; a blank line
 * ends the event. Other fields (event, id, retry) are not used by this API.
 */

export interface SseDataParser {
  /** Feeds decoded text. Chunk boundaries may fall anywhere, even inside a CRLF pair. */
  push(text: string): void;
  /** End of input: flushes a last line and dispatches an event that lacks only its closing blank line. */
  end(): void;
}

export function createSseDataParser(onData: (data: string) => void): SseDataParser {
  let buffer = '';
  let dataLines: string[] = [];

  function dispatch(): void {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    dataLines = [];
    onData(data);
  }

  function processLine(line: string): void {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment: keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }

  function drain(atEnd: boolean): void {
    let start = 0;
    while (start < buffer.length) {
      let index = start;
      while (index < buffer.length && buffer[index] !== '\n' && buffer[index] !== '\r') index += 1;
      if (index === buffer.length) break; // no line break yet
      if (buffer[index] === '\r' && index === buffer.length - 1 && !atEnd) break; // a "\n" may follow in the next chunk
      processLine(buffer.slice(start, index));
      start = buffer[index] === '\r' && buffer[index + 1] === '\n' ? index + 2 : index + 1;
    }
    buffer = buffer.slice(start);
  }

  return {
    push(text: string) {
      buffer += text;
      drain(false);
    },
    end() {
      drain(true);
      if (buffer !== '') {
        processLine(buffer);
        buffer = '';
      }
      dispatch();
    },
  };
}

type JsonObject = Record<string, unknown>;

const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown) => value === undefined || isString(value);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  isString(value) && (list as readonly string[]).includes(value);

const TERMINAL_TURN_STATUSES = TURN_STATUSES.filter((status) => status !== 'running');

/** Field checks per event type: enough that a malformed event can never reach the UI state. */
const EVENT_CHECKS: Record<ChatEvent['type'], (event: JsonObject) => boolean> = {
  turn: (e) =>
    isString(e.turnId) &&
    isString(e.threadId) &&
    isString(e.roomId) &&
    isString(e.clientTurnId) &&
    isString(e.userMessageId) &&
    isString(e.startedAt),
  route: (e) => {
    const route = e.route as JsonObject | null;
    return (
      typeof route === 'object' &&
      route !== null &&
      isString(route.source) &&
      Array.isArray(route.secondaries) &&
      Array.isArray(route.notConsulted) &&
      Array.isArray(route.notes)
    );
  },
  agent_start: (e) => isString(e.agentId) && isString(e.messageId) && isOneOf(CONTRIBUTION_ROLES, e.role),
  delta: (e) => isString(e.messageId) && isString(e.text),
  no_addition: (e) => isString(e.agentId) && isOptionalString(e.messageId),
  agent_end: (e) => isString(e.messageId) && isOneOf(MESSAGE_STATUSES, e.status) && typeof e.truncated === 'boolean',
  note: (e) => isString(e.text) && isOptionalString(e.messageId),
  error: (e) => isString(e.code) && isString(e.correlationId) && isOptionalString(e.messageId),
  done: (e) => isString(e.turnId) && isOneOf(TERMINAL_TURN_STATUSES, e.status),
  heartbeat: () => true,
};

/** Parses one `data` payload into a ChatEvent, or null when it is not a well-formed event. */
export function parseChatEvent(data: string): ChatEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as JsonObject;
  if (!isString(event.type) || !Object.hasOwn(EVENT_CHECKS, event.type)) return null;
  const check = EVENT_CHECKS[event.type as ChatEvent['type']];
  return check(event) ? (event as unknown as ChatEvent) : null;
}

export type StreamEnd = { reason: 'eof' } | { reason: 'error'; error: unknown } | { reason: 'aborted' };

export interface ReadChatEventsOptions {
  /** Stops reading (the server-side turn is not affected). */
  signal?: AbortSignal;
  /** Called with each payload that is not a well-formed ChatEvent. */
  onInvalid?: (data: string) => void;
}

/**
 * Reads a `text/event-stream` body and calls onEvent for every well-formed ChatEvent.
 * Resolves (never rejects) with why reading stopped: end of stream, a broken stream, or abort.
 */
export async function readChatEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatEvent) => void,
  options: ReadChatEventsOptions = {},
): Promise<StreamEnd> {
  const { signal, onInvalid } = options;
  const decoder = new TextDecoder('utf-8');
  let aborted = signal?.aborted ?? false;
  const parser = createSseDataParser((data) => {
    if (aborted) return;
    const event = parseChatEvent(data);
    if (event) onEvent(event);
    else onInvalid?.(data);
  });

  const reader = body.getReader();
  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => undefined);
  };
  if (aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (aborted) return { reason: 'aborted' };
    parser.push(decoder.decode());
    parser.end();
    return { reason: 'eof' };
  } catch (error) {
    if (aborted) return { reason: 'aborted' };
    // Deliver an event that arrived complete before the break; a truncated one fails to parse.
    parser.end();
    return { reason: 'error', error };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}
