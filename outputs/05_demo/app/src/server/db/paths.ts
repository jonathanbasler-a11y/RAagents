import path from 'node:path';

// Where the chat database lives. Apart from the chat runtime (src/server/chat/boot.ts, which re-exports it) so that the
// proxy's session lookup can find the file without loading the chat store.

/** CHAT_DB_PATH (resolved from the working directory) when set, else .data/chat.db in the working directory. */
export function defaultChatDbPath(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string {
  const fromEnv = env.CHAT_DB_PATH?.trim();
  return fromEnv ? path.resolve(cwd, fromEnv) : path.join(cwd, '.data', 'chat.db');
}
