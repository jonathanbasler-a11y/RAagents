import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { connect, createServer, type Server } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeLlm } from '../fake-llm.mjs';
import {
  TIMEOUTS,
  browserCommand,
  buildServerEnv,
  checkConnection,
  classifyError,
  classifyStatus,
  connectionProblem,
  describeFailure,
  editorCommand,
  findFreePort,
  formatRecord,
  isPortFree,
  identifyServer,
  interruptCleanup,
  isPlaceholder,
  llmSettingsFrom,
  parseRecord,
  parseSettings,
  pathsFor,
  redact,
  releaseStartLock,
  runCommand,
  secretsOf,
  settingsProblem,
  settingsReport,
  startBackground,
  startPortFrom,
  terminate,
  tryAcquireStartLock,
  trustSystemCertificates,
} from './launcher-lib.mjs';

// The simulated machine is handed to plain JavaScript that takes loose objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// The launcher's decisions with the machine injected: no real browser, editor or gateway. Windows
// branches run here on any platform through `platform: 'win32'`.

// The tests block the global fetch; a real wait on a real socket needs its own small one.
function httpFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(url, { method: init.method, headers: init.headers }, (reply) => {
      const parts: Buffer[] = [];
      reply.on('data', (part: Buffer) => parts.push(part));
      reply.on('end', () => resolve(new Response(Buffer.concat(parts), { status: reply.statusCode })));
    });
    init.signal?.addEventListener('abort', () => {
      request.destroy();
      reject(init.signal?.reason);
    });
    request.on('error', reject);
    request.end(init.body);
  });
}

const KEY = 'fake-key-1234567890';
const HOST_NAME = 'gateway.example.test';
const BASE = `https://${HOST_NAME}/v1`;

describe('the settings file', () => {
  it('reads KEY=value lines, ignoring comments, blanks, quotes, export and Windows line endings', () => {
    const text = [
      '\uFEFF# a comment',
      '',
      'LLM_BASE_URL = https://gw.test/v1   # trailing note',
      'export LLM_MODEL="model-x"',
      "LLM_API_KEY='abc def'",
      '  # LLM_MAX_TOKENS=99',
      'LLM_API_KEY_HEADER=',
      'not a setting',
    ].join('\r\n');

    expect(parseSettings(text)).toEqual({
      LLM_BASE_URL: 'https://gw.test/v1',
      LLM_MODEL: 'model-x',
      LLM_API_KEY: 'abc def',
      LLM_API_KEY_HEADER: '',
    });
  });

  it('lets the last assignment win and keeps a quoted value with a # inside', () => {
    expect(parseSettings('A=1\nA=2\nB="x # y"')).toEqual({ A: '2', B: 'x # y' });
  });

  it.each(['', '   ', '\t', 'your-key-here', 'Your_API_key', '<paste the key>', 'xxxx', 'changeme', 'TBD', '${KEY}', 'https://<your-gateway>/v1'])(
    'counts %j as empty',
    (value) => {
      expect(isPlaceholder(value)).toBe(true);
    },
  );

  it.each(['sk-abc123', 'https://gw.test/v1', 'claude-x-1', 'a'])('counts %j as filled', (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });

  it('is filled only when the address, the key and the model all hold a real value', () => {
    const full = { LLM_BASE_URL: BASE, LLM_API_KEY: KEY, LLM_MODEL: 'm-1' };
    expect(settingsReport(full)).toMatchObject({ filled: true, missing: [], holdsKey: true });
    expect(settingsReport({ ...full, LLM_API_KEY: '   ' })).toMatchObject({ filled: false, missing: ['LLM_API_KEY'], holdsKey: false });
    expect(settingsReport({ ...full, LLM_API_KEY: 'your-key-here', LLM_MODEL: '' })).toMatchObject({ filled: false, missing: ['LLM_API_KEY', 'LLM_MODEL'] });
    expect(settingsReport({})).toMatchObject({ filled: false, missing: ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] });
  });

  it('hands on only the names the app reads, and only real values', () => {
    expect(
      llmSettingsFrom({ LLM_BASE_URL: BASE, LLM_API_KEY: KEY, LLM_MODEL: 'm', LLM_API_KEY_HEADER: '', LLM_MAX_TOKENS: ' 800 ', LLM_JUDGE_API_KEY: 'secret', PATH: '/x' }),
    ).toEqual({ LLM_BASE_URL: BASE, LLM_API_KEY: KEY, LLM_MODEL: 'm', LLM_MAX_TOKENS: '800' });
  });

  it('strips the curly quotes a word processor puts around a pasted value, as well as straight ones', () => {
    const text = 'A=\u201Cabc def\u201D\nB=\u2018x\u2019\nC=\u201Ey\u201C\nD="z"\nE=\u201Cnever closed';

    expect(parseSettings(text)).toEqual({ A: 'abc def', B: 'x', C: 'y', D: 'z', E: '\u201Cnever closed' });
  });
});

describe('settingsProblem: a value that is filled in but cannot work', () => {
  const ok = { LLM_BASE_URL: BASE, LLM_API_KEY: KEY, LLM_MODEL: 'm-1' };

  it('accepts a normal set of settings, with or without the optional lines', () => {
    expect(settingsProblem(ok)).toBeNull();
    expect(settingsProblem({ ...ok, LLM_API_KEY_HEADER: 'x-api-key', LLM_MAX_TOKENS: '900' })).toBeNull();
  });

  it.each([
    ['a "Bearer" prefix', 'Bearer abc123'],
    ['a space inside', 'abc 123'],
    ['a curly quote', 'abc\u201D123'],
    ['a straight quote', 'abc"123'],
    ['a non-ASCII letter', 'caf\u00E9123'],
  ])('refuses a key with %s, and names the line without showing the key', (_label, key) => {
    const problem = settingsProblem({ ...ok, LLM_API_KEY: key });

    expect(problem).toMatch(/LLM_API_KEY/);
    expect(problem).not.toContain(key);
  });

  it('refuses a model name with a space and a header name that is not a name', () => {
    expect(settingsProblem({ ...ok, LLM_MODEL: 'my model' })).toMatch(/LLM_MODEL/);
    expect(settingsProblem({ ...ok, LLM_API_KEY_HEADER: 'x api key' })).toMatch(/LLM_API_KEY_HEADER/);
  });
});

describe('pathsFor: every path, on both systems', () => {
  it('builds Windows paths with backslashes, even when the parent folder has spaces', () => {
    const root = 'C:\\Users\\Some User\\OneDrive - My Docs\\HybridDemo';
    const paths = pathsFor({ platform: 'win32', root, env: {} });

    expect(paths.appDir).toBe(`${root}\\app`);
    expect(paths.serverEntry).toBe(`${root}\\app\\server.js`);
    expect(paths.serverCwd).toBe(`${root}\\app`);
    expect(paths.agentsDir).toBe(`${root}\\app\\agents`);
    expect(paths.settingsFile).toBe(`${root}\\my-settings.env`);
    expect(paths.dataDir).toBe(`${root}\\data`);
    expect(paths.pidFile).toBe(`${root}\\data\\demo.pid`);
    expect(paths.lockFile).toBe(`${root}\\data\\demo.lock`);
    expect(paths.logFile).toBe(`${root}\\data\\demo.log`);
    expect(paths.liveDb).toBe(`${root}\\data\\demo.db`);
    expect(paths.practiceDb).toBe(`${root}\\data\\demo-practice.db`);
    expect(paths.fakeLlm).toBe(`${root}\\launcher\\fake-llm.mjs`);
  });

  it('builds Mac paths with slashes', () => {
    const paths = pathsFor({ platform: 'darwin', root: '/Volumes/Work Disk/My Docs/HybridDemo', env: {} });

    expect(paths.dataDir).toBe('/Volumes/Work Disk/My Docs/HybridDemo/data');
    expect(paths.settingsFile).toBe('/Volumes/Work Disk/My Docs/HybridDemo/my-settings.env');
  });

  it('moves things with the test hooks, on both systems', () => {
    const win = pathsFor({
      platform: 'win32',
      root: 'C:\\D\\HybridDemo',
      env: { HYBRID_DATA_DIR: 'D:\\scratch dir\\data', RAAGENTS_ENV_FILE: 'keys\\mine.env', HYBRID_SERVER_ENTRY: 'D:\\fake server\\server.js' },
    });
    expect(win.dataDir).toBe('D:\\scratch dir\\data');
    expect(win.pidFile).toBe('D:\\scratch dir\\data\\demo.pid');
    expect(win.settingsFile).toBe('C:\\D\\HybridDemo\\keys\\mine.env');
    expect(win.serverEntry).toBe('D:\\fake server\\server.js');
    expect(win.serverCwd).toBe('D:\\fake server');

    const mac = pathsFor({ platform: 'darwin', root: '/r/HybridDemo', env: { HYBRID_DATA_DIR: 'scratch' } });
    expect(mac.dataDir).toBe('/r/HybridDemo/scratch');
  });

  it('ignores blank hooks', () => {
    expect(pathsFor({ platform: 'darwin', root: '/r', env: { HYBRID_DATA_DIR: '  ', RAAGENTS_ENV_FILE: '' } }).dataDir).toBe('/r/data');
  });
});

describe('ports', () => {
  it('starts at 3200, or at HYBRID_PORT', () => {
    expect(startPortFrom({})).toBe(3200);
    expect(startPortFrom({ HYBRID_PORT: '' })).toBe(3200);
    expect(startPortFrom({ HYBRID_PORT: ' 4100 ' })).toBe(4100);
  });

  it.each(['abc', '0', '70000', '-1', '32.5'])('refuses HYBRID_PORT=%s', (value) => {
    expect(() => startPortFrom({ HYBRID_PORT: value })).toThrow(/HYBRID_PORT/);
  });

  it('moves to the next port when one is busy, and skips ports it was told to avoid', async () => {
    const busy = new Set([3200, 3201]);
    const isFree = async (port: number) => !busy.has(port);

    expect(await findFreePort({ start: 3200, isFree })).toBe(3202);
    expect(await findFreePort({ start: 3200, isFree, skip: [3202] })).toBe(3203);
  });

  it('gives up when nothing is free to the end', async () => {
    await expect(findFreePort({ start: 65534, isFree: async () => false })).rejects.toThrow(/no free port/);
  });
});

