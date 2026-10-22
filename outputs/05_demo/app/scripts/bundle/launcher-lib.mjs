// The downloadable demo's launcher (scripts/bundle/launcher.mjs), as small decisions.
//
// It runs from the unzipped HybridDemo folder with the Node that ships in that folder, on macOS
// and on Windows, with no dependencies and no PowerShell. Everything that touches the machine
// (files, processes, the network, the browser, the editor, the clock, the platform) arrives
// through an injected `ctx`, so the Windows branches are unit-tested on a Mac.
//
// What the person's own model settings look like never leaves this file in clear: the key and
// the address are not printed. Text that comes from outside (a failed call, a server log) goes
// through redact() first.

import { posix, win32 } from 'node:path';
import { HOST, demoUrls, fakeLlmArgs, formatPidFile, parsePidFile, probeDemo, serverEnv, waitForHealth } from '../demo/demo-lib.mjs';

export { HOST };

export const DEFAULT_PORT = 3200;
export const MIN_PORT = 1;
export const MAX_PORT = 65535;
export const SETTING_NAMES = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_API_KEY_HEADER', 'LLM_MODEL', 'LLM_MAX_TOKENS'];
/** The three lines a person must fill in before the live demo can start. */
export const REQUIRED_SETTINGS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'];

export const TIMEOUTS = Object.freeze({
  /** The app answers /api/health. A first start on a slow laptop can take a while. */
  serverStartMs: 90_000,
  fakeStartMs: 15_000,
  stopMs: 10_000,
  connectionMs: 30_000,
  /** A server younger than this that does not answer yet is "still starting", not "foreign". */
  startupGraceMs: 120_000,
  /** How far the app's own start time may be from the record's. */
  sameStartToleranceMs: 60_000,
  /** How long to wait for the app to answer when asking "is this still our demo?". */
  identifyProbeMs: 5_000,
  /** A start lock older than this belongs to a launcher that was cut off. */
  lockStaleMs: 240_000,
  /** How long a second Start waits for another window's Start to finish. */
  lockWaitMs: 150_000,
});

export const PRACTICE_NOTICE = 'Practice demo: the answers come from a stand-in, not from a real AI. Do not present them as real answers.';

// ---------------------------------------------------------------------------------------------
// The settings file (my-settings.env)
// ---------------------------------------------------------------------------------------------

const FILLER_WORDS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'dummy',
  'none',
  'null',
  'undefined',
  'todo',
  'tbd',
  'placeholder',
  'replaceme',
  'replace-me',
  'replace_me',
  'n/a',
]);

/**
 * Whether a value is empty or filler instead of something the person typed: only spaces, a filler
 * word, a run of x's, a template such as <your-key> or ${KEY}, or a "your-..." hint. The same
 * rule the app applies (src/server/llm/config.ts), so "filled" here means "usable" there.
 * @param {string | undefined} value
 */
export function isPlaceholder(value) {
  const text = (value ?? '').trim().toLowerCase();
  return (
    text === '' ||
    FILLER_WORDS.has(text) ||
    /^x+$/.test(text) ||
    /[<>]/.test(text) ||
    /\$\{[^}]*\}/.test(text) ||
    /^your[-_ ]/.test(text)
  );
}

/**
 * Which character closes a quote that opens with the given one. The curly pairs are what a word
 * processor (TextEdit, Notepad paste from a mail) turns straight quotes into.
 */
const CLOSING_QUOTE = new Map([
  ['"', '"'],
  ["'", "'"],
  ['\u201C', '\u201D'],
  ['\u201E', '\u201C'],
  ['\u2018', '\u2019'],
]);

/** @param {string} raw the text after the "=" */
function valueOf(raw) {
  const text = raw.trim();
  const closing = CLOSING_QUOTE.get(text[0]);
  if (closing !== undefined) {
    const close = text.indexOf(closing, 1);
    if (close > 0) return text.slice(1, close);
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/**
 * KEY=value lines: comments (#) and blank lines are ignored, an optional "export " is dropped,
 * matching quotes (straight or curly) are stripped, Windows line endings and a byte-order mark are
 * tolerated, and the last assignment of a name wins. Returns every name found; use llmSettingsFrom
 * for the usable ones.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseSettings(text) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) found.set(match[1], valueOf(match[2]));
  }
  return Object.fromEntries(found);
}

/**
 * The model settings that hold a real value. Placeholders and blanks are left out.
 * @param {Record<string, string>} settings
 * @returns {Record<string, string>}
 */
export function llmSettingsFrom(settings) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of SETTING_NAMES) {
    const value = settings[name];
    if (value !== undefined && !isPlaceholder(value)) out[name] = value.trim();
  }
  return out;
}

/**
 * Is the file filled in? `missing` names what still needs a value; `holdsKey` is whether a key is
 * in the file at all (that is what makes the file worth locking down).
 * @param {Record<string, string>} settings
 */
export function settingsReport(settings) {
  const llm = llmSettingsFrom(settings);
  const missing = REQUIRED_SETTINGS.filter((name) => llm[name] === undefined);
  return { filled: missing.length === 0, missing, holdsKey: llm.LLM_API_KEY !== undefined, llm };
}

