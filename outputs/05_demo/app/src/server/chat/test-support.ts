// Test-only helpers for the chat tests: temporary stores, a frozen clock, predictable ids
// and gates that hold an async step until the test releases it. Not imported by app code.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '@/server/chat/store';
import type { ChatEvent, Store } from '@/shared/contracts';

export const FROZEN_NOW = new Date('2026-10-07T20:45:00.000Z');

export interface TempStore {
  dir: string;
  dbPath: string;
  store: Store;
  cleanup(): void;
}

/** A store on a fresh temporary file, with a frozen clock and sequential ids. */
export function tempStore(options: { now?: () => Date; newId?: () => string } = {}): TempStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'chat-test-'));
  const dbPath = path.join(dir, 'chat.db');
  const store = createStore(dbPath, { now: options.now ?? (() => FROZEN_NOW), newId: options.newId ?? sequentialIds('row') });
  return {
    dir,
    dbPath,
    store,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** "prefix-1", "prefix-2", ... */
export function sequentialIds(prefix: string): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `${prefix}-${count}`;
  };
}

/** A promise the test resolves by hand. */
export function gate<T = void>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Collects the events of an SSE body (`data: <json>` blocks) until the stream ends. */
export async function readSse(body: ReadableStream<Uint8Array>): Promise<ChatEvent[]> {
  const text = await new Response(body).text();
  return parseSse(text);
}

export function parseSse(text: string): ChatEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as ChatEvent);
}

/** Polls until `check` passes (or fails after `timeoutMs`). */
export async function eventually(check: () => void, timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