describe('buildServerEnv: loopback only, and the person cannot change that', () => {
  const root = '/r/HybridDemo';
  const paths = pathsFor({ platform: 'darwin', root, env: {} });
  const llm = { LLM_BASE_URL: BASE, LLM_API_KEY: KEY, LLM_MODEL: 'm' };

  it('always binds to 127.0.0.1, whatever the environment says', () => {
    const env = buildServerEnv({
      platform: 'darwin',
      baseEnv: { HOSTNAME: '0.0.0.0', HOST: 'evil.test', ALLOWED_HOSTS: 'evil.test', PORT: '80', NODE_ENV: 'development', PATH: '/bin' },
      paths,
      port: 3200,
      mode: 'live',
      llm,
    });

    expect(env).toMatchObject({ HOSTNAME: '127.0.0.1', HOST: '127.0.0.1', PORT: '3200', NODE_ENV: 'production', PATH: '/bin' });
    expect(env.ALLOWED_HOSTS).toBeUndefined();
  });

  it('sets the folders, the database and the mode itself, without a build-folder name', () => {
    const live = buildServerEnv({ platform: 'darwin', baseEnv: { NEXT_DIST_DIR: '.next-x', CHAT_DB_PATH: '/elsewhere.db', DEMO_MODE: 'practice' }, paths, port: 3201, mode: 'live', llm });
    expect(live).toMatchObject({
      AGENT_SPECS_DIR: `${root}/app/agents`,
      CHAT_DB_PATH: `${root}/data/demo.db`,
      NEXT_TELEMETRY_DISABLED: '1',
      DEMO_MODE: 'live',
    });
    expect(live.NEXT_DIST_DIR).toBeUndefined();

    const practice = buildServerEnv({ platform: 'darwin', baseEnv: {}, paths, port: 3201, mode: 'practice', fakeBaseUrl: 'http://127.0.0.1:4555/v1' });
    expect(practice.CHAT_DB_PATH).toBe(`${root}/data/demo-practice.db`);
    expect(practice.DEMO_MODE).toBe('practice');
  });

  it('live: takes the model settings from the settings file only, never from the environment', () => {
    const env = buildServerEnv({
      platform: 'darwin',
      baseEnv: { LLM_API_KEY: 'from-the-shell', LLM_JUDGE_API_KEY: 'judge', LLM_ALLOW_PLAIN_HTTP: '1' },
      paths,
      port: 3200,
      mode: 'live',
      llm,
    });

    expect(env.LLM_API_KEY).toBe(KEY);
    expect(env.LLM_JUDGE_API_KEY).toBeUndefined();
    expect(env.LLM_ALLOW_PLAIN_HTTP).toBeUndefined();
  });

  it('practice: points every model name at the stand-in and ignores the settings file', () => {
    const env = buildServerEnv({ platform: 'darwin', baseEnv: { LLM_API_KEY: 'real' }, paths, port: 3200, mode: 'practice', llm, fakeBaseUrl: 'http://127.0.0.1:4555/v1' });

    expect(env.LLM_BASE_URL).toBe('http://127.0.0.1:4555/v1');
    expect(env.LLM_API_KEY).toMatch(/^fake/);
    expect(JSON.stringify(env)).not.toContain(KEY);
    expect(JSON.stringify(env)).not.toContain('real');
  });

  it('Windows: names are not case sensitive, so differently written names are dropped too', () => {
    const winPaths = pathsFor({ platform: 'win32', root: 'C:\\D\\HybridDemo', env: {} });
    const env = buildServerEnv({
      platform: 'win32',
      baseEnv: { Hostname: '0.0.0.0', host: 'x', Port: '1', llm_api_key: 'shell', Path: 'C:\\Windows' },
      paths: winPaths,
      port: 3200,
      mode: 'live',
      llm,
    });

    expect(Object.keys(env).filter((name) => /^(hostname|host|port)$/i.test(name)).sort()).toEqual(['HOST', 'HOSTNAME', 'PORT']);
    expect(Object.keys(env).filter((name) => /^llm_api_key$/i.test(name))).toEqual(['LLM_API_KEY']);
    expect(env.Path).toBe('C:\\Windows');
    expect(env.CHAT_DB_PATH).toBe('C:\\D\\HybridDemo\\data\\demo.db');
  });

  it('live: asks Node to trust the operating system\'s certificates, whatever the environment says; practice has no use for it', () => {
    const live = buildServerEnv({ platform: 'darwin', baseEnv: { NODE_USE_SYSTEM_CA: '0' }, paths, port: 3200, mode: 'live', llm });
    expect(live.NODE_USE_SYSTEM_CA).toBe('1');

    const winPaths = pathsFor({ platform: 'win32', root: 'C:\\D\\HybridDemo', env: {} });
    const win = buildServerEnv({ platform: 'win32', baseEnv: { node_use_system_ca: '0' }, paths: winPaths, port: 3200, mode: 'live', llm });
    expect(Object.keys(win).filter((name) => /^node_use_system_ca$/i.test(name))).toEqual(['NODE_USE_SYSTEM_CA']);
    expect(win.NODE_USE_SYSTEM_CA).toBe('1');

    const practice = buildServerEnv({ platform: 'darwin', baseEnv: {}, paths, port: 3200, mode: 'practice', fakeBaseUrl: 'http://127.0.0.1:4555/v1' });
    expect(practice.NODE_USE_SYSTEM_CA).toBeUndefined();
  });
});

describe('trustSystemCertificates', () => {
  it('adds the system certificates that Node does not trust yet, and only those', () => {
    const seen: string[][] = [];
    const tls = {
      getCACertificates: (kind: string) => (kind === 'default' ? ['a', 'b'] : ['b', 'c', 'd']),
      setDefaultCACertificates: (list: string[]) => void seen.push(list),
    };

    expect(trustSystemCertificates({ tls })).toEqual({ added: 2 });
    expect(seen).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('changes nothing when there is nothing new, when this Node cannot do it, or when the system refuses', () => {
    let sets = 0;
    const same = { getCACertificates: () => ['a'], setDefaultCACertificates: () => void (sets += 1) };
    expect(trustSystemCertificates({ tls: same })).toEqual({ added: 0 });
    expect(sets).toBe(0);

    expect(trustSystemCertificates({ tls: {} })).toEqual({ added: 0 });
    expect(trustSystemCertificates({ tls: { getCACertificates: () => ['a'] } })).toEqual({ added: 0 });

    const refusing = {
      getCACertificates: (kind: string) => (kind === 'default' ? [] : ['x']),
      setDefaultCACertificates: () => {
        throw new Error('no');
      },
    };
    expect(trustSystemCertificates({ tls: refusing })).toEqual({ added: 0 });
  });
});

describe('starting and ending background programs', () => {
  function fakeSpawn() {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = (file: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ file, args, options });
      return Object.assign(new EventEmitter(), { pid: 777, unref() {} });
    };
    return { spawn, calls };
  }

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launcher lib '));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('detaches, hides the window and sends the output to the log, then lets the launcher leave', () => {
    const { spawn, calls } = fakeSpawn();
    const logFile = join(dir, 'demo.log');

    const started = startBackground({ spawn, fs, execPath: 'node', args: ['C:\\x y\\server.js'], cwd: 'C:\\x y', env: { A: '1' }, logFile });

    expect(started.pid).toBe(777);
    expect(started.state.exited).toBe(false);
    expect(calls[0].options).toMatchObject({ detached: true, windowsHide: true, cwd: 'C:\\x y', env: { A: '1' } });
    const stdio = calls[0].options.stdio as unknown[];
    expect(stdio[0]).toBe('ignore');
    expect(typeof stdio[1]).toBe('number');
    expect(stdio[2]).toBe(stdio[1]);
    expect(existsSync(logFile)).toBe(true);
  });

  it('reports a program that could not start, or exits at once', () => {
    const throwing = startBackground({
      spawn: () => {
        throw new Error('EACCES');
      },
      fs,
      execPath: 'node',
      args: [],
      cwd: dir,
      env: {},
      logFile: join(dir, 'a.log'),
    });
    expect(throwing).toMatchObject({ pid: undefined, state: { exited: true } });

    const emitter = Object.assign(new EventEmitter(), { pid: 5, unref() {} });
    const exiting = startBackground({ spawn: () => emitter, fs, execPath: 'node', args: [], cwd: dir, env: {}, logFile: join(dir, 'b.log') });
    expect(exiting.state.exited).toBe(false);
    emitter.emit('exit', 1);
    expect(exiting.state.exited).toBe(true);
  });

  function stopContext(alive: Set<number>, extra: Record<string, unknown> = {}) {
    const log: string[] = [];
    return {
      log,
      ctx: {
        isAlive: (pid: number) => alive.has(pid),
        kill: (pid: number, signal: string) => {
          log.push(`kill ${pid} ${signal}`);
          if (signal === 'SIGKILL' || !extra.stubborn) alive.delete(pid);
        },
        run: async (file: string, args: string[]) => {
          log.push(`run ${file} ${args.join(' ')}`);
          alive.delete(Number(args[1]));
          return { ok: true };
        },
        sleep: async () => {},
        timeouts: { ...TIMEOUTS, stopMs: 400 },
      },
    };
  }

  it('Mac and Linux: asks politely first (SIGTERM), and only forces (SIGKILL) a program that stays', async () => {
    const polite = stopContext(new Set([42]));
    expect(await terminate({ platform: 'darwin', pid: 42, ctx: polite.ctx })).toBe(true);
    expect(polite.log).toEqual(['kill 42 SIGTERM']);

    const stubborn = stopContext(new Set([42]), { stubborn: true });
    expect(await terminate({ platform: 'linux', pid: 42, ctx: stubborn.ctx })).toBe(true);
    expect(stubborn.log).toEqual(['kill 42 SIGTERM', 'kill 42 SIGKILL']);
  });

  it('Windows: ends the program and its children with taskkill, with no signal', async () => {
    const { ctx, log } = stopContext(new Set([42]));

    expect(await terminate({ platform: 'win32', pid: 42, ctx })).toBe(true);
    expect(log).toEqual(['run taskkill /PID 42 /T /F']);
  });

  it('says so when the program is still there', async () => {
    const alive = new Set([42]);
    const { ctx } = stopContext(alive);
    ctx.run = async () => ({ ok: false });

    expect(await terminate({ platform: 'win32', pid: 42, ctx })).toBe(false);
  });
});

describe('opening the browser and the editor', () => {
  it('uses the right program on each system, and keeps a path with spaces as one argument', () => {
    const url = 'http://127.0.0.1:3200/';
    expect(browserCommand({ platform: 'darwin', url })).toEqual({ command: 'open', args: [url] });
    expect(browserCommand({ platform: 'win32', url })).toEqual({ command: 'cmd', args: ['/c', 'start', '', url] });
    expect(browserCommand({ platform: 'linux', url })).toEqual({ command: 'xdg-open', args: [url] });

    expect(editorCommand({ platform: 'darwin', file: '/Volumes/Work Disk/My Docs/my-settings.env' })).toEqual({
      command: 'open',
      args: ['-e', '/Volumes/Work Disk/My Docs/my-settings.env'],
    });
    expect(editorCommand({ platform: 'win32', file: 'C:\\Users\\Some User\\my-settings.env' })).toEqual({
      command: 'notepad',
      args: ['C:\\Users\\Some User\\my-settings.env'],
    });
    expect(editorCommand({ platform: 'linux', file: '/x' })).toBeNull();
  });
});

