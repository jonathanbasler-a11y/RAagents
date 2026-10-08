// The demo launcher's decisions (scripts/demo/demo.mjs), free of I/O so they can be unit-tested:
// fs, fetch, the clock and sleep are injected. Nothing here reads a model settings file: live mode
// only locates one and hands its path to Node (--env-file), so its values never pass through here.

import { join, resolve } from 'node:path';

/** @typedef {'live' | 'practice'} DemoMode */
/**
 * What answers on the demo port: nothing, this app (in which mode), or another program.
 * @typedef {{ state: 'free' } | { state: 'demo', mode: DemoMode, startedAt: string, report?: unknown } | { state: 'other', detail: string }} Probe
 */
/** The demo this folder started, from .data/demo.pid, and whether its server still runs. @typedef {{ port: number, mode: DemoMode, alive: boolean }} RecordedDemo */
/**
 * .data/demo.pid: what demo:stop needs. startedAtMs guards against a pid reused after a reboot.
 * @typedef {{ mode: DemoMode, port: number, serverPid: number, fakePid: number | null, startedAtMs: number, commit: string | null }} PidRecord
 */

export const DEFAULT_PORT = 3200;
export const HOST = '127.0.0.1';
/** The build folder unless NEXT_DIST_DIR names another. One build serves both modes: the mode is chosen when the server starts. */
export const DIST_DIR = '.next-demo';
export const MIN_NODE_MAJOR = 24;

export const USAGE = 'Usage: node scripts/demo/demo.mjs <live|practice|stop> [--no-open] [--rebuild]';

const START_FLAGS = ['--no-open', '--rebuild'];

/** @param {DemoMode} mode */
export function scriptFor(mode) {
  return mode === 'practice' ? 'demo:practice' : 'demo';
}

/** @param {number} port */
export function demoUrls(port) {
  const base = `http://${HOST}:${port}`;
  return { overview: `${base}/`, team: `${base}/team`, workspace: `${base}/workspace` };
}

/**
 * The command, the flags, the port (DEMO_PORT, else 3200) and the build folder (NEXT_DIST_DIR,
 * else .next-demo).
 * @param {string[]} argv
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ command: 'live' | 'practice' | 'stop', open: boolean, rebuild: boolean, port: number, distDir: string }}
 */
export function parseArgs(argv, env) {
  const [command, ...flags] = argv;
  if (command !== 'live' && command !== 'practice' && command !== 'stop') {
    const got = command === undefined ? '' : ` (got "${command}")`;
    throw new Error(`say live, practice or stop${got}. ${USAGE}`);
  }
  let open = true;
  let rebuild = false;
  for (const flag of flags) {
    if (command === 'stop' || !START_FLAGS.includes(flag)) throw new Error(`unknown option "${flag}" for ${command}. ${USAGE}`);
    if (flag === '--no-open') open = false;
    if (flag === '--rebuild') rebuild = true;
  }
  return { command, open, rebuild, port: portFrom(env.DEMO_PORT), distDir: distDirFrom(env.NEXT_DIST_DIR) };
}

/** The same rule as next.config.ts, checked before anything starts. @param {string | undefined} raw */
function distDirFrom(raw) {
  if (raw === undefined || raw === '') return DIST_DIR;
  if (!/^\.next(-[A-Za-z0-9_-]+)?$/.test(raw)) {
    throw new Error(`NEXT_DIST_DIR must be ".next" or ".next-<label>" (letters, digits, "-" or "_"); got "${raw}"`);
  }
  return raw;
}

