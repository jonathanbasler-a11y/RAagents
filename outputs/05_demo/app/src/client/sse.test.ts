import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@/shared/contracts';
import { createSseDataParser, parseChatEvent, readChatEvents } from './sse';

const encoder = new TextEncoder();

/** A byte stream that delivers the given chunks, then closes (or errors, if `failWith` is set). */
function byteStream(chunks: Array<string | Uint8Array>, failWith?: Error): ReadableStream<Uint8Array> {
  const queue = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) {
        controller.enqueue(next);
        return;
      }
      if (failWith) controller.error(failWith);
      else controller.close();
    },
  });
}

function collectData(chunks: string[]): string[] {
  const out: string[] = [];
  const parser = createSseDataParser((data) => out.push(data));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return out;
}

describe('createSseDataParser', () => {
  it('dispatches one data payload per blank-line-terminated event', () => {
    expect(collectData(['data: one\n\ndata: two\n\n'])).toEqual(['one', 'two']);
  });

  it('joins the data lines of one event with a newline', () => {
    expect(collectData(['data: {"type":"note",\ndata: "text":"x"}\n\n'])).toEqual(['{"type":"note",\n"text":"x"}']);
  });

  it('accepts CRLF and lone CR line endings', () => {
    expect(collectData(['data: a\r\n\r\ndata: b\r\rdata: c\n\n'])).toEqual(['a', 'b', 'c']);
  });

  it('treats a CRLF split across two chunks as one line break', () => {
    // Read as two breaks, "\r" + "\n" would end the event early and yield "a" and "b".
    expect(collectData(['data: a\r', '\ndata: b\r\n\r\n'])).toEqual(['a\nb']);
  });

  it('reassembles a line split in the middle by a chunk boundary', () => {
    expect(collectData(['da', 'ta: hel', 'lo\n', '\n'])).toEqual(['hello']);
  });

  it('ignores comment lines such as keep-alives', () => {
    expect(collectData([': keep-alive\n\n', 'data: real\n\n', ':\n\n'])).toEqual(['real']);
  });

  it('strips exactly one space after the colon', () => {
    expect(collectData(['data:  two spaces\n\ndata:none\n\n'])).toEqual([' two spaces', 'none']);
  });

  it('ignores event, id and retry fields', () => {
    expect(collectData(['event: message\nid: 7\nretry: 100\ndata: x\n\n'])).toEqual(['x']);
  });

  it('dispatches a final event that lacks only the closing blank line', () => {
    expect(collectData(['data: last\n'])).toEqual(['last']);
    expect(collectData(['data: last'])).toEqual(['last']);
  });
});

describe('parseChatEvent', () => {
  it('returns the event for a well-formed payload', () => {
    expect(parseChatEvent('{"type":"delta","messageId":"m1","text":"Hi"}')).toEqual({
      type: 'delta',
      messageId: 'm1',
      text: 'Hi',
    });
  });

  it.each([
    ['not JSON', '{"type":"delta","mess'],
    ['an array', '[1,2]'],
    ['no type', '{"messageId":"m1"}'],
    ['an unknown type', '{"type":"telemetry"}'],
    ['a delta without text', '{"type":"delta","messageId":"m1"}'],
    ['an agent_end without a status', '{"type":"agent_end","messageId":"m1","truncated":false}'],
    ['an error without a correlation id', '{"type":"error","code":"internal"}'],
    ['a done without a status', '{"type":"done","turnId":"t1"}'],
  ])('returns null for %s', (_label, data) => {
    expect(parseChatEvent(data)).toBeNull();
  });
});

describe('readChatEvents', () => {
  it('delivers events split across chunk boundaries, including inside a multi-byte character', async () => {
    const payload = encoder.encode('data: {"type":"delta","messageId":"m1","text":"Model · not sourced"}\n\n');
    const middleDot = payload.indexOf(0xc2); // first byte of "·" (0xC2 0xB7)
    const chunks = [payload.slice(0, 9), payload.slice(9, middleDot + 1), payload.slice(middleDot + 1)];
    const events: ChatEvent[] = [];

    const end = await readChatEvents(byteStream(chunks), (event) => events.push(event));

    expect(end).toEqual({ reason: 'eof' });
    expect(events).toEqual([{ type: 'delta', messageId: 'm1', text: 'Model · not sourced' }]);
  });

  it('passes heartbeat events through and skips keep-alive comments', async () => {
    const events: ChatEvent[] = [];

    await readChatEvents(byteStream([': ping\n\n', 'data: {"type":"heartbeat"}\n\n']), (event) => events.push(event));

    expect(events).toEqual([{ type: 'heartbeat' }]);
  });

  it('skips invalid payloads, reports them, and keeps reading', async () => {
    const events: ChatEvent[] = [];
    const onInvalid = vi.fn();

    await readChatEvents(
      byteStream(['data: {oops\n\n', 'data: {"type":"done","turnId":"t1","status":"done"}\n\n']),
      (event) => events.push(event),
      { onInvalid },
    );

    expect(onInvalid).toHaveBeenCalledWith('{oops');
    expect(events).toEqual([{ type: 'done', turnId: 't1', status: 'done' }]);
  });

  it('reports a truncated final event as invalid instead of delivering it', async () => {
    const events: ChatEvent[] = [];
    const onInvalid = vi.fn();

    await readChatEvents(byteStream(['data: {"type":"delta","messageId":"m1","te']), (event) => events.push(event), {
      onInvalid,
    });

    expect(events).toEqual([]);
    expect(onInvalid).toHaveBeenCalledTimes(1);
  });

  it('returns reason "error" when the stream breaks, after delivering what arrived', async () => {
    const events: ChatEvent[] = [];
    const broken = new Error('connection reset');

    const end = await readChatEvents(
      byteStream(['data: {"type":"delta","messageId":"m1","text":"Part"}\n\n', 'data: {"type":"del'], broken),
      (event) => events.push(event),
    );

    expect(end).toEqual({ reason: 'error', error: broken });
    expect(events).toEqual([{ type: 'delta', messageId: 'm1', text: 'Part' }]);
  });

  it('returns reason "aborted" when the signal is aborted', async () => {
    const controller = new AbortController();
    const events: ChatEvent[] = [];
    const never = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'));
      },
    });

    const reading = readChatEvents(never, (event) => {
      events.push(event);
      controller.abort();
    }, { signal: controller.signal });

    await expect(reading).resolves.toEqual({ reason: 'aborted' });
    expect(events).toEqual([{ type: 'heartbeat' }]);
  });
});