describe('the pid file', () => {
  const record = { mode: 'practice' as const, port: 3200, serverPid: 4242, fakePid: 4241, fakePort: 4555, startedAtMs: 1_790_000_000_000, commit: null };

  it('round-trips, with the stand-in model port', () => {
    expect(parseRecord(formatRecord(record))).toEqual(record);
    expect(parseRecord(formatRecord({ ...record, mode: 'live', fakePid: null, fakePort: null }))).toEqual({ ...record, mode: 'live', fakePid: null, fakePort: null });
  });

  it.each(['', 'nope', '{}', JSON.stringify({ ...record, serverPid: 0 }), JSON.stringify({ ...record, fakePort: 'x' }), JSON.stringify({ ...record, mode: 'dev' })])('refuses %j', (text) => {
    expect(parseRecord(text)).toBeNull();
  });
});

describe('identifyServer: is this pid really ours?', () => {
  const NOW = 1_800_000_000_000;
  const record = { mode: 'live' as const, port: 3200, serverPid: 4242, fakePid: null, fakePort: null, startedAtMs: NOW - 3_600_000, commit: null };

  function ctxWith(options: { alive?: boolean; health?: 'refused' | { mode?: string; startedAtMs: number } | 'other'; bootTimeMs?: number }) {
    const { alive = true, health = 'refused', bootTimeMs } = options;
    return {
      now: () => NOW,
      bootTimeMs,
      isAlive: () => alive,
      fetch: async () => {
        if (health === 'refused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        if (health === 'other') return new Response('<html>hello</html>', { status: 200 });
        return Response.json({
          status: 'ok',
          checks: {},
          agentCount: 1,
          llm: {},
          mode: health.mode ?? 'live',
          startedAt: new Date(health.startedAtMs).toISOString(),
        });
      },
    };
  }

  it('is gone when the process is gone', async () => {
    expect(await identifyServer({ record, ctx: ctxWith({ alive: false }) })).toBe('gone');
  });

  it('is ours when the app answers with the recorded start time and mode', async () => {
    expect(await identifyServer({ record, ctx: ctxWith({ health: { startedAtMs: record.startedAtMs + 3_000 } }) })).toBe('ours');
  });

  it('is not ours when another program, another mode or another start answers on the port', async () => {
    expect(await identifyServer({ record, ctx: ctxWith({ health: 'other' }) })).toBe('unconfirmed');
    expect(await identifyServer({ record, ctx: ctxWith({ health: { mode: 'practice', startedAtMs: record.startedAtMs } }) })).toBe('unconfirmed');
    expect(await identifyServer({ record, ctx: ctxWith({ health: { startedAtMs: record.startedAtMs + 600_000 } }) })).toBe('unconfirmed');
  });

  it('a fresh record whose server does not answer yet is still starting; an old one is unconfirmed', async () => {
    const fresh = { ...record, startedAtMs: NOW - 20_000 };
    expect(await identifyServer({ record: fresh, ctx: ctxWith({}) })).toBe('starting');
    expect(await identifyServer({ record, ctx: ctxWith({}) })).toBe('unconfirmed');
  });

  it('a record from before the last restart is gone, even if its pid is alive again', async () => {
    expect(await identifyServer({ record, ctx: ctxWith({ bootTimeMs: NOW - 600_000 }) })).toBe('gone');
  });

  it('a busy laptop: one slow answer is asked again before the server is called foreign', async () => {
    const waits = vi.spyOn(AbortSignal, 'timeout');
    let calls = 0;
    const timedOut = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const busy = {
      ...ctxWith({}),
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw timedOut();
        return Response.json({ status: 'ok', checks: {}, agentCount: 1, llm: {}, mode: 'live', startedAt: new Date(record.startedAtMs).toISOString() });
      },
    };
    expect(await identifyServer({ record, ctx: busy })).toBe('ours');
    expect(calls).toBe(2);

    calls = 0;
    const hung = {
      ...busy,
      fetch: async () => {
        calls += 1;
        throw timedOut();
      },
    };
    expect(await identifyServer({ record, ctx: hung })).toBe('unconfirmed');
    expect(calls).toBe(2);
    // each question waits long enough for a busy laptop (the default of 2 seconds would not)
    expect(waits.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(waits.mock.calls.every(([ms]) => ms >= 5000)).toBe(true);
  });

  it('a refused connection is not asked twice: nothing is there', async () => {
    let calls = 0;
    const refused = {
      ...ctxWith({}),
      fetch: async () => {
        calls += 1;
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      },
    };
    await identifyServer({ record, ctx: refused });
    expect(calls).toBe(1);
  });
});

describe('redact', () => {
  it('hides the key, the address and its host in any text', () => {
    const llm = { LLM_API_KEY: KEY, LLM_BASE_URL: BASE };
    const text = `fetch to ${BASE}/chat/completions failed (${HOST_NAME}) with key ${KEY}`;

    const clean = redact(text, secretsOf(llm));

    expect(clean).not.toContain(KEY);
    expect(clean).not.toContain(HOST_NAME);
    expect(clean).toContain('[hidden]');
  });

  it('leaves short values alone', () => {
    expect(redact('a b c', ['a'])).toBe('a b c');
  });
});

// ---------------------------------------------------------------------------------------------
// The connection check, against the repository's fake gateway (scripts/fake-llm.mjs)
// ---------------------------------------------------------------------------------------------

describe('checkConnection', () => {
  const fake = createFakeLlm({ delayMs: 0 });
  const viaFake = (url: string, init?: RequestInit) => fake.handle(new Request(url, init));
  const settings = (over: Record<string, string> = {}) => ({ LLM_BASE_URL: 'http://127.0.0.1:4555/v1', LLM_API_KEY: 'fake-ok', LLM_MODEL: 'fake-model', ...over });

  it('works with a good key and model', async () => {
    expect(await checkConnection({ fetch: viaFake, llm: settings() })).toEqual({ ok: true });
  });

  it('tells a wrong key from a good one', async () => {
    expect(await checkConnection({ fetch: viaFake, llm: settings({ LLM_API_KEY: 'not-the-key' }) })).toMatchObject({ ok: false, kind: 'wrong-key', status: 401 });
    expect(await checkConnection({ fetch: viaFake, llm: settings({ LLM_MODEL: 'fake-fail-401' }) })).toMatchObject({ ok: false, kind: 'wrong-key' });
  });

  it('tells an unknown model, a busy service and a broken one', async () => {
    expect(await checkConnection({ fetch: viaFake, llm: settings({ LLM_MODEL: 'fake-fail-model' }) })).toMatchObject({ ok: false, kind: 'unknown-model' });
    expect(await checkConnection({ fetch: viaFake, llm: settings({ LLM_MODEL: 'fake-fail-429' }) })).toMatchObject({ ok: false, kind: 'busy' });
    expect(await checkConnection({ fetch: viaFake, llm: settings({ LLM_MODEL: 'fake-fail-500' }) })).toMatchObject({ ok: false, kind: 'server-error', status: 500 });
  });

  it('asks again with max_completion_tokens when the service refuses max_tokens', async () => {
    const bodies: string[] = [];
    const watching = (url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return viaFake(url, init);
    };

    const result = await checkConnection({ fetch: watching, llm: settings({ LLM_MODEL: 'gpt-fake' }) });

    expect(result).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('"max_tokens"');
    expect(bodies[1]).toContain('"max_completion_tokens"');
    expect(bodies[1]).not.toContain('"max_tokens"');
  });

  it('does not ask a third time, and does not mistake a token complaint for an unknown model', async () => {
    let calls = 0;
    const stubborn = async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'this model rejects max_tokens' } }), { status: 400 });
    };

    expect(await checkConnection({ fetch: stubborn, llm: settings() })).toMatchObject({ ok: false, kind: 'other', status: 400 });
    expect(calls).toBe(2);
  });

  it('sends the key in the header the person named, and never follows a redirect with it', async () => {
    const seen: Array<Record<string, string>> = [];
    const redirects: Array<RequestInit['redirect']> = [];
    const watching = async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>);
      redirects.push(init?.redirect);
      return new Response('{}', { status: 200 });
    };

    await checkConnection({ fetch: watching, llm: settings({ LLM_API_KEY_HEADER: 'x-api-key' }) });
    await checkConnection({ fetch: watching, llm: settings() });

    expect(seen[0]['x-api-key']).toBe('fake-ok');
    expect(seen[0].authorization).toBeUndefined();
    expect(seen[1].authorization).toBe('Bearer fake-ok');
    expect(redirects).toEqual(['manual', 'manual']);
  });

  it.each(['', 'not a url', 'ftp://gw.test/v1', 'http://gw.example.test/v1', 'https://user:pw@gw.test/v1'])('refuses the address %j without asking anyone', async (address) => {
    let calls = 0;
    const result = await checkConnection({ fetch: async () => (calls += 1, new Response('{}')), llm: settings({ LLM_BASE_URL: address }) });

    expect(result).toEqual({ ok: false, kind: 'bad-address' });
    expect(calls).toBe(0);
  });

  it('says "not reachable" when the connection is refused or the name does not exist', async () => {
    const refused = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    expect(await checkConnection({ fetch: refused, llm: settings() })).toEqual({ ok: false, kind: 'unreachable' });
  });

  it('says "timed out" when the service does not answer in time (a real server that never replies)', async () => {
    const silent = createHttpServer(() => {
      // never answers
    });
    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));
    const { port } = silent.address() as { port: number };
    try {
      const result = await checkConnection({ fetch: httpFetch, llm: settings({ LLM_BASE_URL: `http://127.0.0.1:${port}/v1` }), timeoutMs: 300 });
      expect(result).toEqual({ ok: false, kind: 'timeout' });
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  });

  it('never puts the key or the address in what it returns or in the sentence for it', async () => {
    const llm = settings({ LLM_API_KEY: 'fake-secret-key-987', LLM_BASE_URL: 'https://gw.example.test/v1', LLM_MODEL: 'fake-fail-401' });
    const failing = async () => new Response(JSON.stringify({ error: { message: 'bad key fake-secret-key-987 for gw.example.test' } }), { status: 401 });

    const result = await checkConnection({ fetch: failing, llm });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const everything = JSON.stringify(result) + connectionProblem(result.kind, result.status);
      expect(everything).not.toContain('fake-secret-key-987');
      expect(everything).not.toContain('gw.example.test');
    }
  });

  it.each([
    [200, '', 'ok'],
    [401, '', 'wrong-key'],
    [403, '', 'wrong-key'],
    [404, 'model not found', 'unknown-model'],
    [404, 'no such route', 'wrong-address'],
    [302, '', 'wrong-address'],
    [412, 'model not allowed for this integration', 'unknown-model'],
    [429, '', 'busy'],
    [503, '', 'server-error'],
    [418, '', 'other'],
  ])('status %i %j is %s', (status, text, kind) => {
    expect(classifyStatus(status, text)).toBe(kind);
  });

  // fetch reports every network problem as "TypeError: fetch failed"; the code is on error.cause
  // (seen on Node 24 with an untrusted certificate: DEPTH_ZERO_SELF_SIGNED_CERT).
  const failedWith = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

  it.each([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])('%s is a certificate problem, not "not reachable" (a company network that re-signs traffic looks like this)', async (code) => {
    const result = await checkConnection({ fetch: async () => Promise.reject(failedWith(code)), llm: settings() });

    expect(result).toEqual({ ok: false, kind: 'certificate' });
    expect(classifyError(failedWith(code))).toBe('certificate');
  });

  it('tells the other things a call can fail with', () => {
    expect(classifyError(failedWith('ERR_SSL_WRONG_VERSION_NUMBER'))).toBe('wrong-address');
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH']) expect(classifyError(failedWith(code))).toBe('unreachable');
    expect(classifyError(new Error('no code at all'))).toBe('unreachable');
    expect(classifyError('a string')).toBe('unreachable');
    expect(classifyError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe('timeout');
  });

  it('finds the code inside a list of errors (several addresses were tried)', () => {
    const refused = Object.assign(new Error('r'), { code: 'ECONNREFUSED' });
    const cert = Object.assign(new Error('c'), { code: 'CERT_UNTRUSTED' });
    expect(classifyError(new TypeError('fetch failed', { cause: new AggregateError([refused, refused]) }))).toBe('unreachable');
    expect(classifyError(new TypeError('fetch failed', { cause: new AggregateError([refused, cert]) }))).toBe('certificate');
  });

  it('a key with a curly quote never reaches the network check: it is named before, not blamed on the network', async () => {
    // fetch itself throws on such a header value; without the check this would read "not reachable"
    expect(settingsProblem({ ...settings(), LLM_API_KEY: 'fake-\u201Dkey' })).toMatch(/LLM_API_KEY/);
  });

  it('has a plain sentence for every outcome, none of them jargon-heavy or empty', () => {
    for (const kind of ['bad-address', 'wrong-key', 'unknown-model', 'wrong-address', 'unreachable', 'certificate', 'timeout', 'busy', 'server-error', 'other'] as const) {
      const sentence = connectionProblem(kind, 500);
      expect(sentence.length).toBeGreaterThan(30);
      expect(sentence).not.toMatch(/ECONN|stack|TypeError|undefined/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The two commands, with the machine simulated
// ---------------------------------------------------------------------------------------------

const NOW = 1_800_000_000_000;

interface Sim {
  ctx: Record<string, Loose>;
  said: string[];
  launched: Array<{ command: string; args: string[] }>;
  servers: Array<{ pid: number; env: Record<string, string>; args: string[]; options: Record<string, Loose>; file: string }>;
  alive: Set<number>;
  ran: string[];
  killed: string[];
  dir: string;
  chatCalls: string[];
}

const WINDOWS_ROOT = 'C:\\Users\\Some User\\OneDrive - Docs\\HybridDemo';

/**
 * A small file system in memory, so a Windows folder with backslashes and spaces can be used on
 * any machine. Only what the launcher calls. Paths are plain strings: no folder tree is checked.
 */
function memoryFs() {
  const files = new Map<string, { data: string; mode: number }>();
  const folders = new Set<string>();
  const handles = new Map<number, string>();
  const chmods: string[] = [];
  let nextHandle = 100;
  const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: 'ENOENT' });
  return {
    files,
    chmods,
    existsSync: (path: string) => files.has(path) || folders.has(path),
    mkdirSync: (path: string) => void folders.add(path),
    readFileSync: (path: string) => {
      const file = files.get(path);
      if (!file) throw missing(path);
      return file.data;
    },
    writeFileSync: (path: string, data: string, options?: { flag?: string }) => {
      if (options?.flag === 'wx' && files.has(path)) throw Object.assign(new Error(`EEXIST: file already exists, '${path}'`), { code: 'EEXIST' });
      files.set(path, { data: String(data), mode: 0o644 });
    },
    appendFileSync: (path: string, data: string) => {
      const file = files.get(path) ?? { data: '', mode: 0o644 };
      files.set(path, { ...file, data: file.data + String(data) });
    },
    renameSync: (from: string, to: string) => {
      const file = files.get(from);
      if (!file) throw missing(from);
      files.delete(from);
      files.set(to, file);
    },
    rmSync: (path: string) => void files.delete(path),
    openSync: (path: string) => {
      if (!files.has(path)) files.set(path, { data: '', mode: 0o644 });
      nextHandle += 1;
      handles.set(nextHandle, path);
      return nextHandle;
    },
    closeSync: (handle: number) => void handles.delete(handle),
    statSync: (path: string) => {
      const file = files.get(path);
      if (!file) throw missing(path);
      return { mode: 0o100000 | file.mode };
    },
    chmodSync: (path: string, mode: number) => {
      chmods.push(path);
      const file = files.get(path);
      if (file) file.mode = mode;
    },
  };
}

function simulate(options: { platform?: string; env?: Record<string, string>; settings?: string | null; busyPorts?: number[]; baseEnv?: Record<string, string> } = {}): Sim {
  const platform = options.platform ?? 'darwin';
  const windows = platform === 'win32';
  const dir = mkdtempSync(join(tmpdir(), 'launcher sim '));
  // A Windows run uses real Windows paths over a file system in memory; the others use a real folder.
  const fsImpl: Loose = windows ? memoryFs() : fs;
  const root = windows ? WINDOWS_ROOT : join(dir, 'Hybrid Demo');
  const pathKit = windows ? win32 : { join };
  fsImpl.mkdirSync(pathKit.join(root, 'app'), { recursive: true });
  fsImpl.mkdirSync(pathKit.join(root, 'data'), { recursive: true });
  const env = { HYBRID_NO_BROWSER: '', ...options.env };
  const paths = pathsFor({ platform, root, env, fakeLlm: pathKit.join(root, 'launcher', 'fake-llm.mjs') });
  fsImpl.writeFileSync(paths.serverEntry, '// server');
  if (options.settings !== null && options.settings !== undefined) fsImpl.writeFileSync(paths.settingsFile, options.settings);

  const said: string[] = [];
  const launched: Sim['launched'] = [];
  const servers: Sim['servers'] = [];
  const alive = new Set<number>();
  const ran: string[] = [];
  const killed: string[] = [];
  const chatCalls: string[] = [];
  const fakeGateway = createFakeLlm({ delayMs: 0 });
  let nextPid = 1000;

  const ctx: Record<string, Loose> = {
    platform,
    env,
    baseEnv: options.baseEnv ?? { PATH: '/bin' },
    paths,
    fs: fsImpl,
    execPath: windows ? `${WINDOWS_ROOT}\\runtime\\win32-x64\\node.exe` : '/bundled/node',
    pid: 4999,
    now: () => NOW,
    sleep: async () => {},
    say: (line = '') => void said.push(line),
    timeouts: { ...TIMEOUTS, stopMs: 400, connectionMs: 2000 },
    isAlive: (pid: number) => alive.has(pid),
    kill: (pid: number, signal: string) => {
      killed.push(`${pid} ${signal}`);
      alive.delete(pid);
    },
    run: async (file: string, args: string[]) => {
      ran.push(`${file} ${args.join(' ')}`);
      alive.delete(Number(args[1]));
      return { ok: true };
    },
    launch: async (command: string, args: string[]) => (launched.push({ command, args }), true),
    isPortFree: async (port: number) => !(options.busyPorts ?? []).includes(port) && !servers.some((server) => server.env.PORT === String(port) && alive.has(server.pid)),
    ephemeralPort: async () => 45_555,
    spawn: (file: string, args: string[], spawnOptions: Record<string, Loose>) => {
      nextPid += 1;
      const child = Object.assign(new EventEmitter(), { pid: nextPid, unref() {} });
      alive.add(nextPid);
      servers.push({ pid: nextPid, env: spawnOptions.env, args, options: spawnOptions, file });
      return child;
    },
    fetch: async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/chat/completions')) {
        chatCalls.push(url.pathname);
        return fakeGateway.handle(new Request(input, init));
      }
      const port = url.port;
      const server = servers.find((candidate) => candidate.env.PORT === port && alive.has(candidate.pid));
      if (server && url.pathname === '/api/health') {
        return Response.json({
          status: 'ok',
          checks: {},
          agentCount: 2,
          llm: { configured: true },
          mode: server.env.DEMO_MODE,
          startedAt: new Date(NOW).toISOString(),
        });
      }
      const fakeServer = servers.find((candidate) => candidate.args[0]?.endsWith('fake-llm.mjs') && alive.has(candidate.pid));
      if (fakeServer && url.pathname === '/health' && String(Number(port)) === '45555') return new Response('fake LLM: ok\n');
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    },
  };
  return { ctx, said, launched, servers, alive, ran, killed, dir, chatCalls };
}

const FILLED = (key = 'fake-ok', extra = '') => `LLM_BASE_URL=http://127.0.0.1:4555/v1\nLLM_API_KEY=${key}\nLLM_MODEL=fake-model\n${extra}`;
const text = (sim: Sim) => sim.said.join('\n');

describe('Start live demo', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('first run, key empty: opens the settings file in the editor and exits 0 without starting anything', async () => {
    sim = simulate({ settings: 'LLM_BASE_URL=\nLLM_API_KEY=\nLLM_MODEL=\n' });

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(0);
    expect(sim.launched).toEqual([{ command: 'open', args: ['-e', sim.ctx.paths.settingsFile] }]);
    expect(sim.servers).toHaveLength(0);
    expect(sim.chatCalls).toHaveLength(0);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/LLM_API_KEY/);
    expect(text(sim)).toMatch(/Nothing was started/);
    expect(text(sim)).toMatch(/save the file and run "Start live demo" again/);
  });

  it('opens Notepad on Windows', async () => {
    sim = simulate({ platform: 'win32', settings: 'LLM_API_KEY=\n' });

    await runCommand(sim.ctx, 'live');

    expect(sim.launched).toEqual([{ command: 'notepad', args: [sim.ctx.paths.settingsFile] }]);
  });

  it('does not open an editor when HYBRID_NO_EDITOR=1, and names the file instead', async () => {
    sim = simulate({ env: { HYBRID_NO_EDITOR: '1' }, settings: 'LLM_API_KEY=\n' });

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(0);
    expect(sim.launched).toHaveLength(0);
    expect(text(sim)).toContain(sim.ctx.paths.settingsFile);
  });

  it('counts a placeholder or spaces as empty', async () => {
    sim = simulate({ settings: 'LLM_BASE_URL=https://<your-gateway>/v1\nLLM_API_KEY=your-key-here\nLLM_MODEL=   \n' });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);
    expect(sim.servers).toHaveLength(0);
    expect(text(sim)).toMatch(/Still empty: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL/);
  });

  it('writes a settings file when the shipped one is missing, and asks for it to be filled', async () => {
    sim = simulate({ settings: null });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);
    expect(readFileSync(sim.ctx.paths.settingsFile, 'utf8')).toMatch(/LLM_API_KEY=/);
    expect(sim.launched).toHaveLength(1);
  });

  it('filled settings with a wrong key: says so in plain words, exits non-zero, starts nothing', async () => {
    sim = simulate({ settings: FILLED('this-is-not-a-good-key') });

    const code = await runCommand(sim.ctx, 'live');

    expect(code).not.toBe(0);
    expect(text(sim)).toMatch(/did not accept your key/);
    expect(text(sim)).toMatch(/Nothing was started/);
    expect(sim.servers).toHaveLength(0);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(sim.launched).toHaveLength(0);
    expect(text(sim)).not.toContain('this-is-not-a-good-key');
    expect(text(sim)).not.toContain('127.0.0.1:4555');
  });

  it('filled settings with an unknown model: says so and starts nothing', async () => {
    sim = simulate({ settings: FILLED('fake-ok').replace('fake-model', 'fake-fail-model') });

    expect(await runCommand(sim.ctx, 'live')).toBe(1);
    expect(text(sim)).toMatch(/does not know the model name/);
    expect(sim.servers).toHaveLength(0);
  });

  it('good settings: checks the connection, starts the server on loopback with the person\'s settings, opens the browser', async () => {
    sim = simulate({ settings: FILLED('fake-ok', 'LLM_API_KEY_HEADER=\nLLM_MAX_TOKENS=900\n'), baseEnv: { PATH: '/bin', HOSTNAME: '0.0.0.0', LLM_API_KEY: 'from-shell' } });

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(0);
    expect(sim.chatCalls).toHaveLength(1);
    expect(sim.servers).toHaveLength(1);
    const server = sim.servers[0];
    expect(server.file).toBe('/bundled/node');
    expect(server.args).toEqual([sim.ctx.paths.serverEntry]);
    expect(server.options).toMatchObject({ detached: true, windowsHide: true, cwd: sim.ctx.paths.appDir });
    expect(server.env).toMatchObject({
      HOSTNAME: '127.0.0.1',
      HOST: '127.0.0.1',
      PORT: '3200',
      NODE_ENV: 'production',
      DEMO_MODE: 'live',
      CHAT_DB_PATH: sim.ctx.paths.liveDb,
      AGENT_SPECS_DIR: sim.ctx.paths.agentsDir,
      LLM_API_KEY: 'fake-ok',
      LLM_MAX_TOKENS: '900',
    });
    expect(sim.launched).toEqual([{ command: 'open', args: ['http://127.0.0.1:3200/'] }]);
    const record = parseRecord(readFileSync(sim.ctx.paths.pidFile, 'utf8'));
    expect(record).toMatchObject({ mode: 'live', port: 3200, serverPid: server.pid, fakePid: null });
    expect(text(sim)).not.toContain('fake-ok');
  });

  it('does not open a browser when HYBRID_NO_BROWSER=1, but still shows the address', async () => {
    sim = simulate({ env: { HYBRID_NO_BROWSER: '1' }, settings: FILLED() });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);
    expect(sim.launched).toHaveLength(0);
    expect(text(sim)).toContain('http://127.0.0.1:3200/');
  });

  it('uses HYBRID_PORT, and moves on to the next port when it is busy', async () => {
    sim = simulate({ env: { HYBRID_PORT: '4100' }, settings: FILLED(), busyPorts: [4100, 4101] });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);
    expect(sim.servers[0].env.PORT).toBe('4102');
    expect(parseRecord(readFileSync(sim.ctx.paths.pidFile, 'utf8'))?.port).toBe(4102);
  });

  it('a second Start while it runs only opens the browser again', async () => {
    sim = simulate({ settings: FILLED() });
    await runCommand(sim.ctx, 'live');
    sim.launched.length = 0;
    sim.chatCalls.length = 0;
    sim.said.length = 0;

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(0);
    expect(sim.servers).toHaveLength(1);
    expect(sim.chatCalls).toHaveLength(0);
    expect(sim.launched).toEqual([{ command: 'open', args: ['http://127.0.0.1:3200/'] }]);
    expect(text(sim)).toMatch(/already running/);
  });

  it('refuses a live start while the practice demo runs, and says what to do', async () => {
    sim = simulate({ settings: FILLED() });
    await runCommand(sim.ctx, 'practice');
    sim.said.length = 0;

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(1);
    expect(text(sim)).toMatch(/practice demo is running[\s\S]*Stop demo/);
    expect(sim.servers.filter((server) => !server.args[0].endsWith('fake-llm.mjs'))).toHaveLength(1);
  });

  it('cleans up a stale pid file (the server is gone) and starts again', async () => {
    sim = simulate({ settings: FILLED() });
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: 99_999, fakePid: null, fakePort: null, startedAtMs: NOW - 5_000_000, commit: null }));

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.servers).toHaveLength(1);
    expect(parseRecord(readFileSync(sim.ctx.paths.pidFile, 'utf8'))?.serverPid).toBe(sim.servers[0].pid);
  });

  it('leaves a process alone that has the recorded number but is not this app, and starts anew', async () => {
    sim = simulate({ settings: FILLED() });
    sim.alive.add(99_999);
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: 99_999, fakePid: null, fakePort: null, startedAtMs: NOW - 5_000_000, commit: null }));

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.alive.has(99_999)).toBe(true);
    expect(sim.killed).toHaveLength(0);
    expect(sim.servers).toHaveLength(1);
  });

  it('an unreadable pid file is cleared', async () => {
    sim = simulate({ settings: FILLED() });
    writeFileSync(sim.ctx.paths.pidFile, 'garbage');

    expect(await runCommand(sim.ctx, 'live')).toBe(0);
    expect(parseRecord(readFileSync(sim.ctx.paths.pidFile, 'utf8'))).not.toBeNull();
  });

  it('a server that stops while starting: stops what it began, clears the record, shows the log, exits non-zero', async () => {
    sim = simulate({ settings: FILLED() });
    const spawn = sim.ctx.spawn;
    sim.ctx.spawn = (file: string, args: string[], options: Record<string, Loose>) => {
      const child = spawn(file, args, options);
      sim.alive.delete(child.pid);
      queueMicrotask(() => child.emit('exit', 1));
      return child;
    };
    sim.ctx.fetch = async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname.endsWith('/chat/completions')) return createFakeLlm({ delayMs: 0 }).handle(new Request(input, init));
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    writeFileSync(sim.ctx.paths.logFile, 'old log\n');

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(1);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/stopped while it was starting/);
    expect(text(sim)).toMatch(/Nothing is running now/);
  });

  it('hides the key and the address in the log lines it shows after a failed start', async () => {
    sim = simulate({ settings: FILLED('fake-ok') });
    sim.ctx.spawn = () => {
      const child = Object.assign(new EventEmitter(), { pid: 4321, unref() {} });
      fs.appendFileSync(sim.ctx.paths.logFile, 'crashed talking to http://127.0.0.1:4555/v1 with key fake-ok\n');
      queueMicrotask(() => child.emit('exit', 1));
      return child;
    };
    const original = sim.ctx.fetch;
    sim.ctx.fetch = async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname.endsWith('/chat/completions')) return original(input, init);
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };

    expect(await runCommand(sim.ctx, 'live')).toBe(1);

    expect(text(sim)).toContain('[hidden]');
    expect(text(sim)).not.toContain('fake-ok');
    expect(text(sim)).not.toContain('127.0.0.1:4555');
  });

  it('the program files missing: says to download again, exits non-zero', async () => {
    sim = simulate({ settings: FILLED() });
    rmSync(sim.ctx.paths.serverEntry);

    expect(await runCommand(sim.ctx, 'live')).toBe(1);
    expect(text(sim)).toMatch(/Download the ZIP again/);
    expect(sim.servers).toHaveLength(0);
  });
});

