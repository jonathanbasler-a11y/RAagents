import { describe, expect, it, vi } from 'vitest';
import {
  buildEnv,
  buildPlan,
  decideStart,
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
  serverEnv,
  waitForHealth,
} from './demo-lib.mjs';

// The launcher's decisions, with fs, fetch and the clock injected. No server, no socket.

const HOME = '/home/someone';
const APP = '/home/someone/RAagents/outputs/05_demo/app';

/** The LLM_* names the app reads (src/server/llm/config.ts). */
const APP_LLM_NAMES = [
  'LLM_API_KEY',
  'LLM_API_KEY_HEADER',
  'LLM_BASE_URL',
  'LLM_JUDGE_API_KEY',
  'LLM_JUDGE_API_KEY_HEADER',
  'LLM_JUDGE_BASE_URL',
  'LLM_JUDGE_MODEL',
  'LLM_MAX_TOKENS',
  'LLM_MODEL',
];

function onlyFiles(...paths: string[]) {
  const existing = new Set(paths);
  return (path: string) => existing.has(path);
}

describe('parseArgs: the mode and the flags', () => {
  it.each([
    [['live'], {}, { command: 'live', open: true, rebuild: false, port: 3200, distDir: '.next-demo' }],
    [
      ['practice', '--no-open'],
      { DEMO_PORT: '4321', NEXT_DIST_DIR: '.next-demo-check' },
      { command: 'practice', open: false, rebuild: false, port: 4321, distDir: '.next-demo-check' },
    ],
    [
      ['live', '--rebuild', '--no-open'],
      { DEMO_PORT: '', NEXT_DIST_DIR: '' },
      { command: 'live', open: false, rebuild: true, port: 3200, distDir: '.next-demo' },
    ],
    [['stop'], { DEMO_PORT: '3201' }, { command: 'stop', open: true, rebuild: false, port: 3201, distDir: '.next-demo' }],
  ])('%j with %j', (argv, env, expected) => {
    expect(parseArgs(argv, env)).toEqual(expected);
  });

  it.each(['../build', '.next/../x', 'dist'])('refuses NEXT_DIST_DIR=%s, which next.config.ts would refuse too', (distDir) => {
    expect(() => parseArgs(['live'], { NEXT_DIST_DIR: distDir })).toThrow(/NEXT_DIST_DIR must be "\.next" or "\.next-<label>"/);
  });

  it.each([
    [[], /live, practice or stop/],
    [['demo'], /live, practice or stop/],
    [['live', '--open-later'], /unknown option "--open-later"/],
    [['stop', '--rebuild'], /unknown option "--rebuild"/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseArgs(argv, {})).toThrow(message);
  });

  it.each(['abc', '0', '70000', '3200.5', '-1'])('refuses DEMO_PORT=%s', (port) => {
    expect(() => parseArgs(['live'], { DEMO_PORT: port })).toThrow(/DEMO_PORT must be a port number from 1 to 65535/);
  });
});

