import 'server-only';

export interface SseEvent {
  /** The `event:` field, or '' when the event has none. */
  event: string;
  /** The event's `data:` lines, joined with "\n". */
  data: string;
}

/**
 * Incremental parser for the text/event-stream line format. Push decoded text as it
 * arrives and get back the events it completes. Lines may end in LF, CRLF or CR (also when
 * a CRLF is split across two reads); a blank line ends an event; lines starting with ":"
 * are comments (keep-alives) and are skipped; `id:` and `retry:` are ignored.
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName = '';

  push(text: string): SseEvent[] {
    this.buffer += text;
    return this.drain(false);
  }

  /** Call once when the body ends. Returns any last event that arrived without its blank line. */
  finish(): SseEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    const terminator = /\r\n|\r|\n/g;
    let lineStart = 0;
    let match: RegExpExecArray | null;
    while ((match = terminator.exec(this.buffer)) !== null) {
      // A CR at the very end may be the first half of a CRLF: wait for the next read.
      if (!final && match[0] === '\r' && match.index === this.buffer.length - 1) break;
      this.readLine(this.buffer.slice(lineStart, match.index), events);
      lineStart = match.index + match[0].length;
    }
    this.buffer = this.buffer.slice(lineStart);
    if (final) {
      if (this.buffer !== '') this.readLine(this.buffer, events);
      this.buffer = '';
      this.dispatch(events);
    }
    return events;
  }

  private readLine(line: string, events: SseEvent[]): void {
    if (line === '') {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventName = value;
  }

  private dispatch(events: SseEvent[]): void {
    if (this.dataLines.length > 0) events.push({ event: this.eventName, data: this.dataLines.join('\n') });
    this.dataLines = [];
    this.eventName = '';
  }
}