describe('the settings file is made private once it holds a key (Mac and Linux)', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));
  const mode = (path: string) => statSync(path).mode & 0o777;

  it('goes to 600 when it holds a key, whether or not the rest is filled in', async () => {
    sim = simulate({ settings: FILLED('fake-ok') });
    chmodSync(sim.ctx.paths.settingsFile, 0o644);

    await runCommand(sim.ctx, 'live');
    expect(mode(sim.ctx.paths.settingsFile)).toBe(0o600);
    expect(text(sim)).toMatch(/now private/);

    chmodSync(sim.ctx.paths.settingsFile, 0o644);
    writeFileSync(sim.ctx.paths.settingsFile, 'LLM_API_KEY=fake-ok\nLLM_MODEL=\n');
    chmodSync(sim.ctx.paths.settingsFile, 0o644);
    sim.ctx.env.HYBRID_NO_EDITOR = '1';
    await runCommand(sim.ctx, 'stop');
    await runCommand(sim.ctx, 'live');
    expect(mode(sim.ctx.paths.settingsFile)).toBe(0o600);
  });

  it('is left alone when it holds no key', async () => {
    sim = simulate({ settings: 'LLM_BASE_URL=\nLLM_API_KEY=your-key-here\nLLM_MODEL=\n', env: { HYBRID_NO_EDITOR: '1' } });
    chmodSync(sim.ctx.paths.settingsFile, 0o644);

    await runCommand(sim.ctx, 'live');

    expect(mode(sim.ctx.paths.settingsFile)).toBe(0o644);
  });

  it('is left alone on Windows, where file modes mean nothing', async () => {
    sim = simulate({ platform: 'win32', settings: FILLED('fake-ok') });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.ctx.fs.chmods).toEqual([]);
    expect(text(sim)).not.toMatch(/now private/);
  });
});