describe('findEnvFile: where live mode finds the model settings (never opened, only located)', () => {
  const ENV_FILE = '/home/someone/vault/llm.env';
  const SHARED = '/home/someone/.config/raagents/llm.env';
  const LOCAL = `${APP}/.env.local`;

  function find(env: Record<string, string | undefined>, isFile: (path: string) => boolean) {
    return findEnvFile({ env, homeDir: HOME, cwd: APP, appDir: APP, isFile });
  }

  it('takes $RAAGENTS_ENV_FILE first when that file exists', () => {
    const result = find({ RAAGENTS_ENV_FILE: ENV_FILE }, onlyFiles(ENV_FILE, SHARED, LOCAL));

    expect(result.file).toEqual({ path: ENV_FILE, label: '$RAAGENTS_ENV_FILE' });
    expect(result.warnings).toEqual([]);
  });

  it('then ~/.config/raagents/llm.env, before the app’s own .env.local', () => {
    expect(find({}, onlyFiles(SHARED, LOCAL)).file).toEqual({ path: SHARED, label: '~/.config/raagents/llm.env' });
  });

  it('then the app’s own .env.local', () => {
    expect(find({}, onlyFiles(LOCAL)).file).toEqual({ path: LOCAL, label: '.env.local' });
  });

  it('finds nothing when none exists, and lists what it tried, in order', () => {
    const result = find({ RAAGENTS_ENV_FILE: ENV_FILE }, onlyFiles());

    expect(result.file).toBeNull();
    expect(result.tried).toEqual(['$RAAGENTS_ENV_FILE (~/vault/llm.env)', '~/.config/raagents/llm.env', '.env.local']);
  });

  it('says so when $RAAGENTS_ENV_FILE names a file that does not exist, and looks further', () => {
    const result = find({ RAAGENTS_ENV_FILE: ENV_FILE }, onlyFiles(LOCAL));

    expect(result.file).toEqual({ path: LOCAL, label: '.env.local' });
    expect(result.warnings).toEqual(['RAAGENTS_ENV_FILE is set, but there is no file at ~/vault/llm.env.']);
  });

  it('expands a leading ~/ and resolves a relative path from the current folder', () => {
    expect(find({ RAAGENTS_ENV_FILE: '~/vault/llm.env' }, onlyFiles(ENV_FILE)).file?.path).toBe(ENV_FILE);
    expect(find({ RAAGENTS_ENV_FILE: 'conf/llm.env' }, onlyFiles(`${APP}/conf/llm.env`)).file?.path).toBe(`${APP}/conf/llm.env`);
  });

  it('ignores an empty $RAAGENTS_ENV_FILE', () => {
    const result = find({ RAAGENTS_ENV_FILE: '  ' }, onlyFiles(SHARED));

    expect(result.file?.path).toBe(SHARED);
    expect(result.warnings).toEqual([]);
  });
});

describe('envFilePermissionProblem: from the file’s mode bits only', () => {
  it.each([
    ['644', 0o100644],
    ['640', 0o100640],
    ['604', 0o100604],
  ])('says how to fix a settings file that others can read (mode %s)', (_label, mode) => {
    expect(envFilePermissionProblem(mode, '~/.config/raagents/llm.env')).toMatch(
      /can be read by other users[\s\S]*chmod 600 ~\/\.config\/raagents\/llm\.env/,
    );
  });

  it.each([
    ['600', 0o100600],
    ['400', 0o100400],
  ])('accepts a private file (mode %s)', (_label, mode) => {
    expect(envFilePermissionProblem(mode, '.env.local')).toBeNull();
  });
});

describe('serverEnv: the environment next start runs with', () => {
  const INHERITED = {
    PATH: '/usr/bin:/bin',
    HOME,
    LLM_API_KEY: 'sk-from-the-shell',
    LLM_BASE_URL: 'https://gateway.example.test/v1',
    LLM_EXTRA_SETTING: 'x',
    DEMO_MODE: 'practice',
  };

  it('live: no inherited LLM_* name survives (the settings file is the only source), DEMO_MODE=live, the demo database', () => {
    const env = serverEnv({ mode: 'live', baseEnv: INHERITED, appDir: APP });

    expect(Object.keys(env).filter((name) => name.startsWith('LLM_'))).toEqual([]);
    expect(env).toMatchObject({
      DEMO_MODE: 'live',
      CHAT_DB_PATH: `${APP}/.data/demo.db`,
      NEXT_DIST_DIR: '.next-demo',
      PATH: '/usr/bin:/bin',
      HOME,
    });
  });

  it('practice: every LLM_* name the app reads points at the stand-in model, with fake keys, DEMO_MODE=practice', () => {
    const fake = 'http://127.0.0.1:45678/v1';
    const env = serverEnv({ mode: 'practice', baseEnv: INHERITED, appDir: APP, fakeBaseUrl: fake });

    expect(Object.keys(env).filter((name) => name.startsWith('LLM_')).sort()).toEqual(APP_LLM_NAMES);
    expect(env).toMatchObject({
      DEMO_MODE: 'practice',
      CHAT_DB_PATH: `${APP}/.data/demo-practice.db`,
      NEXT_DIST_DIR: '.next-demo',
      LLM_BASE_URL: fake,
      LLM_JUDGE_BASE_URL: fake,
    });
    for (const name of ['LLM_API_KEY', 'LLM_JUDGE_API_KEY', 'LLM_MODEL', 'LLM_JUDGE_MODEL']) expect(env[name]).toMatch(/^fake/);
    expect(JSON.stringify(env)).not.toContain('sk-from-the-shell');
  });

  it('builds and serves from the build folder it is given', () => {
    expect(serverEnv({ mode: 'live', baseEnv: { NEXT_DIST_DIR: '.next-other' }, appDir: APP, distDir: '.next-demo-check' })).toMatchObject({
      NEXT_DIST_DIR: '.next-demo-check',
    });
  });

  it('practice without the stand-in model’s address is a bug, not a silent live run', () => {
    expect(() => serverEnv({ mode: 'practice', baseEnv: {}, appDir: APP })).toThrow(/stand-in model/);
  });
});

