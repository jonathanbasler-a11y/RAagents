#!/usr/bin/env node
// The demo at any time, with one command (README.md, "Demo at any time"):
//
//   npm run demo             live: the real model with your settings file (needs the VPN)
//   npm run demo:practice    practice: the stand-in model, labelled on every page and reply
//   npm run demo:stop        stops the demo started from this folder
//   Flags after "--": --no-open (do not open the browser), --rebuild (build again first).
//   Double-click instead: scripts/demo/start-demo.command, start-practice.command, stop-demo.command.
//
// It serves a production build (made once per commit, in .next-demo unless NEXT_DIST_DIR names
// another folder) with `next start` on 127.0.0.1, port 3200 unless DEMO_PORT says otherwise, in the
// background. Each mode has its own chat database (.data/demo.db, .data/demo-practice.db). The server pid goes to
// .data/demo.pid and its output to .data/demo.log. Live mode finds the model settings file and
// hands its path to Node (--env-file): this script never reads, prints or copies the file.
// The decisions live in demo-lib.mjs, where they are unit-tested.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST,
  buildEnv,
  buildPlan,
  decideStart,
  demoUrls,
  describeError,
  displayPath,
  envFilePermissionProblem,
  fakeLlmArgs,
  findEnvFile,
  formatPidFile,
  isSameProcess,
  nodeVersionProblem,
  parseArgs,
  parseElapsed,
  parsePidFile,
  probeDemo,
  scriptFor,
  serverEnv,
  waitForHealth,
} from './demo-lib.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(APP_DIR, '.data');
const PID_FILE = join(DATA_DIR, 'demo.pid');
const LOG_FILE = join(DATA_DIR, 'demo.log');
const PREVIOUS_LOG_FILE = join(DATA_DIR, 'demo.previous.log');
const NEXT_BIN = join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const FAKE_LLM = join(APP_DIR, 'scripts', 'fake-llm.mjs');
/** Written next to Next's BUILD_ID after a successful build: the commit it was made from. */
const BUILD_MARKER = 'demo-build.json';

const SERVER_START_TIMEOUT_MS = 90_000;
const FAKE_START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 10_000;

const PRACTICE_WARNING = 'Practice mode: replies come from a stand-in model, not AI. Do not present them as real answers.';

/** Child processes this run started, stopped again if the run fails or is interrupted. */
const startedHere = [];

/** @param {string} line */
function say(line = '') {
  process.stdout.write(`${line}\n`);
}

/** @param {string} message @param {number} [code] @returns {never} */
function fail(message, code = 1) {
  process.stderr.write(`\n${message}\n`);
  process.exit(code);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** @param {string} path */
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** @param {string[]} args */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: APP_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** @param {string | null} commit */
const short = (commit) => (commit ? commit.slice(0, 7) : 'unknown');

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === 'EPERM';
  }
}

/**
 * Alive and started when the pid file says: a pid reused after a reboot is never touched.
 * @param {number} pid @param {number} startedAtMs
 */
function isOurProcess(pid, startedAtMs) {
  if (!isAlive(pid)) return false;
  let elapsed;
  try {
    elapsed = execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return false;
  }
  return isSameProcess({ elapsedSeconds: parseElapsed(elapsed), recordedStartMs: startedAtMs, nowMs: Date.now() });
}

/** The children run in their own process group (detached), so the whole group gets the signal. @param {number} pid @param {NodeJS.Signals} signal */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/** SIGTERM, then SIGKILL after STOP_TIMEOUT_MS. @param {number} pid */
async function terminate(pid) {
  signalGroup(pid, 'SIGTERM');
  for (let waited = 0; waited < STOP_TIMEOUT_MS; waited += 200) {
    if (!isAlive(pid)) return true;
    await sleep(200);
  }
  signalGroup(pid, 'SIGKILL');
  await sleep(300);
  return !isAlive(pid);
}

