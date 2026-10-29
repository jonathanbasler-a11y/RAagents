import 'server-only';
import { readAccessSetting, type AccessEnv, type AccessSetting } from '@/server/access-gate';
import { migrateChatSchema } from '@/server/chat/schema';
import { createPasswordHasher, type PasswordHasher } from './crypto';
import { accountsDb } from './session-lookup';
import { createAccountStore, type AccountStore } from './store';

// The accounts of this server process: the store on the shared connection, the one password hasher (so its limit on
// hashes at once holds for the whole process), and what the server's start hook (src/instrumentation.ts) does before the
// first request: migrate, write the admin from the server settings, and start the heartbeat of a hosted copy.

const MIGRATED_KEY = Symbol.for('hybrid-team-chat.accounts-migrated');
const HASHER_KEY = Symbol.for('hybrid-team-chat.password-hasher');

type RuntimeHolder = { [MIGRATED_KEY]?: object; [HASHER_KEY]?: PasswordHasher };

/** The account store on this process's connection, migrated once per connection. */
export function getAccountStore(): AccountStore {
  const db = accountsDb();
  const holder = globalThis as RuntimeHolder;
  if (holder[MIGRATED_KEY] !== db) {
    migrateChatSchema(db);
    holder[MIGRATED_KEY] = db;
  }
  return createAccountStore(db);
}

/** The process's password hasher. */
export function getPasswordHasher(): PasswordHasher {
  const holder = globalThis as RuntimeHolder;
  holder[HASHER_KEY] ??= createPasswordHasher();
  return holder[HASHER_KEY];
}

/**
 * Makes the admin named in the server settings match them: created at the first start, given a new hash (ending their
 * sessions) when the password in the settings changed. The password is checked and hashed before the transaction.
 */
export async function prepareAccounts(
  setting: Extract<AccessSetting, { state: 'on' }>,
  store: AccountStore,
  passwords: PasswordHasher,
): Promise<void> {
  const { username, password } = setting.admin;
  const state = store.serverAdminState(username);
  const unchanged = state.existing !== null && (await passwords.verify(password, state.existing.passwordHash));
  store.bootstrapServerAdmin({ username, passwordHash: unchanged ? null : await passwords.hash(password) });
}

let lastHeartbeatWarning = Number.NEGATIVE_INFINITY;

/**
 * Rewrites the heartbeat row now and every `intervalMs` (15 s by default) until stopped. The start script of a new copy
 * reads the backup's newest file time: while this runs, the backup never goes quiet, so a second copy refuses to start
 * (scripts/hosted/start.sh). The timer does not keep the process alive.
 */
export function startHeartbeat(
  store: Pick<AccountStore, 'touchHeartbeat'>,
  log: Pick<Console, 'warn'> = console,
  intervalMs = 15_000,
): () => void {
  const beat = () => {
    try {
      store.touchHeartbeat();
    } catch (error) {
      const at = Date.now();
      if (at - lastHeartbeatWarning >= 60_000) {
        lastHeartbeatWarning = at;
        log.warn(`[hosted] could not write the heartbeat: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export interface HostedServerDeps {
  store: () => AccountStore;
  passwords: () => PasswordHasher;
}

/**
 * The start hook's work. A local copy (no sign-in, no backup) opens nothing. A failure to prepare the admin from the
 * settings is one log line and leaves the server up (people created in the app still sign in; the admin cannot), rather
 * than crash-looping a container, and its restore, over and over.
 */
export async function prepareHostedServer(
  env: AccessEnv,
  log: Pick<Console, 'warn' | 'error'> = console,
  deps: HostedServerDeps = { store: getAccountStore, passwords: getPasswordHasher },
): Promise<{ stopHeartbeat?: () => void }> {
  const setting = readAccessSetting(env);
  const backedUp = (env.LITESTREAM_REPLICA_URL ?? '').trim() !== '';
  if (setting.state !== 'on' && !backedUp) return {};

  let store: AccountStore;
  try {
    store = deps.store();
  } catch (error) {
    log.error(`[accounts] the database could not be opened, so sign-in is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
  if (setting.state === 'on') {
    try {
      await prepareAccounts(setting, store, deps.passwords());
    } catch (error) {
      // Members and existing sessions keep working; the admin from the settings cannot sign in until this is fixed.
      log.error(
        `[accounts] the admin from the server settings cannot sign in until this is fixed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return backedUp ? { stopHeartbeat: startHeartbeat(store, log) } : {};
}
