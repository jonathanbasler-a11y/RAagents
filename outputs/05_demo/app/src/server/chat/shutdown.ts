import 'server-only';

// What happens to running turns when the server process is told to stop (SIGINT, SIGTERM).
//
// Each running turn registers a handle here; on a signal every handle saves what its turn has
// so far and marks the turn interrupted (turn-runner.ts supplies that work), then the process
// exits. The registry and the "installed" marks live on globalThis, not in module variables:
// Next.js may load this module once per route bundle, and a signal handler installed by one
// copy must see the turns started by another.

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

/** The part of `process` this module uses. Tests pass a stand-in, so no real signal is ever sent. */
export interface ShutdownProcess {
  prependListener(signal: ShutdownSignal, listener: (signal: ShutdownSignal) => void): unknown;
  removeListener(signal: ShutdownSignal, listener: (signal: ShutdownSignal) => void): unknown;
  listenerCount(signal: ShutdownSignal): number;
  exit(code?: number): unknown;
}

export interface RunningTurnHandle {
  turnId: string;
  /** Saves what the turn has and marks it interrupted. May throw; the caller logs and carries on. */
  interrupt(signal: ShutdownSignal): void;
}

export interface InstallShutdownOptions {
  /** Default: the real process. */
  process?: ShutdownProcess;
  log?: Pick<Console, 'warn' | 'error'>;
  /**
   * When another listener (the web server closing its connections) is still there after the turns
   * are saved, this is how long it gets to end the process before this module does. Default 10 s.
   */
  exitFallbackMs?: number;
}

const REGISTRY_KEY = Symbol.for('hybrid-team-chat.running-turns');
const INSTALLED_KEY = Symbol.for('hybrid-team-chat.shutdown-handlers');

/** The conventional exit code of a process ended by a signal: 128 plus the signal number. */
const EXIT_CODES: Record<ShutdownSignal, number> = { SIGINT: 130, SIGTERM: 143 };
const SIGNALS = Object.keys(EXIT_CODES) as ShutdownSignal[];
export const SHUTDOWN_EXIT_FALLBACK_MS = 10_000;

type Holder = { [REGISTRY_KEY]?: Map<string, RunningTurnHandle>; [INSTALLED_KEY]?: WeakSet<object> };

function registry(): Map<string, RunningTurnHandle> {
  const holder = globalThis as Holder;
  return (holder[REGISTRY_KEY] ??= new Map());
}

function installedMarks(): WeakSet<object> {
  const holder = globalThis as Holder;
  return (holder[INSTALLED_KEY] ??= new WeakSet());
}

/** The real process, through the narrow interface (Node's own overloads do not fit it). */
function realProcess(): ShutdownProcess {
  return {
    // Only SIGINT and SIGTERM are ever passed, so the listener's narrower signal type holds; the same function goes to both calls.
    prependListener: (signal, listener) => process.prependListener(signal, listener as NodeJS.SignalsListener),
    removeListener: (signal, listener) => process.removeListener(signal, listener as NodeJS.SignalsListener),
    listenerCount: (signal) => process.listenerCount(signal),
    exit: (code) => process.exit(code),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Lists a turn as running in this process. Returns the function that takes it off the list again. */
export function registerRunningTurn(handle: RunningTurnHandle): () => void {
  registry().set(handle.turnId, handle);
  return () => {
    // Only the handle that was registered: a newer one under the same id stays.
    if (registry().get(handle.turnId) === handle) registry().delete(handle.turnId);
  };
}

/** The turns this process is running, in the order they started. */
export function registeredTurnIds(): string[] {
  return [...registry().keys()];
}

/** Interrupts every registered turn, in the order they started. A failing turn is logged and does not stop the others. Returns how many were tried. */
export function interruptRunningTurns(signal: ShutdownSignal, log: Pick<Console, 'error'>): number {
  const handles = [...registry().values()];
  for (const handle of handles) {
    try {
      handle.interrupt(signal);
    } catch (error) {
      log.error(`[shutdown] could not save turn ${handle.turnId} on ${signal}: ${describeError(error)}`);
    }
  }
  return handles.length;
}

/**
 * Saves the running turns when the process gets SIGINT or SIGTERM, then lets the process exit.
 * Once per process object (a second call does nothing and returns false). The listener goes in
 * first, so a listener that ends the process at once cannot skip the saving. Taking over the
 * signal turns off Node's default exit, so this handler ends the process itself: with the
 * conventional code when nothing else listens, or after `exitFallbackMs` when another listener
 * (the web server draining its connections) is still there.
 */
export function installShutdownHandler(options: InstallShutdownOptions = {}): boolean {
  const proc: ShutdownProcess = options.process ?? realProcess();
  const log = options.log ?? console;
  const exitFallbackMs = options.exitFallbackMs ?? SHUTDOWN_EXIT_FALLBACK_MS;
  const marks = installedMarks();
  // Keyed on the process itself, not on the adapter built for it.
  const key: object = options.process ?? process;
  if (marks.has(key)) return false;
  marks.add(key);

  for (const signal of SIGNALS) {
    const onSignal = () => {
      log.warn(`[shutdown] ${signal}: saving the turns that are running`);
      const saved = interruptRunningTurns(signal, log);
      log.warn(`[shutdown] ${signal}: ${saved} running turn(s) handled`);
      proc.removeListener(signal, onSignal);
      if (proc.listenerCount(signal) === 0) {
        proc.exit(EXIT_CODES[signal]);
        return;
      }
      const timer = setTimeout(() => proc.exit(EXIT_CODES[signal]), exitFallbackMs);
      timer.unref?.();
    };
    proc.prependListener(signal, onSignal);
  }
  return true;
}