/** @param {string | undefined} raw */
function portFrom(raw) {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const text = raw.trim();
  const port = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DEMO_PORT must be a port number from 1 to 65535; got "${raw}"`);
  }
  return port;
}

/**
 * A path for messages: the home folder shown as ~.
 * @param {string} path @param {string} homeDir
 */
export function displayPath(path, homeDir) {
  if (homeDir !== '' && (path === homeDir || path.startsWith(`${homeDir}/`))) return `~${path.slice(homeDir.length)}`;
  return path;
}

/** @param {string} value @param {string} homeDir @param {string} cwd */
function expandPath(value, homeDir, cwd) {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return join(homeDir, value.slice(2));
  return resolve(cwd, value);
}

/**
 * Live mode's model settings: the first file that exists of $RAAGENTS_ENV_FILE,
 * ~/.config/raagents/llm.env and the app's own .env.local. Only checks that the file is there.
 * @param {{ env: Readonly<Record<string, string | undefined>>, homeDir: string, cwd: string, appDir: string, isFile: (path: string) => boolean }} options
 * @returns {{ file: { path: string, label: string } | null, tried: string[], warnings: string[] }}
 */
export function findEnvFile({ env, homeDir, cwd, appDir, isFile }) {
  /** @type {{ path: string, label: string, tried: string, fromEnv: boolean }[]} */
  const candidates = [];
  const fromEnv = env.RAAGENTS_ENV_FILE?.trim();
  if (fromEnv) {
    const path = expandPath(fromEnv, homeDir, cwd);
    candidates.push({ path, label: '$RAAGENTS_ENV_FILE', tried: `$RAAGENTS_ENV_FILE (${displayPath(path, homeDir)})`, fromEnv: true });
  }
  candidates.push(
    { path: join(homeDir, '.config', 'raagents', 'llm.env'), label: '~/.config/raagents/llm.env', tried: '~/.config/raagents/llm.env', fromEnv: false },
    { path: join(appDir, '.env.local'), label: '.env.local', tried: '.env.local', fromEnv: false },
  );

  const tried = candidates.map((candidate) => candidate.tried);
  /** @type {string[]} */
  const warnings = [];
  for (const candidate of candidates) {
    if (isFile(candidate.path)) return { file: { path: candidate.path, label: candidate.label }, tried, warnings };
    if (candidate.fromEnv) warnings.push(`RAAGENTS_ENV_FILE is set, but there is no file at ${displayPath(candidate.path, homeDir)}.`);
  }
  return { file: null, tried, warnings };
}

const GROUP_OR_OTHERS_READ = 0o044;

/**
 * A settings file that other users can read, from its mode bits (fs.statSync), never its contents.
 * @param {number} mode @param {string} shownPath
 */
export function envFilePermissionProblem(mode, shownPath) {
  if ((mode & GROUP_OR_OTHERS_READ) === 0) return null;
  return `${shownPath} can be read by other users on this computer. Run: chmod 600 ${shownPath}`;
}

/**
 * The environment `next start` runs with. Every inherited LLM_* name is dropped: live mode takes
 * them from the settings file only (Node --env-file), practice mode points them all at the
 * stand-in model. DEMO_MODE, the database and the build folder are always set, so a value in
 * .env.local cannot change them.
 * @param {{ mode: DemoMode, baseEnv: Readonly<Record<string, string | undefined>>, appDir: string, distDir?: string, fakeBaseUrl?: string }} options
 * @returns {Record<string, string>}
 */
export function serverEnv({ mode, baseEnv, appDir, distDir = DIST_DIR, fakeBaseUrl }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (!name.startsWith('LLM_') && value !== undefined) env[name] = value;
  }
  env.NEXT_DIST_DIR = distDir;
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.CHAT_DB_PATH = join(appDir, '.data', mode === 'practice' ? 'demo-practice.db' : 'demo.db');
  env.DEMO_MODE = mode;
  if (mode === 'practice') {
    if (!fakeBaseUrl) throw new Error('practice mode needs the address of the stand-in model');
    Object.assign(env, {
      LLM_BASE_URL: fakeBaseUrl,
      LLM_API_KEY: 'fake-practice-key',
      LLM_API_KEY_HEADER: 'authorization',
      LLM_MODEL: 'fake-practice-model',
      LLM_MAX_TOKENS: '1500',
      LLM_JUDGE_BASE_URL: fakeBaseUrl,
      LLM_JUDGE_API_KEY: 'fake-practice-judge-key',
      LLM_JUDGE_API_KEY_HEADER: 'authorization',
      LLM_JUDGE_MODEL: 'fake-practice-judge-model',
    });
  }
  return env;
}

/** The LLM_* names the app reads (src/server/llm/config.ts). */
const APP_LLM_NAMES = [
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_API_KEY_HEADER',
  'LLM_MODEL',
  'LLM_MAX_TOKENS',
  'LLM_JUDGE_BASE_URL',
  'LLM_JUDGE_API_KEY',
  'LLM_JUDGE_API_KEY_HEADER',
  'LLM_JUDGE_MODEL',
];

/**
 * The environment `next build` runs with. The build needs no model settings, and Next.js never
 * replaces a name that is already set, even to "", so blank names keep .env.local's values out.
 * @param {{ baseEnv: Readonly<Record<string, string | undefined>>, appDir: string, distDir?: string }} options
 */
export function buildEnv({ baseEnv, appDir, distDir = DIST_DIR }) {
  const env = serverEnv({ mode: 'live', baseEnv, appDir, distDir });
  for (const name of APP_LLM_NAMES) env[name] = '';
  return env;
}

/**
 * Arguments for scripts/fake-llm.mjs. Dara replies NO_ADDITION unless FAKE_LLM_NO_ADDITION says
 * otherwise, so step 5 of LIVE-DEMO.md shows "Dara had nothing to add." every time.
 * @param {{ port: number, env: Readonly<Record<string, string | undefined>> }} options
 */
export function fakeLlmArgs({ port, env }) {
  return [`--port=${port}`, `--host=${HOST}`, `--no-addition=${env.FAKE_LLM_NO_ADDITION ?? 'Dara'}`];
}

/** @param {unknown} error @param {number} [depth] @returns {boolean} */
function isConnectionRefused(error, depth = 0) {
  if (typeof error !== 'object' || error === null || depth > 5) return false;
  const { code, errors, cause } = /** @type {{ code?: unknown, errors?: unknown, cause?: unknown }} */ (error);
  if (code === 'ECONNREFUSED') return true;
  if (Array.isArray(errors) && errors.length > 0 && errors.every((inner) => isConnectionRefused(inner, depth + 1))) return true;
  return isConnectionRefused(cause, depth + 1);
}

/** @param {unknown} error */
function isTimeout(error) {
  return typeof error === 'object' && error !== null && /** @type {{ name?: unknown }} */ (error).name === 'TimeoutError';
}

/** @param {unknown} error */
export function describeError(error) {
  if (error instanceof Error) {
    const code = /** @type {{ code?: unknown }} */ (error.cause ?? {}).code;
    return typeof code === 'string' ? `${error.message}: ${code}` : error.message;
  }
  return String(error);
}

/** GET /api/health of this app, as the real route answers it (src/app/api/_lib/health.ts). @param {unknown} body */
function isHealthReport(body) {
  if (typeof body !== 'object' || body === null) return false;
  const report = /** @type {Record<string, unknown>} */ (body);
  return (
    typeof report.status === 'string' &&
    typeof report.checks === 'object' &&
    report.checks !== null &&
    typeof report.agentCount === 'number' &&
    typeof report.llm === 'object' &&
    report.llm !== null &&
    typeof report.startedAt === 'string'
  );
}

/**
 * Asks /api/health on the port. A build without a mode in its report is live.
 * @param {{ fetch: (input: string, init?: RequestInit) => Promise<Response>, port: number, timeoutMs?: number }} options
 * @returns {Promise<Probe>}
 */
export async function probeDemo({ fetch, port, timeoutMs = 2000 }) {
  let response;
  try {
    response = await fetch(`http://${HOST}:${port}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isConnectionRefused(error)) return { state: 'free' };
    const detail = isTimeout(error) ? `it did not answer within ${timeoutMs / 1000} s` : `it could not be asked: ${describeError(error)}`;
    return { state: 'other', detail };
  }
  /** @type {unknown} */
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && isHealthReport(body)) {
    const report = /** @type {{ mode?: unknown, startedAt: string }} */ (body);
    return { state: 'demo', mode: report.mode === 'practice' ? 'practice' : 'live', startedAt: report.startedAt, report: body };
  }
  return { state: 'other', detail: `it answered /api/health with HTTP ${response.status}, not with this app's health report` };
}