describe('buildEnv: the environment next build runs with', () => {
  it('blanks every LLM_* name the app reads, so Next.js does not fill them in from .env.local (the build needs none)', () => {
    const env = buildEnv({ baseEnv: { PATH: '/usr/bin', LLM_API_KEY: 'sk-from-the-shell', LLM_OTHER: 'x' }, appDir: APP, distDir: '.next-demo-check' });

    expect(Object.keys(env).filter((name) => name.startsWith('LLM_')).sort()).toEqual(APP_LLM_NAMES);
    for (const name of APP_LLM_NAMES) expect(env[name]).toBe('');
    expect(env).toMatchObject({ NEXT_DIST_DIR: '.next-demo-check', PATH: '/usr/bin' });
  });
});

describe('fakeLlmArgs: how practice mode starts the stand-in model', () => {
  it('listens on loopback, on the given port, and has Dara reply NO_ADDITION so step 5 shows the line', () => {
    expect(fakeLlmArgs({ port: 45678, env: {} })).toEqual(['--port=45678', '--host=127.0.0.1', '--no-addition=Dara']);
  });

  it('takes FAKE_LLM_NO_ADDITION when set, even empty', () => {
    expect(fakeLlmArgs({ port: 1, env: { FAKE_LLM_NO_ADDITION: 'Lena,Carlos' } })).toContain('--no-addition=Lena,Carlos');
    expect(fakeLlmArgs({ port: 1, env: { FAKE_LLM_NO_ADDITION: '' } })).toContain('--no-addition=');
  });
});

describe('probeDemo: what answers on the port', () => {
  const report = (extra: Record<string, unknown> = {}) => ({
    status: 'ok',
    checks: { database: 'ok', agents: 'ok', llm: 'ok' },
    agentCount: 25,
    llm: { configured: true, missing: [], message: null },
    startedAt: '2026-10-08T09:00:00.000Z',
    ...extra,
  });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const refused = () =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3200'), { code: 'ECONNREFUSED' }),
    });

  it('asks this app’s health route on loopback', async () => {
    const fetch = vi.fn(async () => json(report()));

    await probeDemo({ fetch, port: 3210 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('http://127.0.0.1:3210/api/health');
  });

  it('free: nothing listens (connection refused)', async () => {
    await expect(probeDemo({ fetch: async () => Promise.reject(refused()), port: 3200 })).resolves.toEqual({ state: 'free' });
  });

  it('free: connection refused on every address (AggregateError)', async () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: new AggregateError([Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })], 'all failed'),
    });

    await expect(probeDemo({ fetch: async () => Promise.reject(error), port: 3200 })).resolves.toEqual({ state: 'free' });
  });

  it('demo: this app, in practice mode', async () => {
    const probe = await probeDemo({ fetch: async () => json(report({ mode: 'practice' })), port: 3200 });

    expect(probe).toMatchObject({ state: 'demo', mode: 'practice', startedAt: '2026-10-08T09:00:00.000Z' });
  });

  it('demo: an older build of this app that does not report a mode is live', async () => {
    expect(await probeDemo({ fetch: async () => json(report()), port: 3200 })).toMatchObject({ state: 'demo', mode: 'live' });
  });

  it('demo: a report that says error (a broken database) is still this app', async () => {
    const probe = await probeDemo({ fetch: async () => json(report({ status: 'error', mode: 'live' })), port: 3200 });

    expect(probe).toMatchObject({ state: 'demo', mode: 'live' });
  });

  it.each([
    ['a web page', () => new Response('<html>Another app</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['a 404 from another API', () => json({ error: 'not found' }, 404)],
    ['JSON that is not this app’s report', () => json({ status: 'ok' })],
  ])('other: %s', async (_name, response) => {
    expect(await probeDemo({ fetch: async () => response(), port: 3200 })).toMatchObject({ state: 'other' });
  });

  it('other: something holds the port but does not answer in time', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');

    const probe = await probeDemo({ fetch: async () => Promise.reject(timeout), port: 3200 });

    expect(probe).toEqual({ state: 'other', detail: expect.stringMatching(/did not answer/) });
  });
});