describe('Start practice demo', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('starts the stand-in model first, then the server pointed at it, with no key needed', async () => {
    sim = simulate({ settings: null, baseEnv: { PATH: '/bin', LLM_API_KEY: 'from-shell' } });

    const code = await runCommand(sim.ctx, 'practice');

    expect(code).toBe(0);
    expect(sim.servers).toHaveLength(2);
    const [fake, server] = sim.servers;
    expect(fake.args[0]).toBe(sim.ctx.paths.fakeLlm);
    expect(fake.args).toContain('--port=45555');
    expect(fake.args).toContain('--host=127.0.0.1');
    expect(fake.env.LLM_API_KEY).toBeUndefined();
    expect(server.env).toMatchObject({
      DEMO_MODE: 'practice',
      CHAT_DB_PATH: sim.ctx.paths.practiceDb,
      LLM_BASE_URL: 'http://127.0.0.1:45555/v1',
      HOSTNAME: '127.0.0.1',
      HOST: '127.0.0.1',
    });
    expect(server.env.LLM_API_KEY).toMatch(/^fake/);
    expect(existsSync(sim.ctx.paths.settingsFile)).toBe(false);
    expect(sim.chatCalls).toHaveLength(0);
    expect(text(sim)).toMatch(/stand-in/);
    expect(parseRecord(readFileSync(sim.ctx.paths.pidFile, 'utf8'))).toMatchObject({ mode: 'practice', fakePid: fake.pid, fakePort: 45_555, serverPid: server.pid });
  });

  it('keeps the server off the stand-in model\'s port', async () => {
    sim = simulate({ settings: null, env: { HYBRID_PORT: '45555' } });

    await runCommand(sim.ctx, 'practice');

    expect(sim.servers[1].env.PORT).toBe('45556');
  });

  it('when the server fails to start, the stand-in model is stopped as well', async () => {
    sim = simulate({ settings: null });
    const spawn = sim.ctx.spawn;
    sim.ctx.spawn = (file: string, args: string[], options: Record<string, Loose>) => {
      const child = spawn(file, args, options);
      if (args[0] === sim.ctx.paths.serverEntry) {
        sim.alive.delete(child.pid);
        queueMicrotask(() => child.emit('exit', 1));
      }
      return child;
    };

    expect(await runCommand(sim.ctx, 'practice')).toBe(1);

    expect([...sim.alive]).toEqual([]);
    expect(sim.killed.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
  });
});

