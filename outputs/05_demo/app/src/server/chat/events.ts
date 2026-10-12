import 'server-only';
import type { ChatEvent } from '@/shared/contracts';

// The in-memory event channel of one running turn. The turn runs detached from the HTTP
// response and emits into its channel; the SSE response subscribes. Every event is kept
// until the channel is dropped, so a subscriber that joins late (or after the turn ended)
// still gets the whole turn. A disconnected browser just unsubscribes: emitting never
// depends on anyone listening, and never throws.

export interface TurnChannel {
  /** Records the event and hands it to every subscriber. Never throws; ignored once closed. */
  emit(event: ChatEvent): void;
  /**
   * Replays every event emitted so far, then delivers new ones. `onEnd` runs once when the
   * channel closes (at once, after the replay, if it already has). Returns an unsubscribe function.
   */
  subscribe(listener: (event: ChatEvent) => void, onEnd?: () => void): () => void;
  /** Ends every subscription. Called once the turn's `done` event is out. */
  close(): void;
  readonly closed: boolean;
}

export interface TurnChannelOptions {
  /** Called when a listener throws; the other listeners and the turn carry on. */
  onListenerError?: (error: unknown) => void;
}

interface Subscriber {
  listener: (event: ChatEvent) => void;
  onEnd?: () => void;
  active: boolean;
}

export function createTurnChannel(options: TurnChannelOptions = {}): TurnChannel {
  const events: ChatEvent[] = [];
  const subscribers = new Set<Subscriber>();
  let closed = false;

  const guarded = (call: () => void) => {
    try {
      call();
    } catch (error) {
      options.onListenerError?.(error);
    }
  };

  const end = (subscriber: Subscriber) => {
    subscriber.active = false;
    subscribers.delete(subscriber);
    const { onEnd } = subscriber;
    if (onEnd) guarded(onEnd);
  };

  return {
    emit(event) {
      if (closed) return;
      events.push(event);
      for (const subscriber of [...subscribers]) {
        if (subscriber.active) guarded(() => subscriber.listener(event));
      }
    },

    subscribe(listener, onEnd) {
      const subscriber: Subscriber = { listener, onEnd, active: true };
      for (const event of events.slice()) {
        if (!subscriber.active) break;
        guarded(() => listener(event));
      }
      if (closed) {
        if (subscriber.active) end(subscriber);
        return () => {
          subscriber.active = false;
        };
      }
      if (subscriber.active) subscribers.add(subscriber);
      return () => {
        subscriber.active = false;
        subscribers.delete(subscriber);
      };
    },

    close() {
      if (closed) return;
      closed = true;
      for (const subscriber of [...subscribers]) end(subscriber);
    },

    get closed() {
      return closed;
    },
  };
}
