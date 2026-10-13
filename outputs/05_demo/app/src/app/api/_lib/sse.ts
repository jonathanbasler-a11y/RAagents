import 'server-only';
import type { TurnChannel } from '@/server/chat/events';
import type { ChatEvent, ChatLimits } from '@/shared/contracts';

// The SSE response of a turn: one `data: <JSON>` block per event, a heartbeat every 15 s,
// closed after `done`. It only listens to the turn's channel. When the browser goes away
// the stream is cancelled and stops writing; the turn itself is not affected.

export const HEARTBEAT_MS: ChatLimits['heartbeatMs'] = 15_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, no-transform',
  'X-Accel-Buffering': 'no',
} as const;

export function sseResponse(channel: TurnChannel, options: { heartbeatMs?: number } = {}): Response {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const encoder = new TextEncoder();
  let open = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  /** Stops writing and listening. Returns false if that had already happened. */
  const stopListening = (): boolean => {
    if (!open) return false;
    open = false;
    clearInterval(heartbeat);
    unsubscribe?.();
    return true;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (!stopListening()) return;
        try {
          controller.close();
        } catch {
          // already closed or cancelled
        }
      };
      const write = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          stopListening(); // the browser went away: stop writing; the turn carries on
        }
      };

      heartbeat = setInterval(() => write({ type: 'heartbeat' }), heartbeatMs);
      unsubscribe = channel.subscribe(
        (event) => {
          write(event);
          if (event.type === 'done') finish();
        },
        finish,
      );
      // The turn may already have ended during the replay above.
      if (!open) unsubscribe();
    },
    cancel() {
      stopListening();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