describe('Stop demo', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('when nothing runs, says so and exits 0', async () => {
    sim = simulate({ settings: null });

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);
    expect(text(sim)).toMatch(/No demo[\s\S]*running/);
    expect(sim.killed).toHaveLength(0);
  });

  it('stops the server and the stand-in model, and clears the record', async () => {
    sim = simulate({ settings: null });
    await runCommand(sim.ctx, 'practice');
    sim.said.length = 0;

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect([...sim.alive]).toEqual([]);
    expect(sim.killed.every((entry) => entry.endsWith('SIGTERM'))).toBe(true);
    expect(sim.killed).toHaveLength(2);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/Stopped the practice demo/);
    expect(text(sim)).not.toMatch(/Windows/);
  });

  it('Windows: uses taskkill for the server and the stand-in model, and says honestly that it ends at once', async () => {
    sim = simulate({ platform: 'win32', settings: null });
    await runCommand(sim.ctx, 'practice');
    const [fake, server] = sim.servers;
    sim.said.length = 0;

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect(sim.ran).toEqual([`taskkill /PID ${server.pid} /T /F`, `taskkill /PID ${fake.pid} /T /F`]);
    expect(sim.killed).toHaveLength(0);
    expect(text(sim)).toMatch(/Stopped the practice demo/);
    expect(text(sim)).toMatch(/Windows ends it at once/);
  });

  it('a record whose server is gone is cleared, with a plain sentence', async () => {
    sim = simulate({ settings: null });
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: 99_999, fakePid: null, fakePort: null, startedAtMs: NOW - 9_000_000, commit: null }));

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/no longer running/);
  });

  it('leaves a program alone that has the recorded number but is not this app', async () => {
    sim = simulate({ settings: null });
    sim.alive.add(99_999);
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: 99_999, fakePid: null, fakePort: null, startedAtMs: NOW - 9_000_000, commit: null }));

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect(sim.alive.has(99_999)).toBe(true);
    expect(sim.killed).toHaveLength(0);
    expect(text(sim)).toMatch(/left it alone/);
  });

  it('reports a program that will not end, keeps the record and exits non-zero', async () => {
    sim = simulate({ settings: null });
    await runCommand(sim.ctx, 'practice');
    sim.ctx.kill = () => {};
    sim.said.length = 0;

    expect(await runCommand(sim.ctx, 'stop')).toBe(1);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(true);
    expect(text(sim)).toMatch(/could not stop everything/);
  });

  it('an unreadable record is cleared with advice', async () => {
    sim = simulate({ settings: null });
    writeFileSync(sim.ctx.paths.pidFile, '???');

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/restart your computer/);
  });
});

describe('runCommand', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('asks what to do when the command is missing or unknown', async () => {
    sim = simulate({ settings: null });

    expect(await runCommand(sim.ctx, undefined)).toBe(2);
    expect(await runCommand(sim.ctx, 'dance')).toBe(2);
  });

  it('turns a surprise into a short sentence with the key and the address hidden', async () => {
    sim = simulate({ settings: FILLED('fake-ok') });
    sim.ctx.spawn = () => {
      throw new Error('boom: http://127.0.0.1:4555/v1 with fake-ok');
    };
    sim.ctx.ephemeralPort = async () => {
      throw new Error('boom: http://127.0.0.1:4555/v1 with fake-ok');
    };

    const code = await runCommand(sim.ctx, 'live');
    expect(code).toBe(1);
    // spawn errors are handled by startBackground; force the catch-all with a throwing fs call
    sim.ctx.fs = { ...fs, mkdirSync: () => { throw new Error('boom: http://127.0.0.1:4555/v1 with fake-ok'); } };
    sim.ctx.knownLlm = { LLM_API_KEY: 'fake-ok', LLM_BASE_URL: 'http://127.0.0.1:4555/v1' };
    sim.said.length = 0;

    expect(await runCommand(sim.ctx, 'live')).toBe(1);
    expect(text(sim)).toMatch(/Something went wrong/);
    expect(text(sim)).not.toContain('fake-ok');
    expect(text(sim)).not.toContain('127.0.0.1:4555');
  });
});

describe('Start live demo: settings that cannot work, and certificates', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('a key with a space in it is named before any call is made, and never shown', async () => {
    sim = simulate({ settings: FILLED('Bearer fake-ok-with-space') });

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(1);
    expect(text(sim)).toMatch(/LLM_API_KEY has a space/);
    expect(text(sim)).toMatch(/save the file and run "Start live demo" again/);
    expect(text(sim)).toMatch(/Nothing was started/);
    expect(text(sim)).not.toContain('fake-ok-with-space');
    expect(sim.chatCalls).toHaveLength(0);
    expect(sim.servers).toHaveLength(0);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('a key that was pasted inside curly quotes works: the quotes are not part of the key', async () => {
    sim = simulate({ settings: `LLM_BASE_URL=http://127.0.0.1:4555/v1\nLLM_API_KEY=\u201Cfake-ok\u201D\nLLM_MODEL=fake-model\n` });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.servers[0].env.LLM_API_KEY).toBe('fake-ok');
  });

  it('a certificate the computer does not trust is explained, nothing is started, and the host stays hidden', async () => {
    sim = simulate({ settings: FILLED('fake-ok') });
    sim.ctx.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('unable to verify the first certificate for 127.0.0.1:4555'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
    };

    expect(await runCommand(sim.ctx, 'live')).toBe(1);

    expect(text(sim)).toMatch(/did not trust the security certificate/);
    expect(text(sim)).toMatch(/IT team/);
    expect(text(sim)).not.toMatch(/VPN and internet|could not be reached/);
    expect(text(sim)).not.toContain('127.0.0.1:4555');
    expect(sim.servers).toHaveLength(0);
  });

  it('asks the system for its certificates once, before the connection check, and only for the live demo', async () => {
    sim = simulate({ settings: FILLED('fake-ok') });
    const order: number[] = [];
    sim.ctx.trustSystemCertificates = () => void order.push(sim.chatCalls.length);

    await runCommand(sim.ctx, 'live');

    expect(order).toEqual([0]);
    expect(sim.chatCalls).toHaveLength(1);
    expect(sim.servers[0].env.NODE_USE_SYSTEM_CA).toBe('1');

    await runCommand(sim.ctx, 'stop');
    order.length = 0;
    await runCommand(sim.ctx, 'practice');
    expect(order).toEqual([]);
  });
});