/**
 * Start, just open the pages, or refuse with a message that says what to do.
 * @param {{ requested: DemoMode, port: number, probe: Probe, recorded: RecordedDemo | null }} options
 * @returns {{ action: 'start' } | { action: 'open', note: string | null } | { action: 'refuse', message: string }}
 */
export function decideStart({ requested, port, probe, recorded }) {
  const ours = recorded !== null && recorded.alive && recorded.port === port;
  const otherPort = port === 65535 ? port - 1 : port + 1;
  if (probe.state === 'demo') {
    if (probe.mode === requested) {
      return {
        action: 'open',
        note: ours ? null : 'This demo was not started from this folder (or its record is gone), so npm run demo:stop here cannot stop it.',
      };
    }
    return {
      action: 'refuse',
      message:
        `A ${probe.mode} demo is already running on port ${port}. Stop it first with npm run demo:stop` +
        `${ours ? '' : ' in the folder that started it'}, or start the ${requested} demo on another port, for example: ` +
        `DEMO_PORT=${otherPort} npm run ${scriptFor(requested)}`,
    };
  }
  if (probe.state === 'other') {
    return {
      action: 'refuse',
      message:
        `Port ${port} is in use by another program (${probe.detail}). Stop that program, or use another port, ` +
        `for example: DEMO_PORT=${otherPort} npm run ${scriptFor(requested)}`,
    };
  }
  if (recorded !== null && recorded.alive) {
    if (recorded.port !== port) {
      return {
        action: 'refuse',
        message: `The ${recorded.mode} demo started from this folder is still running on port ${recorded.port}. Stop it first: npm run demo:stop`,
      };
    }
    return {
      action: 'refuse',
      message: `The demo server started from this folder is still starting or not answering on port ${port}. Wait a moment and run this again, or stop it: npm run demo:stop`,
    };
  }
  return { action: 'start' };
}