describe('decideStart: start, just open the pages, or refuse', () => {
  const demo = (mode: 'live' | 'practice') => ({ state: 'demo' as const, mode, startedAt: '2026-10-08T09:00:00.000Z' });

  it('opens the pages when a demo in the asked mode already runs on the port', () => {
    expect(decideStart({ requested: 'live', port: 3200, probe: demo('live'), recorded: null })).toMatchObject({ action: 'open' });
  });

  it('notes when that demo was not started from this folder', () => {
    const decision = decideStart({ requested: 'live', port: 3200, probe: demo('live'), recorded: null });
    const ours = decideStart({ requested: 'live', port: 3200, probe: demo('live'), recorded: { port: 3200, mode: 'live', alive: true } });

    expect(decision).toMatchObject({ action: 'open', note: expect.stringMatching(/not started from this folder/) });
    expect(ours).toEqual({ action: 'open', note: null });
  });

  it('refuses when the demo on the port runs in the other mode', () => {
    const decision = decideStart({ requested: 'practice', port: 3200, probe: demo('live'), recorded: null });

    expect(decision).toMatchObject({ action: 'refuse', message: expect.stringMatching(/live demo is already running on port 3200[\s\S]*demo:stop/) });
  });

  it('refuses when another program holds the port', () => {
    const decision = decideStart({ requested: 'live', port: 3200, probe: { state: 'other', detail: 'HTTP 404' }, recorded: null });

    expect(decision).toMatchObject({ action: 'refuse', message: expect.stringMatching(/Port 3200 is in use by another program[\s\S]*DEMO_PORT/) });
  });

  it('refuses while this folder’s demo still runs on another port', () => {
    const decision = decideStart({ requested: 'live', port: 3200, probe: { state: 'free' }, recorded: { port: 3201, mode: 'practice', alive: true } });

    expect(decision).toMatchObject({ action: 'refuse', message: expect.stringMatching(/still running on port 3201[\s\S]*demo:stop/) });
  });

  it('refuses while this folder’s server is alive but not answering yet', () => {
    const decision = decideStart({ requested: 'live', port: 3200, probe: { state: 'free' }, recorded: { port: 3200, mode: 'live', alive: true } });

    expect(decision).toMatchObject({ action: 'refuse', message: expect.stringMatching(/starting or not answering/) });
  });

  it('starts when the port is free and nothing of this folder is alive', () => {
    expect(decideStart({ requested: 'practice', port: 3200, probe: { state: 'free' }, recorded: null })).toEqual({ action: 'start' });
    expect(
      decideStart({ requested: 'practice', port: 3200, probe: { state: 'free' }, recorded: { port: 3200, mode: 'live', alive: false } }),
    ).toEqual({ action: 'start' });
  });
});

describe('buildPlan: build once per commit', () => {
  const COMMIT = '67ed45d3b1638addc5a0b9a5c12da9a1aa7f9442';
  const OLDER = '8694f64aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it.each([
    [{ hasBuild: false, builtCommit: null, commit: COMMIT, rebuild: false }, true, /no demo build yet/],
    [{ hasBuild: true, builtCommit: OLDER, commit: COMMIT, rebuild: false }, true, /made for commit 8694f64; this folder is at 67ed45d/],
    [{ hasBuild: true, builtCommit: null, commit: COMMIT, rebuild: false }, true, /made for commit unknown/],
    [{ hasBuild: true, builtCommit: COMMIT, commit: COMMIT, rebuild: true }, true, /--rebuild/],
    [{ hasBuild: true, builtCommit: COMMIT, commit: COMMIT, rebuild: false }, false, /matches commit 67ed45d/],
    [{ hasBuild: true, builtCommit: null, commit: null, rebuild: false }, false, /not a git checkout/],
    [{ hasBuild: false, builtCommit: null, commit: null, rebuild: false }, true, /no demo build yet/],
  ])('%j → build %s', (input, build, reason) => {
    const plan = buildPlan(input);

    expect(plan.build).toBe(build);
    expect(plan.reason).toMatch(reason);
  });
});