describe('one Start at a time (data/demo.lock)', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));
  const holder = (pid: number, at = NOW) => JSON.stringify({ pid, at });

  it('takes a free lock and gives it back', async () => {
    sim = simulate({ settings: null });

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('acquired');
    expect(JSON.parse(readFileSync(sim.ctx.paths.lockFile, 'utf8'))).toEqual({ pid: 4999, at: NOW });

    releaseStartLock(sim.ctx);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('a lock held by a launcher that is still there, and began a moment ago, is held and left as it is', async () => {
    sim = simulate({ settings: null });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, holder(7000, NOW - 1000));

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('held');
    expect(readFileSync(sim.ctx.paths.lockFile, 'utf8')).toBe(holder(7000, NOW - 1000));
  });

  it('takes over a lock whose launcher is gone', async () => {
    sim = simulate({ settings: null });
    writeFileSync(sim.ctx.paths.lockFile, holder(7000, NOW - 1000));

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('acquired');
    expect(JSON.parse(readFileSync(sim.ctx.paths.lockFile, 'utf8')).pid).toBe(4999);
  });

  it('takes over a lock that is older than the limit, even if its number is alive again', async () => {
    sim = simulate({ settings: null });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, holder(7000, NOW - TIMEOUTS.lockStaleMs - 1));

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('acquired');
  });

  it('takes over a lock that is not a note at all', async () => {
    sim = simulate({ settings: null });
    writeFileSync(sim.ctx.paths.lockFile, 'garbage');

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('acquired');
  });

  it('an empty lock is looked at again: its writer may still be writing', async () => {
    sim = simulate({ settings: null });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, '');
    sim.ctx.sleep = async () => writeFileSync(sim.ctx.paths.lockFile, holder(7000));

    expect(await tryAcquireStartLock({ ctx: sim.ctx })).toBe('held');
  });

  it('a Start that waits for another window finds the demo running afterwards, and only opens the browser', async () => {
    sim = simulate({ settings: FILLED() });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, holder(7000));
    let sleeps = 0;
    sim.ctx.sleep = async () => {
      sleeps += 1;
      if (sleeps !== 2) return;
      // the other window finishes: its server is up and recorded, and the lock is gone
      const child = sim.ctx.spawn(sim.ctx.execPath, [sim.ctx.paths.serverEntry], { env: { PORT: '3200', DEMO_MODE: 'live' } });
      writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: child.pid, fakePid: null, fakePort: null, startedAtMs: NOW, commit: null }));
      rmSync(sim.ctx.paths.lockFile);
    };

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(0);
    expect(text(sim)).toMatch(/being started from another window/);
    expect(text(sim)).toMatch(/already running/);
    expect(sim.servers).toHaveLength(1);
    expect(sim.chatCalls).toHaveLength(0);
    expect(sim.launched).toEqual([{ command: 'open', args: ['http://127.0.0.1:3200/'] }]);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('a run is marked as holding the lock for the whole of its start (so Ctrl+C can give it back), and not afterwards', async () => {
    sim = simulate({ settings: FILLED() });
    const seen: unknown[] = [];
    const original = sim.ctx.isPortFree;
    sim.ctx.isPortFree = async (port: number) => (seen.push(sim.ctx.holdsStartLock), original(port));

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(seen).toEqual([true]);
    expect(sim.ctx.holdsStartLock).toBe(false);
  });

  it('gives up with a sentence when the other window never finishes, and leaves that window\'s lock alone', async () => {
    sim = simulate({ settings: FILLED() });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, holder(7000));
    sim.ctx.timeouts = { ...sim.ctx.timeouts, lockWaitMs: 2000 };

    const code = await runCommand(sim.ctx, 'live');

    expect(code).toBe(1);
    expect(text(sim)).toMatch(/still being started from another window/);
    expect(sim.servers).toHaveLength(0);
    expect(readFileSync(sim.ctx.paths.lockFile, 'utf8')).toBe(holder(7000));
  });

  it.each([
    ['a good start', FILLED('fake-ok'), 0],
    ['a start stopped by a wrong key', FILLED('not-a-good-key'), 1],
    ['a first run with empty settings', 'LLM_API_KEY=\n', 0],
  ])('the lock is gone after %s', async (_label, settings, expected) => {
    sim = simulate({ settings, env: { HYBRID_NO_EDITOR: '1' } });

    expect(await runCommand(sim.ctx, 'live')).toBe(expected);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('a lock that cannot be written (a folder with no write access) is an error to report, not another window to wait for', async () => {
    sim = simulate({ settings: null });
    sim.ctx.fs = {
      ...fs,
      writeFileSync: (path: string, data: string, options?: object) => {
        if (String(path).endsWith('demo.lock')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        return fs.writeFileSync(path, data, options);
      },
    };

    expect(await runCommand(sim.ctx, 'practice')).toBe(1);

    expect(text(sim)).toMatch(/cannot save its files in this folder/);
    expect(text(sim)).not.toMatch(/another window/);
    expect(sim.servers).toHaveLength(0);
  });

  it('Stop does not wait for, or take, the lock', async () => {
    sim = simulate({ settings: null });
    sim.alive.add(7000);
    writeFileSync(sim.ctx.paths.lockFile, holder(7000));

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);
    expect(readFileSync(sim.ctx.paths.lockFile, 'utf8')).toBe(holder(7000));
  });
});

describe('when something unexpected happens during a start', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('a wrong HYBRID_PORT is found before the stand-in model starts, so nothing is left running', async () => {
    sim = simulate({ settings: null, env: { HYBRID_PORT: 'abc' } });

    expect(await runCommand(sim.ctx, 'practice')).toBe(1);

    expect(text(sim)).toMatch(/HYBRID_PORT/);
    expect(sim.servers).toHaveLength(0);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('an error after the stand-in model started ends it again, forgets the record and gives the lock back', async () => {
    sim = simulate({ settings: null });
    sim.ctx.isPortFree = async () => {
      throw new Error('the port check broke');
    };

    expect(await runCommand(sim.ctx, 'practice')).toBe(1);

    expect(sim.servers).toHaveLength(1);
    expect([...sim.alive]).toEqual([]);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
    expect(text(sim)).toMatch(/Something went wrong: the port check broke/);
  });

  describe('a program that answers, but is not the demo this run started', () => {
    // The port check said "free", yet something else answers there: it must not be called the demo.
    async function startWithHealth(change: (body: Record<string, unknown>) => Record<string, unknown>) {
      sim = simulate({ settings: FILLED() });
      const original = sim.ctx.fetch;
      sim.ctx.fetch = async (input: string, init?: RequestInit) => {
        const answer = await original(input, init);
        if (new URL(input).pathname !== '/api/health') return answer;
        return Response.json(change((await answer.json()) as Record<string, unknown>));
      };
      return runCommand(sim.ctx, 'live');
    }

    it('with another start time', async () => {
      const code = await startWithHealth((body) => ({ ...body, startedAt: new Date(NOW - 3_600_000).toISOString() }));

      expect(code).toBe(1);
      expect(text(sim)).toMatch(/Another program answers/);
      expect([...sim.alive]).toEqual([]);
      expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    });

    it('in another mode', async () => {
      const code = await startWithHealth((body) => ({ ...body, mode: 'practice' }));

      expect(code).toBe(1);
      expect(text(sim)).toMatch(/reports practice mode instead of live/);
      expect([...sim.alive]).toEqual([]);
      expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    });
  });

  it('an error after the demo is up (the browser, the screen) leaves the running demo alone', async () => {
    sim = simulate({ settings: FILLED() });
    sim.ctx.launch = async () => {
      throw new Error('no browser here');
    };

    expect(await runCommand(sim.ctx, 'live')).toBe(1);

    expect([...sim.alive]).toEqual([sim.servers[0].pid]);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(true);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('Ctrl+C during a start: ends what it began, forgets the record, gives the lock back', async () => {
    sim = simulate({ settings: null });
    await tryAcquireStartLock({ ctx: sim.ctx });
    sim.ctx.holdsStartLock = true;
    const child = sim.ctx.spawn(sim.ctx.execPath, [], { env: {} });
    sim.ctx.started = [child.pid];
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'live', port: 3200, serverPid: child.pid, fakePid: null, fakePort: null, startedAtMs: NOW, commit: null }));

    await interruptCleanup(sim.ctx);

    expect(sim.alive.has(child.pid)).toBe(false);
    expect(existsSync(sim.ctx.paths.pidFile)).toBe(false);
    expect(existsSync(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('Ctrl+C in a run that started nothing leaves a running demo\'s record alone', async () => {
    sim = simulate({ settings: FILLED() });
    await runCommand(sim.ctx, 'live');
    const recorded = readFileSync(sim.ctx.paths.pidFile, 'utf8');

    await interruptCleanup(sim.ctx);

    expect(readFileSync(sim.ctx.paths.pidFile, 'utf8')).toBe(recorded);
    expect(sim.alive.size).toBe(1);
  });

  it('keeps going when the old log cannot be moved (Windows keeps a log open while its program runs)', async () => {
    sim = simulate({ settings: null });
    sim.ctx.fs = {
      ...fs,
      renameSync: () => {
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      },
    };
    writeFileSync(sim.ctx.paths.logFile, 'earlier run\n');

    expect(await runCommand(sim.ctx, 'practice')).toBe(0);

    const log = readFileSync(sim.ctx.paths.logFile, 'utf8');
    expect(log).toContain('earlier run');
    expect(log).toMatch(/\[demo\]/);
  });

  it('keeps the last log as demo.previous.log when it can', async () => {
    sim = simulate({ settings: null });
    writeFileSync(sim.ctx.paths.logFile, 'earlier run\n');

    expect(await runCommand(sim.ctx, 'practice')).toBe(0);

    expect(readFileSync(sim.ctx.paths.previousLogFile, 'utf8')).toBe('earlier run\n');
    expect(readFileSync(sim.ctx.paths.logFile, 'utf8')).not.toContain('earlier run');
  });

  it('a folder the demo cannot write to gets one clear sentence, not an error code', async () => {
    sim = simulate({ settings: null });
    sim.ctx.fs = {
      ...fs,
      mkdirSync: () => {
        throw Object.assign(new Error("EACCES: permission denied, mkdir '/some/private/path'"), { code: 'EACCES' });
      },
    };

    expect(await runCommand(sim.ctx, 'practice')).toBe(1);

    expect(text(sim)).toMatch(/cannot save its files in this folder/);
    expect(text(sim)).not.toMatch(/EACCES|\/some\/private\/path/);
  });

  it('describeFailure: plain words for a read-only folder and a full disk; anything else is shown with the secrets hidden', () => {
    for (const code of ['EACCES', 'EPERM', 'EROFS']) expect(describeFailure(Object.assign(new Error('x'), { code }), [])).toMatch(/Desktop or Documents/);
    expect(describeFailure(Object.assign(new Error('x'), { code: 'ENOSPC' }), [])).toMatch(/disk is full/);
    expect(describeFailure(new Error('failed for secret-value-1234'), ['secret-value-1234'])).toBe('Something went wrong: failed for [hidden]');
    expect(describeFailure('plain text', [])).toBe('Something went wrong: plain text');
  });
});

describe('a record whose server does not answer as the demo, but whose stand-in model is provably ours', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  async function practiceWithSilentServer() {
    sim = simulate({ settings: null });
    await runCommand(sim.ctx, 'practice');
    const [fake, server] = sim.servers;
    // the server stays alive but stops answering as the app; the record is old enough to be doubted
    server.env.PORT = '1';
    writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'practice', port: 3200, serverPid: server.pid, fakePid: fake.pid, fakePort: 45_555, startedAtMs: NOW - 5_000_000, commit: null }));
    sim.said.length = 0;
    return { fake, server };
  }

  it('Stop leaves the unknown program alone but ends the stand-in model, and says both', async () => {
    const { fake, server } = await practiceWithSilentServer();

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect(sim.alive.has(server.pid)).toBe(true);
    expect(sim.alive.has(fake.pid)).toBe(false);
    expect(text(sim)).toMatch(/left it alone/);
    expect(text(sim)).toMatch(/Stopped the stand-in model/);
  });

  it('Start ends that stand-in model too, then starts anew', async () => {
    const { fake, server } = await practiceWithSilentServer();

    expect(await runCommand(sim.ctx, 'practice')).toBe(0);

    expect(sim.alive.has(fake.pid)).toBe(false);
    expect(sim.alive.has(server.pid)).toBe(true);
    expect(sim.servers).toHaveLength(4);
  });
});