function readRecord() {
  if (!existsSync(PID_FILE)) return null;
  try {
    return parsePidFile(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} distDir */
function readBuiltCommit(distDir) {
  try {
    const marker = JSON.parse(readFileSync(join(APP_DIR, distDir, BUILD_MARKER), 'utf8'));
    return typeof marker.commit === 'string' ? marker.commit : null;
  } catch {
    return null;
  }
}

function logTail(lines = 25) {
  try {
    return readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(the log is empty)';
  }
}

/** A fresh log for each start; the last one is kept as demo.previous.log. */
function startNewLog() {
  if (existsSync(LOG_FILE)) renameSync(LOG_FILE, PREVIOUS_LOG_FILE);
  writeFileSync(LOG_FILE, `[demo] ${new Date().toISOString()}\n`);
}

/**
 * Starts a background process in its own process group, with its output in the log.
 * @param {string[]} args @param {Record<string, string>} env
 */
function spawnInBackground(args, env) {
  const out = openSync(LOG_FILE, 'a');
  try {
    const child = spawn(process.execPath, args, { cwd: APP_DIR, env, detached: true, stdio: ['ignore', out, out] });
    child.on('error', (error) => process.stderr.write(`Could not start ${args[0]}: ${describeError(error)}\n`));
    if (child.pid === undefined) fail(`Could not start ${args.join(' ')}.`);
    child.unref();
    startedHere.push(child.pid);
    return child;
  } finally {
    closeSync(out);
  }
}

function freePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** Stops what this run started, clears its record, prints the end of the log and exits. @param {string} message */
async function abort(message) {
  for (const pid of startedHere) signalGroup(pid, 'SIGTERM');
  rmSync(PID_FILE, { force: true });
  process.stderr.write(`\n${message}\nThe last lines of .data/demo.log:\n${logTail()}\n`);
  process.exit(1);
}

/** @param {number} port @param {boolean} open */
function showPages(port, open) {
  const urls = demoUrls(port);
  say(`  Team chat:         ${urls.team}`);
  say(`  Workspace mockup:  ${urls.workspace}`);
  say(`  Team overview:     ${urls.overview}`);
  if (!open) return;
  if (process.platform !== 'darwin') {
    say('Open those addresses in your browser.');
    return;
  }
  const opener = spawn('open', [urls.team, urls.workspace], { stdio: 'ignore', detached: true });
  opener.on('error', () => say('Could not open the browser: open the addresses above yourself.'));
  opener.unref();
}

/** @param {string[]} tried */
function noSettingsHelp(tried) {
  return [
    `No model settings file was found. Looked for: ${tried.join(', ')}.`,
    '',
    'Create ~/.config/raagents/llm.env once, from your own settings. In a copy of the app that has your',
    'filled-in .env.local, run:',
    '  mkdir -p ~/.config/raagents && cp .env.local ~/.config/raagents/llm.env && chmod 600 ~/.config/raagents/llm.env',
    'Or copy env.example there, fill in your own values and chmod 600 it.',
    '',
    'No VPN, or no settings at hand? Practise with: npm run demo:practice',
  ].join('\n');
}

/** next build into the build folder, its output on screen and in the log. @param {string} distDir @param {string | null} commit */
async function build(distDir, commit) {
  const marker = join(APP_DIR, distDir, BUILD_MARKER);
  rmSync(marker, { force: true });
  const env = buildEnv({ baseEnv: process.env, appDir: APP_DIR, distDir });
  const log = createWriteStream(LOG_FILE, { flags: 'a' });
  const child = spawn(process.execPath, [NEXT_BIN, 'build'], { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    log.write(chunk);
  });
  const code = await new Promise((done) => {
    child.on('error', () => done(-1));
    child.on('close', done);
  });
  await new Promise((done) => log.end(done));
  if (code !== 0) fail(`The build failed (exit code ${code}). Its output is above and in .data/demo.log.`);
  writeFileSync(marker, `${JSON.stringify({ commit, builtAt: new Date().toISOString() })}\n`);
}

/** @param {number} port */
async function waitForFakeLlm(port, child) {
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  for (let waited = 0; waited < FAKE_START_TIMEOUT_MS; waited += 200) {
    if (exited) return false;
    try {
      const response = await fetch(`http://${HOST}:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await sleep(200);
  }
  return false;
}

/** @param {{ command: 'live' | 'practice', open: boolean, rebuild: boolean, port: number, distDir: string }} args */
async function start({ command: mode, open, rebuild, port, distDir }) {
  if (!existsSync(NEXT_BIN)) fail('Next.js is not installed in this folder. Run npm ci first, then try again.');
  const commit = git(['rev-parse', 'HEAD']) || null;

  const record = readRecord();
  const alive = record !== null && isOurProcess(record.serverPid, record.startedAtMs);
  if (record !== null && !alive) {
    // The server is gone: stop a stand-in model it left behind and forget the record.
    if (record.fakePid !== null && isOurProcess(record.fakePid, record.startedAtMs)) await terminate(record.fakePid);
    rmSync(PID_FILE, { force: true });
  }

  const probe = await probeDemo({ fetch, port });
  const decision = decideStart({ requested: mode, port, probe, recorded: record && { port: record.port, mode: record.mode, alive } });
  if (decision.action === 'refuse') fail(decision.message);
  if (decision.action === 'open') {
    say(`The ${mode} demo is already running on port ${port}.`);
    if (decision.note) say(decision.note);
    if (alive && record.commit && commit && record.commit !== commit) {
      say(`It runs commit ${short(record.commit)}; this folder is now at ${short(commit)}. To update it: npm run demo:stop, then npm run ${scriptFor(mode)}.`);
    }
    if (rebuild) say(`--rebuild only applies when the demo starts. To rebuild: npm run demo:stop, then npm run ${scriptFor(mode)} -- --rebuild.`);
    if (mode === 'practice') say(PRACTICE_WARNING);
    showPages(port, open);
    return;
  }

  // Live mode: locate the settings file. It is passed to Node by path and never opened here.
  let envFile = null;
  if (mode === 'live') {
    const found = findEnvFile({ env: process.env, homeDir: homedir(), cwd: process.cwd(), appDir: APP_DIR, isFile });
    for (const warning of found.warnings) say(`Warning: ${warning}`);
    if (found.file === null) fail(noSettingsHelp(found.tried));
    envFile = found.file.path;
    const shown = found.file.label === '$RAAGENTS_ENV_FILE' ? displayPath(found.file.path, homedir()) : found.file.label;
    say(`Model settings: ${shown} (handed to Node as a file; not read or printed here).`);
    const permission = envFilePermissionProblem(statSync(found.file.path).mode, shown);
    if (permission) say(`Warning: ${permission}`);
  }

  const plan = buildPlan({ hasBuild: existsSync(join(APP_DIR, distDir, 'BUILD_ID')), builtCommit: readBuiltCommit(distDir), commit, rebuild });
  startNewLog();
  if (plan.build) {
    say(`Building the app once, into ${distDir}: ${plan.reason}. This takes a minute or two.`);
    await build(distDir, commit);
  } else {
    say(`Using the existing build: ${plan.reason}.`);
    if (commit && git(['status', '--porcelain', '--', '.'])) {
      say('Note: this folder has uncommitted changes, which that build may not include. To build them: add -- --rebuild.');
    }
  }

  process.once('SIGINT', () => {
    void abort('Interrupted: stopped what this run had started.');
  });

  const startedAtMs = Date.now();
  let fakePid = null;
  let fakeBaseUrl;
  if (mode === 'practice') {
    const fakePort = await freePort();
    const fakeEnv = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => !name.startsWith('LLM_') && value !== undefined));
    const fake = spawnInBackground([FAKE_LLM, ...fakeLlmArgs({ port: fakePort, env: process.env })], fakeEnv);
    fakePid = fake.pid;
    if (!(await waitForFakeLlm(fakePort, fake))) await abort('The stand-in model (scripts/fake-llm.mjs) did not start.');
    fakeBaseUrl = `http://${HOST}:${fakePort}/v1`;
  }

  const env = serverEnv({ mode, baseEnv: process.env, appDir: APP_DIR, distDir, fakeBaseUrl });
  const nodeArgs = [...(envFile ? [`--env-file=${envFile}`] : []), NEXT_BIN, 'start', '-H', HOST, '-p', String(port)];
  const server = spawnInBackground(nodeArgs, env);
  writeFileSync(PID_FILE, formatPidFile({ mode, port, serverPid: server.pid, fakePid, startedAtMs, commit }));
  let exited = false;
  server.on('exit', () => {
    exited = true;
  });

  say(`Starting the ${mode} demo on port ${port}…`);
  const result = await waitForHealth({
    probe: () => probeDemo({ fetch, port }),
    isAlive: () => !exited,
    timeoutMs: SERVER_START_TIMEOUT_MS,
    intervalMs: 500,
  });
  if (!result.ok) {
    await abort(result.reason === 'exited' ? 'The app stopped while starting.' : `The app did not answer within ${SERVER_START_TIMEOUT_MS / 1000} s.`);
    return;
  }
  const answered = /** @type {{ state: 'demo', mode: 'live' | 'practice', startedAt: string, report?: any }} */ (result.probe);
  if (Math.abs(Date.parse(answered.startedAt) - startedAtMs) > 60_000) {
    await abort(`Another server answers on port ${port}, not the one this run started.`);
    return;
  }
  if (answered.mode !== mode) {
    await abort(`The app reports ${answered.mode} mode instead of ${mode}, so this run stopped it.`);
    return;
  }

  say('');
  if (mode === 'practice') {
    say(PRACTICE_WARNING);
  } else {
    const llm = answered.report?.llm;
    if (llm && llm.configured === false) {
      const missing = Array.isArray(llm.missing) && llm.missing.length > 0 ? ` Missing: ${llm.missing.join(', ')}.` : '';
      say(`Warning: the model connection cannot be used, so the agents cannot answer (the pages show why).${missing}`);
      say('Fix the settings file, then: npm run demo:stop, and npm run demo again.');
    }
    say('Live mode: the agents need the VPN. No VPN? npm run demo:stop, then npm run demo:practice.');
  }
  say(`The ${mode} demo is running (log: .data/demo.log).`);
  showPages(port, open);
  say('It keeps running in the background. Stop it with: npm run demo:stop');
  process.exit(0);
}

/** @param {{ port: number }} args */
async function stop({ port }) {
  const record = readRecord();
  if (record === null) {
    rmSync(PID_FILE, { force: true });
    const probe = await probeDemo({ fetch, port });
    if (probe.state === 'demo') {
      say(`No demo started from this folder is recorded, but a ${probe.mode} demo answers on port ${port}. Stop it from the folder that started it.`);
    } else {
      say('No demo started from this folder is running.');
    }
    return;
  }

  let stoppedAny = false;
  for (const pid of [record.serverPid, record.fakePid]) {
    if (pid === null || !isAlive(pid)) continue;
    if (!isOurProcess(pid, record.startedAtMs)) {
      say(`Process ${pid} did not start when the demo did, so it is another program now. It was left alone.`);
      continue;
    }
    if (!(await terminate(pid))) fail(`Could not stop process ${pid} of the ${record.mode} demo. Its record stays in .data/demo.pid.`);
    stoppedAny = true;
  }
  rmSync(PID_FILE, { force: true });

  const after = await probeDemo({ fetch, port: record.port });
  if (after.state !== 'free') {
    fail(`Port ${record.port} still answers after the stop (${after.state === 'demo' ? `a ${after.mode} demo` : after.detail}): it was not started from this folder.`);
  }
  say(stoppedAny ? `Stopped the ${record.mode} demo on port ${record.port}.` : `The ${record.mode} demo was no longer running; its record is cleared.`);
}

async function main() {
  const versionProblem = nodeVersionProblem(process.versions.node);
  if (versionProblem) fail(versionProblem);
  if (process.platform === 'win32') fail('The demo launcher runs on macOS and Linux.');
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  if (args.command === 'stop') await stop(args);
  else await start(args);
}

main().catch((error) => {
  void abort(`The demo launcher failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
