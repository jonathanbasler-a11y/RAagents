import { describe, expect, it, vi } from 'vitest';
import { createTurnChannel } from '@/server/chat/events';
import type { ChatEvent } from '@/shared/contracts';

const delta = (text: string): ChatEvent => ({ type: 'delta', messageId: 'm1', text });
const done: ChatEvent = { type: 'done', turnId: 't1', status: 'done' };

describe('createTurnChannel', () => {
  it('delivers events to a subscriber in the order they were emitted', () => {
    const channel = createTurnChannel();
    const seen: ChatEvent[] = [];
    channel.subscribe((event) => seen.push(event));

    channel.emit(delta('a'));
    channel.emit(delta('b'));

    expect(seen).toEqual([delta('a'), delta('b')]);
  });

  it('replays every earlier event to a late subscriber, then delivers live events', () => {
    const channel = createTurnChannel();
    channel.emit(delta('a'));
    channel.emit(delta('b'));
    const seen: ChatEvent[] = [];

    channel.subscribe((event) => seen.push(event));
    channel.emit(delta('c'));

    expect(seen).toEqual([delta('a'), delta('b'), delta('c')]);
  });

  it('stops delivering to a subscriber that unsubscribed, and keeps delivering to the others', () => {
    const channel = createTurnChannel();
    const gone: ChatEvent[] = [];
    const stays: ChatEvent[] = [];
    const unsubscribe = channel.subscribe((event) => gone.push(event));
    channel.subscribe((event) => stays.push(event));

    channel.emit(delta('a'));
    unsubscribe();
    channel.emit(delta('b'));

    expect(gone).toEqual([delta('a')]);
    expect(stays).toEqual([delta('a'), delta('b')]);
  });

  it('never throws from emit, even when a listener throws, and still reaches the other listeners', () => {
    const onListenerError = vi.fn();
    const channel = createTurnChannel({ onListenerError });
    const seen: ChatEvent[] = [];
    channel.subscribe(() => {
      throw new Error('listener broke');
    });
    channel.subscribe((event) => seen.push(event));

    expect(() => channel.emit(delta('a'))).not.toThrow();
    expect(seen).toEqual([delta('a')]);
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });

  it('ends every subscriber once on close, and ignores events emitted after it', () => {
    const channel = createTurnChannel();
    const seen: ChatEvent[] = [];
    const onEnd = vi.fn();
    channel.subscribe((event) => seen.push(event), onEnd);

    channel.emit(done);
    channel.close();
    channel.close();
    channel.emit(delta('late'));

    expect(channel.closed).toBe(true);
    expect(seen).toEqual([done]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('gives a subscriber that joins after close the full replay, then ends it at once', () => {
    const channel = createTurnChannel();
    channel.emit(delta('a'));
    channel.emit(done);
    channel.close();
    const seen: ChatEvent[] = [];
    const onEnd = vi.fn();

    channel.subscribe((event) => seen.push(event), onEnd);

    expect(seen).toEqual([delta('a'), done]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('lets a listener unsubscribe while the replay is running', () => {
    const channel = createTurnChannel();
    channel.emit(delta('a'));
    channel.emit(delta('b'));
    const seen: ChatEvent[] = [];
    const handle: { unsubscribe?: () => void } = {};

    handle.unsubscribe = channel.subscribe((event) => {
      seen.push(event);
      handle.unsubscribe?.();
    });
    handle.unsubscribe();
    channel.emit(delta('c'));

    expect(seen).toEqual([delta('a'), delta('b')]);
  });
});