const KEY_CHARACTERS = /^[\x21-\x7e]+$/;
/** No real key holds a quote mark: one that is there was typed or pasted by mistake. */
const QUOTE_MARK = /["'`]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * A value that is filled in but cannot work, in plain words, or null. The same rules the app
 * applies (src/server/llm/config.ts), found here first because a key with a space or a curly quote
 * would otherwise make the connection check fail as if the network were down.
 * @param {Record<string, string>} llm the filled-in settings (llmSettingsFrom)
 * @returns {string | null}
 */
export function settingsProblem(llm) {
  if (llm.LLM_API_KEY !== undefined && (!KEY_CHARACTERS.test(llm.LLM_API_KEY) || QUOTE_MARK.test(llm.LLM_API_KEY))) {
    return 'LLM_API_KEY has a space, a quote mark or another character a key cannot contain. Paste the key alone: nothing before it (not even the word "Bearer"), nothing after it.';
  }
  if (llm.LLM_MODEL !== undefined && /\s/.test(llm.LLM_MODEL)) {
    return 'LLM_MODEL has a space in it. Write the model name exactly as you were given it, on one line, without spaces.';
  }
  if (llm.LLM_API_KEY_HEADER !== undefined && !HEADER_NAME.test(llm.LLM_API_KEY_HEADER)) {
    return 'LLM_API_KEY_HEADER is not a valid name. Leave that line empty unless you were told which name to use.';
  }
  return null;
}

/** What a new settings file holds when the shipped one is gone. */
export const FALLBACK_SETTINGS_FILE = [
  '# Your own settings for the live demo. Fill in the three lines, save the file, then run',
  '# "Start live demo" again. Do not share this file: it holds your key.',
  '',
  '# The address of the AI service, as you were given it (it starts with https://).',
  'LLM_BASE_URL=',
  '# Your own key.',
  'LLM_API_KEY=',
  '# The name of the model, exactly as you were given it.',
  'LLM_MODEL=',
  '',
  '# Optional. Leave empty unless you were told to set them.',
  'LLM_API_KEY_HEADER=',
  'LLM_MAX_TOKENS=',
  '',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Paths, ports, test hooks
// ---------------------------------------------------------------------------------------------

/**
 * Every path the launcher uses, built for the given platform. `root` is the HybridDemo folder.
 * The test hooks (HYBRID_DATA_DIR, RAAGENTS_ENV_FILE, HYBRID_SERVER_ENTRY) only move things.
 * @param {{ platform: string, root: string, env: Readonly<Record<string, string | undefined>>, fakeLlm?: string }} options
 */
export function pathsFor({ platform, root, env, fakeLlm }) {
  const p = platform === 'win32' ? win32 : posix;
  /** @param {string | undefined} value */
  const given = (value) => (value !== undefined && value.trim() !== '' ? value.trim() : null);
  /** @param {string} value */
  const absolute = (value) => (p.isAbsolute(value) ? value : p.join(root, value));

  const dataOverride = given(env.HYBRID_DATA_DIR);
  const dataDir = dataOverride ? absolute(dataOverride) : p.join(root, 'data');
  const settingsOverride = given(env.RAAGENTS_ENV_FILE);
  const entryOverride = given(env.HYBRID_SERVER_ENTRY);
  const appDir = p.join(root, 'app');
  const serverEntry = entryOverride ? absolute(entryOverride) : p.join(appDir, 'server.js');
  return {
    root,
    appDir,
    agentsDir: p.join(appDir, 'agents'),
    serverEntry,
    // A test entry lives outside app/: run it from its own folder.
    serverCwd: entryOverride ? p.dirname(serverEntry) : appDir,
    fakeLlm: fakeLlm ?? p.join(root, 'launcher', 'fake-llm.mjs'),
    settingsFile: settingsOverride ? absolute(settingsOverride) : p.join(root, 'my-settings.env'),
    dataDir,
    pidFile: p.join(dataDir, 'demo.pid'),
    lockFile: p.join(dataDir, 'demo.lock'),
    logFile: p.join(dataDir, 'demo.log'),
    previousLogFile: p.join(dataDir, 'demo.previous.log'),
    liveDb: p.join(dataDir, 'demo.db'),
    practiceDb: p.join(dataDir, 'demo-practice.db'),
  };
}

/**
 * Is this port free for the demo? First a connection attempt to 127.0.0.1: a program that holds the
 * port, on loopback or on every address, answers there, so the port is taken (no answer within a
 * second counts as taken too). Then a short listen on 127.0.0.1 confirms the demo can have it.
 * Nothing ever listens beyond loopback: listening on every address, even for a moment, makes a
 * firewall ask for permission, and allowing it on Windows needs administrator rights.
 * @param {number} port
 * @param {{ connect: (options: { port: number, host: string }) => import('node:net').Socket, createServer: () => import('node:net').Server }} net
 * @returns {Promise<boolean>}
 */
export async function isPortFree(port, net) {
  const answered = await new Promise((done) => {
    const socket = net.connect({ port, host: HOST });
    /** @param {boolean} value */
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(1000, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', (/** @type {NodeJS.ErrnoException} */ error) => finish(error.code !== 'ECONNREFUSED'));
  });
  if (answered) return false;
  return new Promise((done) => {
    const server = net.createServer();
    server.once('error', () => done(false));
    server.listen(port, HOST, () => server.close(() => done(true)));
  });
}

/**
 * The first port to try: HYBRID_PORT, else 3200.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function startPortFrom(env) {
  const raw = env.HYBRID_PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`HYBRID_PORT must be a port number from ${MIN_PORT} to ${MAX_PORT}; got "${raw}"`);
  }
  return port;
}

/**
 * The first port from `start` upward that nothing is using. `isFree` is injected; the real one
 * (launcher.mjs) tries to listen on the port and also on the loopback address, because on Windows
 * a program holding the wildcard address does not always stop a second one binding loopback.
 * @param {{ start: number, isFree: (port: number) => Promise<boolean>, skip?: number[] }} options
 */
export async function findFreePort({ start, isFree, skip = [] }) {
  for (let port = start; port <= MAX_PORT; port += 1) {
    if (skip.includes(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(`no free port from ${start} upward`);
}

// ---------------------------------------------------------------------------------------------
// The server's environment
// ---------------------------------------------------------------------------------------------

/** Names the launcher decides itself: whatever the person's environment holds for them is dropped. */
const OWNED_NAMES = new Set([
  'HOSTNAME',
  'HOST',
  'PORT',
  'NODE_ENV',
  'AGENT_SPECS_DIR',
  'CHAT_DB_PATH',
  'NEXT_TELEMETRY_DISABLED',
  'NEXT_DIST_DIR',
  'DEMO_MODE',
  'ALLOWED_HOSTS',
  'NODE_USE_SYSTEM_CA',
]);

/**
 * The environment the app's server starts with. It always listens on loopback only (HOSTNAME and
 * HOST), whatever the person's environment says. Every LLM_* name from the person's environment is
 * dropped: live mode takes them from the settings file only, practice mode points them at the
 * stand-in model. On Windows names are not case sensitive, so "Hostname" or "llm_api_key" in the
 * environment are dropped too, instead of racing the value set here. Live mode also asks Node to
 * trust the operating system's certificates (NODE_USE_SYSTEM_CA), as a browser does: on a company
 * network that re-signs encrypted traffic the bundled list alone would reject the AI service.
 * @param {{ platform: string, baseEnv: Readonly<Record<string, string | undefined>>, paths: ReturnType<typeof pathsFor>, port: number, mode: 'live' | 'practice', llm?: Record<string, string>, fakeBaseUrl?: string }} options
 * @returns {Record<string, string>}
 */
export function buildServerEnv({ platform, baseEnv, paths, port, mode, llm = {}, fakeBaseUrl }) {
  /** @type {Record<string, string | undefined>} */
  const cleaned = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (platform === 'win32') {
      const upper = name.toUpperCase();
      if (OWNED_NAMES.has(upper) || upper.startsWith('LLM_')) continue;
    }
    cleaned[name] = value;
  }
  const env = serverEnv({ mode, baseEnv: cleaned, appDir: paths.appDir, fakeBaseUrl });
  delete env.NEXT_DIST_DIR;
  env.HOSTNAME = HOST;
  env.HOST = HOST;
  env.PORT = String(port);
  env.NODE_ENV = 'production';
  env.AGENT_SPECS_DIR = paths.agentsDir;
  env.CHAT_DB_PATH = mode === 'practice' ? paths.practiceDb : paths.liveDb;
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.DEMO_MODE = mode;
  if (mode === 'live') {
    env.NODE_USE_SYSTEM_CA = '1';
    Object.assign(env, llm);
  }
  return env;
}

// ---------------------------------------------------------------------------------------------
// Starting and stopping processes
// ---------------------------------------------------------------------------------------------

/**
 * Starts a program in the background: its own process group, no window on Windows, its output in
 * the log, and the launcher free to exit. `state` tells whether it is still there.
 * @param {{ spawn: Function, fs: any, execPath: string, args: string[], cwd: string, env: Record<string, string>, logFile: string }} options
 * @returns {{ pid: number | undefined, state: { exited: boolean, error: unknown } }}
 */
export function startBackground({ spawn, fs, execPath, args, cwd, env, logFile }) {
  /** @type {{ exited: boolean, error: unknown }} */
  const state = { exited: false, error: null };
  const out = fs.openSync(logFile, 'a');
  try {
    const child = spawn(execPath, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    child.on('error', (/** @type {unknown} */ error) => {
      state.exited = true;
      state.error = error;
    });
    child.on('exit', () => {
      state.exited = true;
    });
    if (child.pid === undefined) state.exited = true;
    child.unref();
    return { pid: child.pid, state };
  } catch (error) {
    state.exited = true;
    state.error = error;
    return { pid: undefined, state };
  } finally {
    fs.closeSync(out);
  }
}

/**
 * Ends a process and what it started. Mac and Linux: ask politely (SIGTERM to its process group),
 * wait, then force (SIGKILL). Windows has no polite way for a background program: taskkill /T /F
 * ends it and its children at once. Returns whether the pid is gone.
 * @param {{ platform: string, pid: number, ctx: any }} options
 */
export async function terminate({ platform, pid, ctx }) {
  const { isAlive, kill, run, sleep } = ctx;
  const waitGone = async (/** @type {number} */ limitMs) => {
    for (let waited = 0; waited < limitMs; waited += 200) {
      if (!isAlive(pid)) return true;
      await sleep(200);
    }
    return !isAlive(pid);
  };
  if (platform === 'win32') {
    await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return waitGone(ctx.timeouts.stopMs);
  }
  kill(pid, 'SIGTERM');
  if (await waitGone(ctx.timeouts.stopMs)) return true;
  kill(pid, 'SIGKILL');
  return waitGone(1_500);
}

/** The program that opens a page in the person's browser. @param {{ platform: string, url: string }} options */
export function browserCommand({ platform, url }) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** The program that opens the settings file for editing, or null where there is no plain choice. @param {{ platform: string, file: string }} options */
export function editorCommand({ platform, file }) {
  if (platform === 'win32') return { command: 'notepad', args: [file] };
  if (platform === 'darwin') return { command: 'open', args: ['-e', file] };
  return null;
}

// ---------------------------------------------------------------------------------------------
// The pid file, and "is this process really ours?"
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ mode: 'live' | 'practice', port: number, serverPid: number, fakePid: number | null, fakePort: number | null, startedAtMs: number, commit: null }} Record
 */

/** @param {Record} record */
export function formatRecord(record) {
  return formatPidFile({ ...record, commit: null });
}

/**
 * The pid file's contents, or null when it is not a record this launcher wrote.
 * @param {string} text
 * @returns {Record | null}
 */
export function parseRecord(text) {
  const base = parsePidFile(text);
  if (base === null) return null;
  /** @type {unknown} */
  let fakePort = null;
  try {
    fakePort = /** @type {{ fakePort?: unknown }} */ (JSON.parse(text)).fakePort ?? null;
  } catch {
    return null;
  }
  const portOk = typeof fakePort === 'number' && Number.isInteger(fakePort) && fakePort >= MIN_PORT && fakePort <= MAX_PORT;
  if (fakePort !== null && !portOk) return null;
  return {
    mode: base.mode,
    port: base.port,
    serverPid: base.serverPid,
    fakePid: base.fakePid,
    fakePort: /** @type {number | null} */ (fakePort),
    startedAtMs: base.startedAtMs,
    commit: null,
  };
}

/**
 * Is the recorded server process really the one this launcher started? There is no `ps` on Windows,
 * so this uses what both systems offer: the pid must be alive, must not predate the last boot, and
 * the app answering on the recorded port must report a start time within a minute of the record and
 * the recorded mode. A pid reused by another program never passes, because that program does not
 * answer /api/health as this app.
 * A busy laptop can answer slowly, so a first probe that gets no proper answer is repeated once,
 * with a longer wait, before the process is called unconfirmed.
 * Limit: a server that hangs without answering is "unconfirmed" once it is older than the start-up
 * grace period; it is left alone (the launcher never kills a process it cannot identify).
 * @param {{ record: Record, ctx: any }} options
 * @returns {Promise<'gone' | 'ours' | 'starting' | 'unconfirmed'>}
 */
export async function identifyServer({ record, ctx }) {
  if (!ctx.isAlive(record.serverPid)) return 'gone';
  const nowMs = ctx.now();
  if (ctx.bootTimeMs !== undefined && record.startedAtMs < ctx.bootTimeMs - 60_000) return 'gone';
  let probe = await probeDemo({ fetch: ctx.fetch, port: record.port, timeoutMs: TIMEOUTS.identifyProbeMs });
  if (probe.state === 'other') probe = await probeDemo({ fetch: ctx.fetch, port: record.port, timeoutMs: TIMEOUTS.identifyProbeMs });
  if (probe.state === 'demo') {
    const sameStart = Math.abs(Date.parse(probe.startedAt) - record.startedAtMs) <= TIMEOUTS.sameStartToleranceMs;
    return sameStart && probe.mode === record.mode ? 'ours' : 'unconfirmed';
  }
  if (probe.state === 'free' && nowMs - record.startedAtMs < TIMEOUTS.startupGraceMs) return 'starting';
  return 'unconfirmed';
}

/**
 * Is the recorded stand-in model really the one this launcher started? Alive, and answering its
 * own health line on the recorded port.
 * @param {{ record: Record, ctx: any }} options
 * @returns {Promise<'gone' | 'ours' | 'unconfirmed'>}
 */
export async function identifyFake({ record, ctx }) {
  if (record.fakePid === null) return 'gone';
  if (!ctx.isAlive(record.fakePid)) return 'gone';
  if (record.fakePort === null) return 'unconfirmed';
  try {
    const response = await ctx.fetch(`http://${HOST}:${record.fakePort}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).startsWith('fake LLM') ? 'ours' : 'unconfirmed';
  } catch {
    return 'unconfirmed';
  }
}

// ---------------------------------------------------------------------------------------------
// One Start at a time
// ---------------------------------------------------------------------------------------------

/**
 * The note a launcher leaves while it starts the demo, or null when there is none to read. The
 * file can be seen empty for a moment while its writer is still writing, so it is read again.
 * @param {{ fs: any, file: string, sleep: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ pid: number, at: number } | null>}
 */
async function readLockHolder({ fs, file, sleep }) {
  for (let read = 0; read < 3; read += 1) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(data.pid) && data.pid > 0 && Number.isFinite(data.at)) return { pid: data.pid, at: data.at };
    } catch {
      // gone, empty or half written
    }
    if (!fs.existsSync(file)) return null;
    await sleep(50);
  }
  return null;
}

/**
 * Takes the start lock (data/demo.lock) so that two windows started a moment apart cannot both
 * start a server: the second one waits and then finds the first one's demo running. 'held' means
 * another launcher that is still there began less than lockStaleMs ago; a lock whose launcher is
 * gone, or that is older than that, is taken over.
 * @param {{ ctx: any }} options
 * @returns {Promise<'acquired' | 'held'>}
 */
export async function tryAcquireStartLock({ ctx }) {
  const { fs, paths } = ctx;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(paths.lockFile, JSON.stringify({ pid: ctx.pid, at: ctx.now() }), { flag: 'wx' });
      return 'acquired';
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error).code !== 'EEXIST') throw error;
    }
    const holder = await readLockHolder({ fs, file: paths.lockFile, sleep: ctx.sleep });
    if (holder !== null && ctx.isAlive(holder.pid) && ctx.now() - holder.at < ctx.timeouts.lockStaleMs) return 'held';
    fs.rmSync(paths.lockFile, { force: true });
  }
  return 'held';
}

/** @param {any} ctx */
export function releaseStartLock(ctx) {
  ctx.fs.rmSync(ctx.paths.lockFile, { force: true });
}

// ---------------------------------------------------------------------------------------------
// The connection check for the live demo
// ---------------------------------------------------------------------------------------------

/**
 * Makes this process trust the operating system's certificates as well as Node's own list, the way
 * a browser does. Without it, a company network that re-signs encrypted traffic makes every call
 * to the AI service fail. Needs Node 24.5 or newer; on anything older (the functions are missing,
 * so the first call throws), or if the system refuses, nothing changes.
 * @param {{ tls: any }} options
 * @returns {{ added: number }}
 */
export function trustSystemCertificates({ tls }) {
  try {
    /** @type {string[]} */
    const current = tls.getCACertificates('default');
    const known = new Set(current);
    /** @type {string[]} */
    const extra = tls.getCACertificates('system').filter((/** @type {string} */ certificate) => !known.has(certificate));
    if (extra.length === 0) return { added: 0 };
    tls.setDefaultCACertificates([...current, ...extra]);
    return { added: extra.length };
  } catch {
    return { added: 0 };
  }
}

/** @typedef {'ok' | 'bad-address' | 'wrong-key' | 'unknown-model' | 'wrong-address' | 'unreachable' | 'certificate' | 'timeout' | 'busy' | 'server-error' | 'other'} ConnectionKind */

/**
 * Replaces every secret with "[hidden]" so an error text or a log line cannot show the key or the
 * address. Very short values are skipped: they would hide ordinary words.
 * @param {string} text @param {Array<string | undefined>} secrets
 */
export function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= 4) out = out.split(secret).join('[hidden]');
  }
  return out;
}

/** What to hide when talking about a settings file: the key, the address and its host. @param {Record<string, string>} llm */
export function secretsOf(llm) {
  /** @type {string[]} */
  const secrets = [];
  if (llm.LLM_API_KEY) secrets.push(llm.LLM_API_KEY);
  if (llm.LLM_BASE_URL) {
    secrets.push(llm.LLM_BASE_URL);
    try {
      const url = new URL(llm.LLM_BASE_URL);
      secrets.push(url.host, url.hostname);
    } catch {
      // not a URL: the whole value is already hidden
    }
  }
  return secrets;
}

const LOOPBACK = /^(localhost|\[::1\]|127(\.\d{1,3}){3})$/;

/** @param {string} base @returns {{ ok: true, endpoint: string } | { ok: false }} */
function chatEndpoint(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false };
  if (url.username !== '' || url.password !== '') return { ok: false };
  // The key would travel in clear text; the app refuses this too.
  if (url.protocol === 'http:' && !LOOPBACK.test(url.hostname) && !url.hostname.endsWith('.localhost')) return { ok: false };
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return { ok: true, endpoint: url.toString() };
}

/** @param {unknown} error */
function isTimeout(error) {
  const name = typeof error === 'object' && error !== null ? /** @type {{ name?: unknown }} */ (error).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Every Node error code in an error and what caused it. fetch reports all network problems as
 * "fetch failed"; the code is on error.cause (checked on Node 24).
 * @param {unknown} error @param {number} [depth] @returns {string[]}
 */
function codesOf(error, depth = 0) {
  if (typeof error !== 'object' || error === null || depth > 5) return [];
  const { code, cause, errors } = /** @type {{ code?: unknown, cause?: unknown, errors?: unknown }} */ (error);
  return [
    ...(typeof code === 'string' ? [code] : []),
    ...codesOf(cause, depth + 1),
    ...(Array.isArray(errors) ? errors.flatMap((inner) => codesOf(inner, depth + 1)) : []),
  ];
}

/** The security certificate was refused: not trusted, expired, not issued for this name, and so on. */
const CERTIFICATE_CODE = /^(?:CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(?:GET_ISSUER_CERT(?:_LOCALLY)?|VERIFY_LEAF_SIGNATURE|GET_CRL)|ERR_TLS_CERT_ALTNAME_INVALID|HOSTNAME_MISMATCH)$/;

/**
 * What a call that never got an answer tells about the problem.
 * @param {unknown} error
 * @returns {'timeout' | 'certificate' | 'wrong-address' | 'unreachable'}
 */
export function classifyError(error) {
  if (isTimeout(error)) return 'timeout';
  const codes = codesOf(error);
  if (codes.some((code) => CERTIFICATE_CODE.test(code))) return 'certificate';
  // https:// written for a port that speaks plain http
  if (codes.includes('ERR_SSL_WRONG_VERSION_NUMBER')) return 'wrong-address';
  return 'unreachable';
}

/**
 * @param {number} status @param {string} text
 * @returns {ConnectionKind}
 */
export function classifyStatus(status, text) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'wrong-key';
  if (status === 408) return 'timeout';
  if (status === 429) return 'busy';
  if (status >= 500) return 'server-error';
  if (status >= 300 && status < 400) return 'wrong-address';
  if (/max_tokens|max_completion_tokens/i.test(text)) return 'other';
  if ((status === 400 || status === 404 || status === 412 || status === 422) && /model/i.test(text)) return 'unknown-model';
  if (status === 404) return 'wrong-address';
  return 'other';
}

/**
 * One tiny real chat call with the person's own settings, classified. Asks with max_tokens and,
 * if the service says it wants max_completion_tokens instead, asks once more that way. Never
 * returns the service's text, the key or the address.
 * @param {{ fetch: Function, llm: Record<string, string>, timeoutMs?: number }} options
 * @returns {Promise<{ ok: true } | { ok: false, kind: Exclude<ConnectionKind, 'ok'>, status?: number }>}
 */
export async function checkConnection({ fetch, llm, timeoutMs = TIMEOUTS.connectionMs }) {
  const target = chatEndpoint(llm.LLM_BASE_URL ?? '');
  if (!target.ok) return { ok: false, kind: 'bad-address' };
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const header = llm.LLM_API_KEY_HEADER;
  if (header && header.toLowerCase() !== 'authorization') headers[header] = llm.LLM_API_KEY;
  else headers.authorization = `Bearer ${llm.LLM_API_KEY}`;

  /** @param {'max_tokens' | 'max_completion_tokens'} field */
  const ask = async (field) => {
    try {
      const response = await fetch(target.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: llm.LLM_MODEL, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], [field]: 16 }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = (await response.text().catch(() => '')).slice(0, 2000);
      return { status: /** @type {number} */ (response.status), text };
    } catch (error) {
      return { error };
    }
  };

  let answer = await ask('max_tokens');
  if ('status' in answer && answer.status === 400 && /max_completion_tokens|max_tokens/i.test(answer.text)) {
    answer = await ask('max_completion_tokens');
  }
  if ('error' in answer) return { ok: false, kind: classifyError(answer.error) };
  const kind = classifyStatus(answer.status, answer.text);
  return kind === 'ok' ? { ok: true } : { ok: false, kind, status: answer.status };
}

// ---------------------------------------------------------------------------------------------
// What the person reads
// ---------------------------------------------------------------------------------------------

/** @param {Exclude<ConnectionKind, 'ok'>} kind @param {number | undefined} status */
export function connectionProblem(kind, status) {
  const code = status === undefined ? '' : ` (code ${status})`;
  switch (kind) {
    case 'bad-address':
      return 'The address in LLM_BASE_URL is not a valid web address. It should start with https:// and be exactly as you were given it.';
    case 'wrong-key':
      return 'The AI service did not accept your key. Check that LLM_API_KEY holds the whole key, with no spaces before or after it. If it does, the key may have expired or may not allow this service: ask whoever gave it to you.';
    case 'unknown-model':
      return 'The AI service does not know the model name in LLM_MODEL, or your key is not allowed to use it. Check the name letter by letter against what you were given.';
    case 'wrong-address':
      return `The AI service did not find what LLM_BASE_URL points to${code}. Check the address: it often ends with /v1.`;
    case 'unreachable':
      return 'The AI service could not be reached. If it needs a company VPN, connect to it first. Otherwise check the address in LLM_BASE_URL and your internet connection.';
    case 'certificate':
      return 'Your computer did not trust the security certificate of the AI service. On a company network this often means the network checks encrypted traffic. Connect to your company VPN or network and try again. If it keeps happening, ask your IT team to install the company certificate on this computer. Also check that the date and time on this computer are right.';
    case 'timeout':
      return 'The AI service did not answer in time. Check your VPN and internet connection, then try again.';
    case 'busy':
      return 'The AI service says it is busy right now. Wait a minute, then run Start live demo again.';
    case 'server-error':
      return `The AI service reported a problem on its side${code}. Try again in a few minutes.`;
    default:
      return `The AI service answered in a way I did not expect${code}. Check LLM_BASE_URL, LLM_API_KEY and LLM_MODEL, then try again.`;
  }
}

/** Shown when the settings file still needs the person's own values. @param {{ missing: string[], opened: boolean, file: string }} options */
export function needSettingsText({ missing, opened, file }) {
  return [
    'The live demo needs your own settings before it can start.',
    '',
    opened ? 'I opened the file "my-settings.env" for you.' : `Open this file in a text editor: ${file}`,
    'Fill in these lines, then save the file and run "Start live demo" again:',
    '  LLM_BASE_URL   the address of the AI service',
    '  LLM_API_KEY    your own key (keep it private)',
    '  LLM_MODEL      the name of the model',
    '',
    `Still empty: ${missing.join(', ')}.`,
    'Nothing was started. No key at hand? "Start practice demo" works without one.',
  ];
}

// ---------------------------------------------------------------------------------------------
// The two commands
// ---------------------------------------------------------------------------------------------

/** @param {any} ctx @param {number} port */
async function openPages(ctx, port) {
  const urls = demoUrls(port);
  ctx.say(`  Workspace:  ${urls.workspace}`);
  ctx.say(`  Team chat:  ${urls.team}`);
  if (ctx.env.HYBRID_NO_BROWSER === '1') return;
  const { command, args } = browserCommand({ platform: ctx.platform, url: urls.workspace });
  const opened = await ctx.launch(command, args);
  ctx.say(opened ? 'Your browser should open the demo now.' : 'I could not open your browser. Copy the Workspace address above into it.');
}

/** @param {any} ctx @param {number} lines */
function logTail(ctx, lines = 20) {
  try {
    return ctx.fs.readFileSync(ctx.paths.logFile, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(nothing was written)';
  }
}

/** @param {any} ctx @returns {Record | null | 'unreadable'} */
function readRecord(ctx) {
  if (!ctx.fs.existsSync(ctx.paths.pidFile)) return null;
  try {
    return parseRecord(ctx.fs.readFileSync(ctx.paths.pidFile, 'utf8')) ?? 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * Starts a new log for this run; the last one stays as demo.previous.log. Windows will not move a
 * log that a program still has open (an old demo that was left running): then the new run simply
 * writes on at the end of the same file.
 * @param {any} ctx
 */
function startNewLog(ctx) {
  const { fs, paths } = ctx;
  const header = `[demo] ${new Date(ctx.now()).toISOString()}\n`;
  try {
    if (fs.existsSync(paths.logFile)) fs.renameSync(paths.logFile, paths.previousLogFile);
    fs.writeFileSync(paths.logFile, header);
  } catch {
    fs.appendFileSync(paths.logFile, header);
  }
}

/** Tightens the settings file to the owner on Mac and Linux, once it holds a key. @param {any} ctx */
function lockDownSettings(ctx) {
  if (ctx.platform === 'win32') return false;
  try {
    const mode = ctx.fs.statSync(ctx.paths.settingsFile).mode & 0o777;
    if ((mode & 0o077) === 0) return false;
    ctx.fs.chmodSync(ctx.paths.settingsFile, 0o600);
    return true;
  } catch {
    return false;
  }
}

/** Ends the stand-in model and the server this run recorded. @param {any} ctx @param {Record} record */
async function endRecorded(ctx, record) {
  let stopped = false;
  let failed = null;
  const fake = await identifyFake({ record, ctx });
  if (fake === 'ours' && record.fakePid !== null) {
    if (await terminate({ platform: ctx.platform, pid: record.fakePid, ctx })) stopped = true;
    else failed = record.fakePid;
  }
  return { stopped, failed };
}

/**
 * Waits its turn to start the demo: two windows started a moment apart would otherwise both start
 * a server. Returns false (after saying why) when the other window does not finish in time.
 * @param {any} ctx
 */
async function waitForStartLock(ctx) {
  let told = false;
  for (let waited = 0; waited <= ctx.timeouts.lockWaitMs; waited += 500) {
    if ((await tryAcquireStartLock({ ctx })) === 'acquired') {
      ctx.holdsStartLock = true;
      return true;
    }
    if (!told) {
      ctx.say('The demo is being started from another window. Waiting for it...');
      told = true;
    }
    await ctx.sleep(500);
  }
  ctx.say('The demo is still being started from another window. Wait a minute, then run this again.');
  return false;
}

/**
 * Start the demo. Returns the exit code; nothing here exits the process.
 * @param {any} ctx
 * @param {'live' | 'practice'} mode
 */
export async function startDemo(ctx, mode) {
  ctx.fs.mkdirSync(ctx.paths.dataDir, { recursive: true });
  if (!(await waitForStartLock(ctx))) return 1;
  try {
    return await startLocked(ctx, mode);
  } finally {
    ctx.holdsStartLock = false;
    releaseStartLock(ctx);
  }
}

/** @param {any} ctx @param {'live' | 'practice'} mode */
async function startLocked(ctx, mode) {
  const { say, fs, paths, platform } = ctx;

  // 1. Is a demo from this folder already there?
  const found = readRecord(ctx);
  let running = null;
  if (found === 'unreadable') {
    fs.rmSync(paths.pidFile, { force: true });
  } else if (found !== null) {
    const identity = await identifyServer({ record: found, ctx });
    if (identity === 'gone' || identity === 'unconfirmed') {
      // Gone: nothing to keep. Unconfirmed: a process with that number exists but does not answer
      // as this app, so it is not ours to touch. Either way a stand-in model this folder started
      // (and can prove it) is ended, and the record is forgotten.
      await endRecorded(ctx, found);
      fs.rmSync(paths.pidFile, { force: true });
    } else {
      running = { record: found, identity };
    }
  }

  if (running !== null) {
    const { record, identity } = running;
    if (record.mode !== mode) {
      say(`The ${record.mode} demo is running. Run "Stop demo" first, then start the ${mode} demo.`);
      return 1;
    }
    if (identity === 'starting') {
      say('The demo is still starting. Waiting for it...');
      const ready = await waitForHealth({
        probe: () => probeDemo({ fetch: ctx.fetch, port: record.port }),
        isAlive: () => ctx.isAlive(record.serverPid),
        timeoutMs: ctx.timeouts.serverStartMs,
        intervalMs: 500,
        now: ctx.now,
        sleep: ctx.sleep,
      });
      if (!ready.ok) {
        say('The demo did not finish starting. Run "Stop demo", then try again.');
        return 1;
      }
    }
    say(`The ${mode} demo is already running.`);
    if (mode === 'practice') say(PRACTICE_NOTICE);
    await openPages(ctx, record.port);
    return 0;
  }

  // The first port to try is checked now, so a wrong HYBRID_PORT cannot be found after the
  // stand-in model has already started.
  const firstPort = startPortFrom(ctx.env);

  // 2. Live: the person's own settings, and a real test call, before anything starts.
  /** @type {Record<string, string>} */
  let llm = {};
  if (mode === 'live') {
    if (!fs.existsSync(paths.settingsFile)) fs.writeFileSync(paths.settingsFile, FALLBACK_SETTINGS_FILE);
    const report = settingsReport(parseSettings(fs.readFileSync(paths.settingsFile, 'utf8')));
    ctx.knownLlm = report.llm;
    if (report.holdsKey && lockDownSettings(ctx)) say('Your settings file is now private to your user account.');
    if (!report.filled) {
      const command = editorCommand({ platform, file: paths.settingsFile });
      let opened = false;
      if (ctx.env.HYBRID_NO_EDITOR !== '1' && command !== null) opened = await ctx.launch(command.command, command.args);
      for (const line of needSettingsText({ missing: report.missing, opened, file: paths.settingsFile })) say(line);
      return 0;
    }
    llm = report.llm;
    const problem = settingsProblem(llm);
    if (problem !== null) {
      say(problem);
      say('Fix that line in "my-settings.env", save the file and run "Start live demo" again.');
      say('Nothing was started.');
      return 1;
    }
    ctx.trustSystemCertificates?.();
    say('Checking the connection to the AI service...');
    const check = await checkConnection({ fetch: ctx.fetch, llm, timeoutMs: ctx.timeouts.connectionMs });
    if (!check.ok) {
      say(connectionProblem(check.kind, check.status));
      say('Nothing was started.');
      return 1;
    }
    say('The connection works.');
  }

  if (!fs.existsSync(paths.serverEntry)) {
    say('The demo\'s program files are missing from this folder. Download the ZIP again and unzip it completely.');
    return 1;
  }

  /** @type {number[]} */
  const started = (ctx.started = []);
  const startedAtMs = ctx.now();
  startNewLog(ctx);

  // 3. Practice: the stand-in model first.
  let fakePid = null;
  let fakePort = null;
  let fakeBaseUrl;
  if (mode === 'practice') {
    fakePort = await ctx.ephemeralPort();
    const fakeEnv = Object.fromEntries(Object.entries(ctx.baseEnv).filter(([name, value]) => !name.toUpperCase().startsWith('LLM_') && value !== undefined));
    const fake = startBackground({
      spawn: ctx.spawn,
      fs,
      execPath: ctx.execPath,
      args: [paths.fakeLlm, ...fakeLlmArgs({ port: fakePort, env: ctx.baseEnv })],
      cwd: paths.dataDir,
      env: /** @type {Record<string, string>} */ (fakeEnv),
      logFile: paths.logFile,
    });
    if (fake.pid === undefined) {
      say('The stand-in model for the practice demo could not be started.');
      return 1;
    }
    fakePid = fake.pid;
    started.push(fake.pid);
    const up = await waitForHealth({
      probe: async () => {
        try {
          const response = await ctx.fetch(`http://${HOST}:${fakePort}/health`, { signal: AbortSignal.timeout(1000) });
          return response.ok ? { state: 'demo', mode: 'practice', startedAt: '' } : { state: 'free' };
        } catch {
          return { state: 'free' };
        }
      },
      isAlive: () => !fake.state.exited,
      timeoutMs: ctx.timeouts.fakeStartMs,
      intervalMs: 200,
      now: ctx.now,
      sleep: ctx.sleep,
    });
    if (!up.ok) return failStart(ctx, 'The stand-in model for the practice demo did not start.');
    fakeBaseUrl = `http://${HOST}:${fakePort}/v1`;
  }

  // 4. The server, on the first free port.
  const port = await findFreePort({ start: firstPort, isFree: ctx.isPortFree, skip: fakePort === null ? [] : [fakePort] });
  const env = buildServerEnv({ platform, baseEnv: ctx.baseEnv, paths, port, mode, llm, fakeBaseUrl });
  const server = startBackground({ spawn: ctx.spawn, fs, execPath: ctx.execPath, args: [paths.serverEntry], cwd: paths.serverCwd, env, logFile: paths.logFile });
  if (server.pid === undefined) return failStart(ctx, 'The demo could not be started.', llm);
  started.push(server.pid);
  fs.writeFileSync(paths.pidFile, formatRecord({ mode, port, serverPid: server.pid, fakePid, fakePort, startedAtMs, commit: null }));

  say(`Starting the ${mode} demo. The first start can take a minute...`);
  const result = await waitForHealth({
    probe: () => probeDemo({ fetch: ctx.fetch, port }),
    isAlive: () => !server.state.exited,
    timeoutMs: ctx.timeouts.serverStartMs,
    intervalMs: 500,
    now: ctx.now,
    sleep: ctx.sleep,
  });
  if (!result.ok) {
    return failStart(ctx, result.reason === 'exited' ? 'The demo stopped while it was starting.' : 'The demo did not answer in time.', llm);
  }
  const answered = /** @type {{ state: 'demo', mode: 'live' | 'practice', startedAt: string, report?: any }} */ (result.probe);
  if (Math.abs(Date.parse(answered.startedAt) - startedAtMs) > TIMEOUTS.sameStartToleranceMs) {
    return failStart(ctx, 'Another program answers on the demo\'s port, not the demo this run started.', llm);
  }
  if (answered.mode !== mode) {
    return failStart(ctx, `The demo reports ${answered.mode} mode instead of ${mode}.`, llm);
  }
  // It is up. From here on nothing this run does may take it down again.
  ctx.started = [];

  say('');
  if (mode === 'practice') {
    say(PRACTICE_NOTICE);
  } else if (answered.report?.llm?.configured === false) {
    say('Warning: the demo started, but it cannot use the model connection, so the agents cannot answer. Check my-settings.env, then run "Stop demo" and "Start live demo" again.');
  }
  say(`The ${mode} demo is running.`);
  await openPages(ctx, port);
  say('It keeps running in the background after you close this window. To stop it, run "Stop demo".');
  return 0;
}

/**
 * A start that failed: end what this run started, forget the record, say why and show the log.
 * @param {any} ctx @param {string} message @param {Record<string, string>} [llm]
 */
async function failStart(ctx, message, llm = {}) {
  for (const pid of ctx.started ?? []) await terminate({ platform: ctx.platform, pid, ctx });
  ctx.fs.rmSync(ctx.paths.pidFile, { force: true });
  ctx.say(message);
  ctx.say('Nothing is running now. The last lines of the log (data/demo.log):');
  ctx.say(redact(logTail(ctx), secretsOf(llm)));
  return 1;
}

/**
 * For Ctrl+C or a closed window during a start: end what this run started, forget the record and
 * give the start lock back. A run that started nothing leaves a running demo's record alone.
 * @param {any} ctx
 */
export async function interruptCleanup(ctx) {
  const started = /** @type {number[]} */ (ctx.started ?? []);
  for (const pid of started) await terminate({ platform: ctx.platform, pid, ctx });
  if (started.length > 0) ctx.fs.rmSync(ctx.paths.pidFile, { force: true });
  if (ctx.holdsStartLock) {
    ctx.holdsStartLock = false;
    releaseStartLock(ctx);
  }
}

/**
 * Stop what this folder started. Returns the exit code.
 * @param {any} ctx
 */
export async function stopDemo(ctx) {
  const { say, fs, paths, platform } = ctx;
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const record = readRecord(ctx);
  if (record === null) {
    say('No demo started from this folder is running. Nothing to stop.');
    return 0;
  }
  if (record === 'unreadable') {
    fs.rmSync(paths.pidFile, { force: true });
    say('The note about the running demo could not be read, so it was cleared. If the demo still opens in your browser, restart your computer to stop it.');
    return 0;
  }

  const identity = await identifyServer({ record, ctx });
  /** @type {number[]} */
  const failed = [];
  let stoppedServer = false;
  if (identity === 'ours' || identity === 'starting') {
    if (await terminate({ platform, pid: record.serverPid, ctx })) stoppedServer = true;
    else failed.push(record.serverPid);
  } else if (identity === 'unconfirmed') {
    say(`Program number ${record.serverPid} is not answering as the demo, so I left it alone. If the demo seems stuck, restart your computer.`);
  }
  const ended = await endRecorded(ctx, record);
  if (ended.failed !== null) failed.push(ended.failed);
  if (failed.length > 0) {
    say(`I could not stop everything (program ${failed.join(', ')}). The note about it stays in data/demo.pid so you can try again.`);
    return 1;
  }
  fs.rmSync(paths.pidFile, { force: true });

  if (stoppedServer) {
    const after = await probeDemo({ fetch: ctx.fetch, port: record.port });
    if (after.state !== 'free') {
      say(`Something still answers on port ${record.port}, but it was not started from this folder.`);
      return 1;
    }
    say(`Stopped the ${record.mode} demo.`);
    if (platform === 'win32') say('Windows ends it at once, so an answer that was still being written is cut off.');
  } else if (identity === 'gone') {
    say(`The ${record.mode} demo was no longer running. I cleared its note.`);
  } else {
    say(ended.stopped ? 'Stopped the stand-in model it was using.' : 'Nothing else was stopped.');
  }
  return 0;
}

/**
 * What an unexpected error means for the person. A folder the demo cannot write to is the one
 * case worth a sentence of its own: it happens when the ZIP was opened but not unzipped.
 * @param {unknown} error @param {Array<string | undefined>} secrets
 */
export function describeFailure(error, secrets) {
  const code = typeof error === 'object' && error !== null ? /** @type {{ code?: unknown }} */ (error).code : undefined;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return 'The demo cannot save its files in this folder. Unzip the ZIP completely and move the "HybridDemo" folder to your Desktop or Documents folder, then try again.';
  }
  if (code === 'ENOSPC') return 'The disk is full, so the demo cannot save its files. Free some space, then try again.';
  const text = error instanceof Error ? error.message : String(error);
  return `Something went wrong: ${redact(text, secrets)}`;
}

/**
 * Runs one launcher command. Anything unexpected becomes a short message with the key and the
 * address hidden, and whatever this run had already started is ended again.
 * @param {any} ctx @param {string | undefined} command
 */
export async function runCommand(ctx, command) {
  try {
    if (command === 'practice' || command === 'live') return await startDemo(ctx, command);
    if (command === 'stop') return await stopDemo(ctx);
    ctx.say('Say what to do: practice, live or stop.');
    return 2;
  } catch (error) {
    await interruptCleanup(ctx).catch(() => undefined);
    ctx.say(describeFailure(error, secretsOf(ctx.knownLlm ?? {})));
    return 1;
  }
}