describe('the second Start says what it did', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));

  it('does not claim to have opened the browser when it was told not to', async () => {
    sim = simulate({ settings: FILLED(), env: { HYBRID_NO_BROWSER: '1' } });
    await runCommand(sim.ctx, 'live');
    sim.said.length = 0;

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(text(sim)).toMatch(/already running/);
    expect(text(sim)).toContain('http://127.0.0.1:3200/');
    expect(text(sim)).not.toMatch(/browser should open/);
  });

  it('says it could not open the browser when it could not', async () => {
    sim = simulate({ settings: FILLED() });
    sim.ctx.launch = async () => false;

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(text(sim)).toMatch(/could not open your browser/);
  });
});

describe('on Windows: backslash paths and spaces in the parent folder, over a file system in memory', () => {
  let sim: Sim;
  afterEach(() => rmSync(sim.dir, { recursive: true, force: true }));
  const read = (path: string) => sim.ctx.fs.readFileSync(path, 'utf8') as string;

  it('practice: the stand-in model and the server start with Windows paths, hidden and detached', async () => {
    sim = simulate({ platform: 'win32', settings: null, baseEnv: { Path: 'C:\\Windows', hostname: '0.0.0.0', Llm_Api_Key: 'from-shell' } });

    expect(await runCommand(sim.ctx, 'practice')).toBe(0);

    const [fake, server] = sim.servers;
    expect(fake.file).toBe(`${WINDOWS_ROOT}\\runtime\\win32-x64\\node.exe`);
    expect(fake.args[0]).toBe(`${WINDOWS_ROOT}\\launcher\\fake-llm.mjs`);
    expect(fake.options).toMatchObject({ cwd: `${WINDOWS_ROOT}\\data`, detached: true, windowsHide: true });
    expect(server.args).toEqual([`${WINDOWS_ROOT}\\app\\server.js`]);
    expect(server.options).toMatchObject({ cwd: `${WINDOWS_ROOT}\\app`, detached: true, windowsHide: true });
    expect(server.env).toMatchObject({
      HOSTNAME: '127.0.0.1',
      HOST: '127.0.0.1',
      DEMO_MODE: 'practice',
      CHAT_DB_PATH: `${WINDOWS_ROOT}\\data\\demo-practice.db`,
      AGENT_SPECS_DIR: `${WINDOWS_ROOT}\\app\\agents`,
      Path: 'C:\\Windows',
    });
    expect(Object.keys(server.env).filter((name) => /^hostname$/i.test(name))).toEqual(['HOSTNAME']);
    expect(Object.keys(server.env).filter((name) => /^llm_api_key$/i.test(name))).toEqual(['LLM_API_KEY']);
    expect(server.env.LLM_API_KEY).toMatch(/^fake/);
    expect(sim.launched).toEqual([{ command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:3200/'] }]);
    expect(parseRecord(read(sim.ctx.paths.pidFile))).toMatchObject({ mode: 'practice', serverPid: server.pid, fakePid: fake.pid });
    expect(sim.ctx.paths.pidFile).toBe(`${WINDOWS_ROOT}\\data\\demo.pid`);
    expect(read(sim.ctx.paths.logFile)).toMatch(/^\[demo\]/);
    expect(sim.ctx.fs.files.has(sim.ctx.paths.lockFile)).toBe(false);
  });

  it('live: an empty key opens Notepad on the settings file and starts nothing', async () => {
    sim = simulate({ platform: 'win32', settings: 'LLM_BASE_URL=\nLLM_API_KEY=\nLLM_MODEL=\n' });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.launched).toEqual([{ command: 'notepad', args: [`${WINDOWS_ROOT}\\my-settings.env`] }]);
    expect(sim.servers).toHaveLength(0);
    expect(sim.ctx.fs.files.has(sim.ctx.paths.pidFile)).toBe(false);
  });

  it('live: good settings start the server with the person\'s settings, the system certificates, and no mode change', async () => {
    sim = simulate({ platform: 'win32', settings: FILLED('fake-ok') });

    expect(await runCommand(sim.ctx, 'live')).toBe(0);

    expect(sim.servers).toHaveLength(1);
    expect(sim.servers[0].env).toMatchObject({
      DEMO_MODE: 'live',
      LLM_API_KEY: 'fake-ok',
      NODE_USE_SYSTEM_CA: '1',
      CHAT_DB_PATH: `${WINDOWS_ROOT}\\data\\demo.db`,
    });
    expect(text(sim)).not.toContain('fake-ok');
  });

  it('a second Start only opens the browser again', async () => {
    sim = simulate({ platform: 'win32', settings: null });
    await runCommand(sim.ctx, 'practice');
    sim.launched.length = 0;

    expect(await runCommand(sim.ctx, 'practice')).toBe(0);

    expect(sim.servers).toHaveLength(2);
    expect(sim.launched).toEqual([{ command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:3200/'] }]);
  });

  it('a stale pid file is cleaned up', async () => {
    sim = simulate({ platform: 'win32', settings: null });
    sim.ctx.fs.writeFileSync(sim.ctx.paths.pidFile, formatRecord({ mode: 'practice', port: 3200, serverPid: 99_999, fakePid: null, fakePort: null, startedAtMs: NOW - 9_000_000, commit: null }));

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect(sim.ctx.fs.files.has(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/no longer running/);
  });

  it('Stop ends the server and the stand-in model with taskkill and says that Windows ends them at once', async () => {
    sim = simulate({ platform: 'win32', settings: null });
    await runCommand(sim.ctx, 'practice');
    const [fake, server] = sim.servers;

    expect(await runCommand(sim.ctx, 'stop')).toBe(0);

    expect(sim.ran).toEqual([`taskkill /PID ${server.pid} /T /F`, `taskkill /PID ${fake.pid} /T /F`]);
    expect(sim.ctx.fs.files.has(sim.ctx.paths.pidFile)).toBe(false);
    expect(text(sim)).toMatch(/Windows ends it at once/);
  });

  it('a start that fails ends what it began with taskkill and shows the log with the key hidden', async () => {
    sim = simulate({ platform: 'win32', settings: FILLED('fake-ok') });
    sim.ctx.spawn = () => {
      const child = Object.assign(new EventEmitter(), { pid: 4321, unref() {} });
      sim.ctx.fs.appendFileSync(sim.ctx.paths.logFile, 'crashed with key fake-ok\n');
      queueMicrotask(() => child.emit('exit', 1));
      return child;
    };
    const original = sim.ctx.fetch;
    sim.ctx.fetch = async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname.endsWith('/chat/completions')) return original(input, init);
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };

    expect(await runCommand(sim.ctx, 'live')).toBe(1);

    expect(sim.ran).toEqual(['taskkill /PID 4321 /T /F']);
    expect(text(sim)).toContain('crashed with key [hidden]');
    expect(sim.ctx.fs.files.has(sim.ctx.paths.pidFile)).toBe(false);
  });
});

describe('a real port check helper stays honest', () => {
  let held: Server | null = null;
  afterEach(() => held?.close());

  it('findFreePort skips a port that a real program holds', async () => {
    held = createServer();
    await new Promise<void>((done) => held!.listen(0, '127.0.0.1', done));
    const { port } = held.address() as { port: number };
    const isFree = (candidate: number) =>
      new Promise<boolean>((done) => {
        const probe = createServer();
        probe.once('error', () => done(false));
        probe.listen(candidate, '127.0.0.1', () => probe.close(() => done(true)));
      });

    expect(await findFreePort({ start: port, isFree })).toBeGreaterThan(port);
  });
});

describe('isPortFree, the probe the launcher uses, with the real network functions', () => {
  let held: Server | null = null;
  afterEach(() => held?.close());

  /** The real functions, with every address the probe listens on written down. */
  function watchedNet() {
    const listenedOn: Array<string | undefined> = [];
    const connectedTo: Array<string | undefined> = [];
    return {
      listenedOn,
      connectedTo,
      net: {
        createServer: () => {
          const server = createServer();
          const listen = server.listen.bind(server) as (...args: unknown[]) => Server;
          (server as unknown as { listen: (...args: unknown[]) => Server }).listen = (...args: unknown[]) => {
            listenedOn.push(typeof args[1] === 'string' ? args[1] : undefined);
            return listen(...args);
          };
          return server;
        },
        connect: (options: { port: number; host?: string }) => {
          connectedTo.push(options.host);
          return connect(options);
        },
      },
    };
  }

  async function heldPort(): Promise<number> {
    held = createServer();
    await new Promise<void>((done) => held!.listen(0, '127.0.0.1', done));
    return (held.address() as { port: number }).port;
  }

  async function releasedPort(): Promise<number> {
    const port = await heldPort();
    await new Promise<void>((done) => held!.close(() => done()));
    held = null;
    return port;
  }

  it('says a port is free when nothing uses it, and listens only on 127.0.0.1 to find out (no firewall question on any computer)', async () => {
    const port = await releasedPort();
    const watch = watchedNet();

    expect(await isPortFree(port, watch.net)).toBe(true);

    expect(watch.listenedOn.length).toBeGreaterThan(0);
    expect(watch.listenedOn.every((host) => host === '127.0.0.1')).toBe(true);
    expect(watch.connectedTo.every((host) => host === '127.0.0.1')).toBe(true);
  });

  it('says a port is taken when another program accepts connections on it', async () => {
    const port = await heldPort();
    const watch = watchedNet();

    expect(await isPortFree(port, watch.net)).toBe(false);
    expect(watch.listenedOn.every((host) => host === '127.0.0.1')).toBe(true);
  });

  it('says a port is taken when a program answers there, even if listening on 127.0.0.1 would work (a program on every address)', async () => {
    const port = await heldPort();
    // Stands in for a computer where the loopback listen succeeds beside a program that holds every address.
    const listenAlwaysWorks = {
      connect: (options: { port: number; host?: string }) => connect(options),
      createServer: () => {
        const server = createServer();
        (server as unknown as { listen: (...args: unknown[]) => Server }).listen = (...args: unknown[]) => {
          const ready = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
          queueMicrotask(() => ready?.());
          return server;
        };
        (server as unknown as { close: (done?: () => void) => Server }).close = (done?: () => void) => {
          queueMicrotask(() => done?.());
          return server;
        };
        return server;
      },
    };

    expect(await isPortFree(port, listenAlwaysWorks)).toBe(false);
  });

  it('says a port is taken when it cannot listen there, even if nothing answered', async () => {
    const port = await releasedPort();
    const refusesToListen = {
      connect: (options: { port: number; host?: string }) => connect(options),
      createServer: () => {
        const server = createServer();
        (server as unknown as { listen: () => Server }).listen = () => {
          queueMicrotask(() => server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' })));
          return server;
        };
        return server;
      },
    };

    expect(await isPortFree(port, refusesToListen)).toBe(false);
  });
});
