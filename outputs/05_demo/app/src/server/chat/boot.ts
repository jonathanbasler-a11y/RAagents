import 'server-only';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { checkEnvFilePermissions } from '@/server/llm';
import type { DefaultWorkspaceId, Store } from '@/shared/contracts';
import { createStore } from './store';

// The chat runtime of this server process: one store, one boot id, reconciled once.
// It lives on globalThis, not in a module variable: Next.js may load this module more than
// once (one copy per route bundle, or again after a dev reload), and a second boot id in
// the same process would mark that process's own running turns as interrupted.

export const WORKSPACE_ID: DefaultWorkspaceId = 'demo';

export interface ChatRuntime {
  readonly store: Store;
  /** Stamped on every turn this process starts. */
  readonly bootId: string;
  /** When this server process started (a change means a restart). */
  readonly startedAt: string;
  readonly workspaceId: DefaultWorkspaceId;
  /** Turns left running by an earlier process, marked interrupted at start. */
  readonly reconciled: number;
}

export interface ChatRuntimeOptions {
  /** Default: defaultChatDbPath(). */
  dbPath?: string;
  /** Default: a random UUID. */
  bootId?: string;
  now?: () => Date;
  newId?: () => string;
  log?: Pick<Console, 'warn'>;
}

const RUNTIME_KEY = Symbol.for('hybrid-team-chat.runtime');

type RuntimeHolder = { [RUNTIME_KEY]?: ChatRuntime };

/** CHAT_DB_PATH (resolved from the working directory) when set, else .data/chat.db in the working directory. */
export function defaultChatDbPath(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string {
  const fromEnv = env.CHAT_DB_PATH?.trim();
  return fromEnv ? path.resolve(cwd, fromEnv) : path.join(cwd, '.data', 'chat.db');
}

/** Opens the store and marks turns left running by another process as interrupted. */
export function createChatRuntime(options: ChatRuntimeOptions = {}): ChatRuntime {
  const store = createStore(options.dbPath ?? defaultChatDbPath(), { now: options.now, newId: options.newId });
  const bootId = options.bootId ?? randomUUID();
  let reconciled: number;
  try {
    reconciled = store.reconcileStaleTurns(bootId);
  } catch (error) {
    store.close();
    throw error;
  }
  if (reconciled > 0) {
    (options.log ?? console).warn(`[chat] marked ${reconciled} turn(s) left running by an earlier server process as interrupted`);
  }
  const startedAt = new Date(Math.round(Date.now() - process.uptime() * 1000)).toISOString();
  return Object.freeze({ store, bootId, startedAt, workspaceId: WORKSPACE_ID, reconciled });
}

/** The process-wide runtime, created on first use (that first use reconciles stale turns). */
export function getChatRuntime(): ChatRuntime {
  const holder = globalThis as RuntimeHolder;
  const existing = holder[RUNTIME_KEY];
  if (existing) return existing;
  // Once per process: warns in the server log if .env.local is readable by others (mode bits only).
  checkEnvFilePermissions();
  const runtime = createChatRuntime();
  holder[RUNTIME_KEY] = runtime;
  return runtime;
}

/** Closes the process-wide runtime; the next getChatRuntime opens a new one. */
export function closeChatRuntime(): void {
  const holder = globalThis as RuntimeHolder;
  const existing = holder[RUNTIME_KEY];
  if (!existing) return;
  delete holder[RUNTIME_KEY];
  existing.store.close();
}