/** @param {string | null} commit */
const shortCommit = (commit) => (commit ? commit.slice(0, 7) : 'unknown');

/**
 * Build once per commit: when there is no build, when it was made for another commit, or on --rebuild.
 * Uncommitted changes do not trigger a build (--rebuild includes them).
 * @param {{ hasBuild: boolean, builtCommit: string | null, commit: string | null, rebuild: boolean }} options
 */
export function buildPlan({ hasBuild, builtCommit, commit, rebuild }) {
  if (rebuild) return { build: true, reason: 'you asked for --rebuild' };
  if (!hasBuild) return { build: true, reason: 'there is no demo build yet' };
  if (commit === null) return { build: false, reason: 'this folder is not a git checkout, so the existing demo build is used' };
  if (builtCommit !== commit) {
    return { build: true, reason: `the last demo build was made for commit ${shortCommit(builtCommit)}; this folder is at ${shortCommit(commit)}` };
  }
  return { build: false, reason: `the demo build matches commit ${shortCommit(commit)}` };
}

/** @param {PidRecord} record */
export function formatPidFile(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** @param {unknown} value */
const isPid = (value) => Number.isInteger(value) && /** @type {number} */ (value) > 0;

/**
 * @param {string} text
 * @returns {PidRecord | null}
 */
export function parsePidFile(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { mode, port, serverPid, fakePid, startedAtMs, commit } = /** @type {Record<string, unknown>} */ (data);
  if (mode !== 'live' && mode !== 'practice') return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!isPid(serverPid)) return null;
  if (fakePid !== null && !isPid(fakePid)) return null;
  if (typeof startedAtMs !== 'number' || !Number.isFinite(startedAtMs)) return null;
  if (commit !== null && typeof commit !== 'string') return null;
  return {
    mode,
    port,
    serverPid: /** @type {number} */ (serverPid),
    fakePid: /** @type {number | null} */ (fakePid),
    startedAtMs,
    commit,
  };
}

/**
 * `ps -o etime=` ([[dd-]hh:]mm:ss) in seconds, or null.
 * @param {string} text
 */
export function parseElapsed(text) {
  const match = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (!match) return null;
  const [, days = '0', hours = '0', minutes, seconds] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Whether a live pid is still the process the pid file recorded: it must have started when the
 * record says. After a reboot the same pid can belong to anything; demo:stop must not touch it.
 * @param {{ elapsedSeconds: number | null, recordedStartMs: number, nowMs: number, toleranceMs?: number }} options
 */
export function isSameProcess({ elapsedSeconds, recordedStartMs, nowMs, toleranceMs = 60_000 }) {
  if (elapsedSeconds === null) return false;
  return Math.abs(nowMs - elapsedSeconds * 1000 - recordedStartMs) <= toleranceMs;
}

/** @param {string} version process.versions.node */
export function nodeVersionProblem(version) {
  const major = Number.parseInt(version.replace(/^v/, ''), 10);
  if (Number.isInteger(major) && major >= MIN_NODE_MAJOR) return null;
  return (
    `The demo needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${version}. On a Mac with Homebrew, put Node ${MIN_NODE_MAJOR} first, ` +
    'then run the command again: export PATH="/opt/homebrew/opt/node@24/bin:$PATH"'
  );
}

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Polls until the app answers its health route, the server process dies, or the time is up.
 * @param {{ probe: () => Promise<Probe>, isAlive: () => boolean, timeoutMs: number, intervalMs: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ ok: true, probe: Probe } | { ok: false, reason: 'exited' | 'timeout' }>}
 */
export async function waitForHealth({ probe, isAlive, timeoutMs, intervalMs, now = Date.now, sleep = defaultSleep }) {
  const start = now();
  for (;;) {
    if (!isAlive()) return { ok: false, reason: 'exited' };
    const result = await probe();
    if (result.state === 'demo') return { ok: true, probe: result };
    if (now() - start >= timeoutMs) return { ok: false, reason: 'timeout' };
    await sleep(intervalMs);
  }
}