describe('the pid file and the pid-reuse guard', () => {
  const RECORD = { mode: 'practice' as const, port: 3200, serverPid: 4242, fakePid: 4241, startedAtMs: 1_790_000_000_000, commit: 'abc1234' };

  it('round-trips what demo:stop needs', () => {
    expect(parsePidFile(formatPidFile(RECORD))).toEqual(RECORD);
    expect(parsePidFile(formatPidFile({ ...RECORD, mode: 'live', fakePid: null, commit: null }))).toEqual({
      ...RECORD,
      mode: 'live',
      fakePid: null,
      commit: null,
    });
  });

  it.each(['', 'not json', '{"mode":"live"}', JSON.stringify({ ...RECORD, serverPid: -1 }), JSON.stringify({ ...RECORD, mode: 'dev' })])(
    'rejects %j',
    (text) => {
      expect(parsePidFile(text)).toBeNull();
    },
  );

  it.each([
    ['   00:05', 5],
    ['01:02:03', 3723],
    ['2-03:04:05', 183_845],
    ['', null],
    ['soon', null],
  ])('reads the elapsed time %j as %s seconds', (text, seconds) => {
    expect(parseElapsed(text)).toBe(seconds);
  });

  it('accepts a process that started when the record says, and refuses a reused pid', () => {
    const recordedStartMs = 1_790_000_000_000;
    const nowMs = recordedStartMs + 3_600_000;

    expect(isSameProcess({ elapsedSeconds: 3_598, recordedStartMs, nowMs })).toBe(true);
    expect(isSameProcess({ elapsedSeconds: 60, recordedStartMs, nowMs })).toBe(false);
    expect(isSameProcess({ elapsedSeconds: 90_000, recordedStartMs, nowMs })).toBe(false);
  });
});

describe('nodeVersionProblem', () => {
  it.each([['24.11.0'], ['25.0.0']])('accepts Node %s', (version) => {
    expect(nodeVersionProblem(version)).toBeNull();
  });

  it('refuses Node 20 and says how to get Node 24 first on the PATH', () => {
    expect(nodeVersionProblem('20.20.2')).toMatch(/needs Node 24[\s\S]*Node 20\.20\.2[\s\S]*node@24/);
  });
});

describe('waitForHealth: until the app answers, the process dies, or the time is up', () => {
  function clock() {
    let now = 0;
    return { now: () => now, sleep: async (ms: number) => void (now += ms) };
  }
  const ready = { state: 'demo' as const, mode: 'practice' as const, startedAt: 'x' };

  it('returns the report once the app answers', async () => {
    const answers = [{ state: 'free' as const }, { state: 'other' as const, detail: 'starting' }, ready];
    const probe = vi.fn(async () => answers.shift() ?? ready);

    const result = await waitForHealth({ probe, isAlive: () => true, timeoutMs: 60_000, intervalMs: 500, ...clock() });

    expect(result).toEqual({ ok: true, probe: ready });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('stops at once when the server process exits', async () => {
    const probe = vi.fn(async () => ({ state: 'free' as const }));
    let alive = 2;

    const result = await waitForHealth({ probe, isAlive: () => alive-- > 0, timeoutMs: 60_000, intervalMs: 500, ...clock() });

    expect(result).toEqual({ ok: false, reason: 'exited' });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('gives up after the timeout', async () => {
    const time = clock();
    const probe = vi.fn(async () => ({ state: 'free' as const }));

    const result = await waitForHealth({ probe, isAlive: () => true, timeoutMs: 5_000, intervalMs: 500, ...time });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(time.now()).toBeGreaterThanOrEqual(5_000);
    expect(time.now()).toBeLessThan(6_000);
  });
});
