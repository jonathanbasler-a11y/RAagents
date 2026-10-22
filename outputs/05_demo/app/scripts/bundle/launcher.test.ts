import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { connect, createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

// Parsed JSON from the fake server: its shape is checked by the assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// The real launcher (launcher.mjs) in a child process, against a tiny fake server in place of
// app/server.js (HYBRID_SERVER_ENTRY) and the repository's fake gateway (scripts/fake-llm.mjs).
// It proves what the unit tests cannot: that the server really detaches, answers its health route,
// listens on loopback only, and really stops. The timing is generous: the machine can be busy.

const LAUNCHER = fileURLToPath(new URL('./launcher.mjs', import.meta.url));
const FAKE_LLM = fileURLToPath(new URL('../fake-llm.mjs', import.meta.url));
const SLOW = 120_000;
const HYBRID_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');

const FAKE_SERVER = `
import http from 'node:http';
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/api/health') {
    response.end(JSON.stringify({ status: 'ok', checks: {}, agentCount: 1, llm: { configured: true }, startedAt, mode: process.env.DEMO_MODE }));
  } else if (request.url === '/env') {
    const { HOSTNAME, HOST, PORT, NODE_ENV, DEMO_MODE, CHAT_DB_PATH, AGENT_SPECS_DIR, LLM_BASE_URL } = process.env;
    response.end(JSON.stringify({ HOSTNAME, HOST, PORT, NODE_ENV, DEMO_MODE, CHAT_DB_PATH, AGENT_SPECS_DIR, LLM_BASE_URL, hasKey: Boolean(process.env.LLM_API_KEY), key: process.env.LLM_API_KEY, cwd: process.cwd() }));
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
`;

const CRASHING_SERVER = `console.log('this is the crashing test server speaking'); process.exit(1);`;

// A server that starts but never answers /api/health, so a start stays "under way".
const HANGING_SERVER = `setInterval(() => {}, 1000);`;

// The same fake as FAKE_SERVER, as CommonJS: the real app/server.js is a plain .js file.
const FAKE_SERVER_CJS = FAKE_SERVER.replace("import http from 'node:http';", "const http = require('node:http');");

interface World {
  base: string;
  data: string;
  settings: string;
  entry: string;
  env: Record<string, string>;
}

const worlds: World[] = [];
const gateways: ChildProcess[] = [];
const holders: Array<{ close: () => void }> = [];

function newWorld(options: { crashing?: boolean; hanging?: boolean } = {}): World {
  // Spaces in the parent folder and in the server's folder: the way OneDrive and "My Documents" look.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'launcher it ')));
  const serverDir = join(base, 'my server');
  mkdirSync(serverDir, { recursive: true });
  const entry = join(serverDir, 'server.mjs');
  writeFileSync(entry, options.crashing ? CRASHING_SERVER : options.hanging ? HANGING_SERVER : FAKE_SERVER);
  const data = join(base, 'my data');
  const settings = join(base, 'my-settings.env');
  const env = {
    HYBRID_NO_BROWSER: '1',
    HYBRID_NO_EDITOR: '1',
    HYBRID_DATA_DIR: data,
    HYBRID_SERVER_ENTRY: entry,
    RAAGENTS_ENV_FILE: settings,
  };
  const world = { base, data, settings, entry, env };
  worlds.push(world);
  return world;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

type Finished = { code: number | null; out: string };

/** Starts `node <launcher> <mode>`; `done` resolves when the launcher itself has finished. */
function begin(launcher: string, mode: string, env: Record<string, string>): { child: ChildProcess; done: Promise<Finished> } {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(LLM_|HYBRID_|RAAGENTS_)/.test(name)) clean[name] = value;
  }
  const child = spawn(process.execPath, [launcher, mode], { env: { ...clean, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise<Finished>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (chunk) => (out += chunk));
    child.stderr!.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
  return { child, done };
}

/** Runs `node launcher.mjs <mode>` and waits for the launcher itself to finish. */
function run(mode: string, world: World, extra: Record<string, string> = {}): Promise<Finished> {
  return begin(LAUNCHER, mode, { ...world.env, ...extra }).done;
}

/** Polls until `check` holds; fails with `what` after `limitMs`. */
async function waitUntil(what: string, check: () => boolean, limitMs = 30_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > limitMs) throw new Error(`gave up waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

function getJson(port: number, path: string): Promise<Record<string, Loose>> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path }, (reply) => {
      let body = '';
      reply.on('data', (chunk) => (body += chunk));
      reply.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

/** True when something accepts a connection on the port. */
function listening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(2000);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

function record(world: World) {
  return JSON.parse(readFileSync(join(world.data, 'demo.pid'), 'utf8')) as { mode: string; port: number; serverPid: number; fakePid: number | null; fakePort: number | null };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startGateway(): Promise<string> {
  const child = spawn(process.execPath, [FAKE_LLM, '--port=0', '--host=127.0.0.1'], { stdio: ['ignore', 'pipe', 'inherit'] });
  gateways.push(child);
  return new Promise((resolve, reject) => {
    let seen = '';
    child.stdout!.on('data', (chunk) => {
      seen += chunk;
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+\/v1)/.exec(seen);
      if (match) resolve(match[1]);
    });
    child.on('error', reject);
    child.on('exit', () => reject(new Error('the fake gateway exited')));
  });
}

let gatewayUrl = '';
beforeAll(async () => {
  gatewayUrl = await startGateway();
}, SLOW);

afterEach(async () => {
  for (const holder of holders.splice(0)) holder.close();
  // Whatever a test left running is stopped by the launcher itself, as a person would.
  for (const world of worlds.splice(0)) {
    if (existsSync(world.data)) await run('stop', world);
    rmSync(world.base, { recursive: true, force: true });
  }
}, SLOW);

afterAll(() => {
  for (const gateway of gateways) gateway.kill();
});

const filled = (key: string, model = 'fake-model') => `# my settings\nLLM_BASE_URL=${gatewayUrl}\nLLM_API_KEY=${key}\nLLM_MODEL=${model}\n`;

describe('practice demo: start, start again, stop', () => {
  it(
    'starts detached on loopback, a second start only reopens, and stop ends everything',
    async () => {
      const world = newWorld();

      const first = await run('practice', world, { HOSTNAME: '0.0.0.0', HOST: '0.0.0.0', LLM_API_KEY: 'from-the-shell' });

      expect(first.code, first.out).toBe(0);
      const started = record(world);
      expect(started).toMatchObject({ mode: 'practice' });
      expect(started.port).toBeGreaterThanOrEqual(3200);
      expect(alive(started.serverPid)).toBe(true);
      expect(started.fakePid && alive(started.fakePid)).toBe(true);
      expect(first.out).toMatch(/stand-in/);
      expect(first.out).toContain(`http://127.0.0.1:${started.port}/`);

      const env = await getJson(started.port, '/env');
      expect(env).toMatchObject({ HOSTNAME: '127.0.0.1', HOST: '127.0.0.1', NODE_ENV: 'production', DEMO_MODE: 'practice', PORT: String(started.port) });
      expect(env.CHAT_DB_PATH).toBe(join(world.data, 'demo-practice.db'));
      // The folder the launcher sits in (two levels above launcher/bundle/) is the HybridDemo folder.
      expect(env.AGENT_SPECS_DIR).toBe(join(HYBRID_ROOT, 'app', 'agents'));
      expect(env.LLM_BASE_URL).toBe(`http://127.0.0.1:${started.fakePort}/v1`);
      expect(env.key).toMatch(/^fake/);
      expect(env.cwd).toBe(join(world.base, 'my server'));
      expect(readFileSync(join(world.data, 'demo.log'), 'utf8')).toContain('[demo]');

      // The server is loopback-only: no other address of this computer reaches it.
      const outward = Object.values(networkInterfaces())
        .flat()
        .find((address) => address && address.family === 'IPv4' && !address.internal);
      if (outward) expect(await listening(started.port, outward.address)).toBe(false);

      const second = await run('practice', world);
      expect(second.code, second.out).toBe(0);
      expect(second.out).toMatch(/already running/);
      expect(record(world).serverPid).toBe(started.serverPid);

      const stopped = await run('stop', world);
      expect(stopped.code, stopped.out).toBe(0);
      expect(stopped.out).toMatch(/Stopped the practice demo/);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
      expect(await listening(started.port)).toBe(false);
      expect(alive(started.serverPid)).toBe(false);
      expect(alive(started.fakePid!)).toBe(false);

      const again = await run('stop', world);
      expect(again.code).toBe(0);
      expect(again.out).toMatch(/No demo[\s\S]*running/);
    },
    SLOW,
  );

  it(
    'moves to the next port when the first is busy',
    async () => {
      const world = newWorld();
      const busy = await freePort();
      const holder = createServer();
      await new Promise<void>((done) => holder.listen(busy, '127.0.0.1', done));
      holders.push(holder);

      const result = await run('practice', world, { HYBRID_PORT: String(busy) });

      expect(result.code, result.out).toBe(0);
      expect(record(world).port).toBeGreaterThan(busy);
      expect((await getJson(record(world).port, '/api/health')).mode).toBe('practice');
    },
    SLOW,
  );
});

describe('a port held by a program that listens on every address', () => {
  it(
    'is skipped too: another program there could answer for 127.0.0.1 as well',
    async () => {
      const world = newWorld();
      const busy = await freePort();
      const holder = createServer();
      await new Promise<void>((done) => holder.listen(busy, done));
      holders.push(holder);

      const result = await run('practice', world, { HYBRID_PORT: String(busy) });

      expect(result.code, result.out).toBe(0);
      expect(record(world).port).toBeGreaterThan(busy);
    },
    SLOW,
  );
});

describe('live demo', () => {
  it(
    'first run with an empty key: nothing starts, the person is told what to fill in, exit 0',
    async () => {
      const world = newWorld();
      writeFileSync(world.settings, 'LLM_BASE_URL=\nLLM_API_KEY=\nLLM_MODEL=\n');

      const result = await run('live', world);

      expect(result.code, result.out).toBe(0);
      expect(result.out).toMatch(/Still empty: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL/);
      expect(result.out).toMatch(/Nothing was started/);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );

  it(
    'a wrong key: the plain sentence, non-zero exit, nothing started, no key or address on screen',
    async () => {
      const world = newWorld();
      writeFileSync(world.settings, filled('not-the-right-key-5678'));

      const result = await run('live', world);

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/did not accept your key/);
      expect(result.out).not.toContain('not-the-right-key-5678');
      expect(result.out).not.toContain(gatewayUrl);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );

  it(
    'an unknown model is named as such',
    async () => {
      const world = newWorld();
      writeFileSync(world.settings, filled('fake-ok-key', 'fake-fail-model'));

      const result = await run('live', world);

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/does not know the model name/);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );

  it(
    'an unreachable service (no VPN) is named as such',
    async () => {
      const world = newWorld();
      const closed = await freePort();
      writeFileSync(world.settings, `LLM_BASE_URL=http://127.0.0.1:${closed}/v1\nLLM_API_KEY=fake-ok-key\nLLM_MODEL=fake-model\n`);

      const result = await run('live', world);

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/could not be reached[\s\S]*VPN/);
      expect(result.out).not.toContain(`127.0.0.1:${closed}`);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );

  it(
    'good settings: starts with the person\'s own values, not the shell\'s, and makes the file private',
    async () => {
      const world = newWorld();
      writeFileSync(world.settings, filled('fake-ok-key'));
      chmodSync(world.settings, 0o644);

      const result = await run('live', world, { LLM_API_KEY: 'from-the-shell', LLM_MODEL: 'shell-model' });

      expect(result.code, result.out).toBe(0);
      expect(result.out).toMatch(/connection works/);
      expect(result.out).not.toContain('fake-ok-key');
      const started = record(world);
      expect(started).toMatchObject({ mode: 'live', fakePid: null });
      const env = await getJson(started.port, '/env');
      expect(env).toMatchObject({ DEMO_MODE: 'live', HOSTNAME: '127.0.0.1', LLM_BASE_URL: gatewayUrl, key: 'fake-ok-key' });
      expect(env.CHAT_DB_PATH).toBe(join(world.data, 'demo.db'));
      if (process.platform !== 'win32') expect(statSync(world.settings).mode & 0o777).toBe(0o600);

      const again = await run('live', world);
      expect(again.code, again.out).toBe(0);
      expect(again.out).toMatch(/already running/);
    },
    SLOW,
  );

  it(
    'a server that crashes at once: non-zero exit, nothing left behind, the log is shown',
    async () => {
      const world = newWorld({ crashing: true });
      writeFileSync(world.settings, filled('fake-ok-key'));

      const result = await run('live', world);

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/stopped while it was starting/);
      expect(result.out).toContain('this is the crashing test server speaking');
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );
});

describe('stop', () => {
  it(
    'clears the note about a server that is gone, and says so',
    async () => {
      const world = newWorld();
      mkdirSync(world.data, { recursive: true });
      const gone = spawn(process.execPath, ['-e', '0']);
      await new Promise((done) => gone.on('close', done));
      writeFileSync(
        join(world.data, 'demo.pid'),
        JSON.stringify({ mode: 'live', port: await freePort(), serverPid: gone.pid, fakePid: null, fakePort: null, startedAtMs: Date.now() - 5_000_000, commit: null }),
      );

      const result = await run('stop', world);

      expect(result.code, result.out).toBe(0);
      expect(result.out).toMatch(/no longer running/);
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
    },
    SLOW,
  );

  it(
    'leaves alone a program that only has the recorded number',
    async () => {
      // The recorded process is alive and answers on the recorded port, but not as the demo: unconfirmed, at any
      // record age and on any machine (a freshly started CI machine included). The age rules (starting, gone) are
      // unit-tested with a controlled clock in launcher-lib.test.ts.
      const world = newWorld();
      mkdirSync(world.data, { recursive: true });
      const port = await freePort();
      const stranger = spawn(process.execPath, [
        '-e',
        `require('node:http').createServer((q, r) => { r.statusCode = 404; r.end('not the demo'); }).listen(${port}, '127.0.0.1'); setTimeout(() => {}, 60000);`,
      ]);
      try {
        const deadline = Date.now() + 10_000;
        while (!(await listening(port))) {
          if (Date.now() > deadline) throw new Error('the stand-in program did not start listening');
          await new Promise((done) => setTimeout(done, 50));
        }
        writeFileSync(
          join(world.data, 'demo.pid'),
          JSON.stringify({ mode: 'live', port, serverPid: stranger.pid, fakePid: null, fakePort: null, startedAtMs: Date.now() - 5_000, commit: null }),
        );

        const result = await run('stop', world);

        expect(result.code, result.out).toBe(0);
        expect(result.out).toMatch(/left it alone/);
        expect(alive(stranger.pid!)).toBe(true);
      } finally {
        stranger.kill();
      }
    },
    SLOW,
  );
});

describe('two windows start the demo at the same moment', () => {
  it(
    'only one of them starts a server; the other waits and then just opens the demo',
    async () => {
      const world = newWorld();

      const [first, second] = await Promise.all([run('practice', world), run('practice', world)]);

      expect(first.code, first.out).toBe(0);
      expect(second.code, second.out).toBe(0);
      const starters = [first.out, second.out].filter((out) => /Starting the practice demo/.test(out));
      expect(starters).toHaveLength(1);
      expect([first.out, second.out].filter((out) => /already running/.test(out))).toHaveLength(1);
      const started = record(world);
      expect(alive(started.serverPid)).toBe(true);
      expect((await getJson(started.port, '/api/health')).mode).toBe('practice');
      expect(existsSync(join(world.data, 'demo.lock'))).toBe(false);
    },
    SLOW,
  );
});

describe.skipIf(process.platform === 'win32')('Ctrl+C, a closed window or a termination while the demo is still starting', () => {
  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    '%s ends the server and the stand-in model it had begun, and leaves no note and no lock behind',
    async (signal) => {
      const world = newWorld({ hanging: true });
      const { child, done } = begin(LAUNCHER, 'practice', world.env);
      await waitUntil('the note about the server it started', () => existsSync(join(world.data, 'demo.pid')));
      const started = record(world);
      expect(alive(started.serverPid)).toBe(true);
      expect(started.fakePid && alive(started.fakePid)).toBe(true);

      child.kill(signal);
      const finished = await done;

      expect(finished.code, finished.out).toBe(130);
      await waitUntil('the server to end', () => !alive(started.serverPid));
      await waitUntil('the stand-in model to end', () => !alive(started.fakePid!));
      expect(existsSync(join(world.data, 'demo.pid'))).toBe(false);
      expect(existsSync(join(world.data, 'demo.lock'))).toBe(false);
    },
    SLOW,
  );
});

describe('the download\'s own folder layout, in a folder with spaces in its path', () => {
  it(
    'runs from launcher/bundle with launcher/demo and launcher/fake-llm.mjs beside it, and keeps its data in HybridDemo/data',
    async () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), 'launcher layout ')));
      const root = join(base, 'My Documents', 'HybridDemo');
      const put = (to: string, from: string | null, text?: string) => {
        mkdirSync(join(root, to, '..'), { recursive: true });
        if (from !== null) copyFileSync(from, join(root, to));
        else writeFileSync(join(root, to), text ?? '');
      };
      const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));
      put('launcher/bundle/launcher.mjs', here('./launcher.mjs'));
      put('launcher/bundle/launcher-lib.mjs', here('./launcher-lib.mjs'));
      put('launcher/demo/demo-lib.mjs', here('../demo/demo-lib.mjs'));
      put('launcher/fake-llm.mjs', here('../fake-llm.mjs'));
      put('app/server.js', null, FAKE_SERVER_CJS);
      mkdirSync(join(root, 'app', 'agents'), { recursive: true });
      const launcher = join(root, 'launcher', 'bundle', 'launcher.mjs');
      const env = { HYBRID_NO_BROWSER: '1', HYBRID_NO_EDITOR: '1' };

      try {
        const first = await begin(launcher, 'practice', env).done;
        expect(first.code, first.out).toBe(0);
        const started = JSON.parse(readFileSync(join(root, 'data', 'demo.pid'), 'utf8')) as { port: number; serverPid: number };
        const seen = await getJson(started.port, '/env');
        expect(seen).toMatchObject({
          HOSTNAME: '127.0.0.1',
          HOST: '127.0.0.1',
          DEMO_MODE: 'practice',
          CHAT_DB_PATH: join(root, 'data', 'demo-practice.db'),
          AGENT_SPECS_DIR: join(root, 'app', 'agents'),
          cwd: join(root, 'app'),
        });

        const stopped = await begin(launcher, 'stop', env).done;
        expect(stopped.code, stopped.out).toBe(0);
        expect(alive(started.serverPid)).toBe(false);

        // The shipped settings file is missing here, so the launcher makes an empty one and asks for it to be filled.
        const live = await begin(launcher, 'live', env).done;
        expect(live.code, live.out).toBe(0);
        expect(live.out).toMatch(/Still empty: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL/);
        expect(readFileSync(join(root, 'my-settings.env'), 'utf8')).toMatch(/LLM_API_KEY=/);
        expect(existsSync(join(root, 'data', 'demo.pid'))).toBe(false);
      } finally {
        await begin(launcher, 'stop', env).done;
        rmSync(base, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe('the launcher with no command', () => {
  it('says what to do and exits with 2', async () => {
    const world = newWorld();

    const result = await run('', world);

    expect(result.code).toBe(2);
    expect(result.out).toMatch(/practice, live or stop/);
  });
});
