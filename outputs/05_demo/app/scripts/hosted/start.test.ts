import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The container's start scripts, run for real with stand-in `node` and `litestream` commands that record how they were
// called. No server starts and no network is used. The stand-in node runs the real node for the backup-age helper.

const START = path.join(__dirname, 'start.sh');
const SERVER = path.join(__dirname, 'server.sh');
let dir: string;
let log: string;

function writeStub(name: string, body: string) {
  const file = path.join(dir, 'bin', name);
  writeFileSync(file, `#!/bin/sh\nprintf '%s' "${name}" >> "$CALL_LOG"\nfor a in "$@"; do printf ' [%s]' "$a" >> "$CALL_LOG"; done\nprintf '\\n' >> "$CALL_LOG"\n${body}\n`);
  chmodSync(file, 0o755);
}

/** A stand-in litestream: `ltx` prints LTX_OUTPUT (or fails with LTX_FAIL), `restore` exits RESTORE_EXIT. */
function stubLitestream() {
  writeStub(
    'litestream',
    `case "$1" in
  ltx) [ -n "\${LTX_FAIL:-}" ] && exit 1; printf '%s\\n' "\${LTX_OUTPUT:-[]}"; exit 0 ;;
  restore) exit "\${RESTORE_EXIT:-0}" ;;
esac
exit 0`,
  );
}

/** A stand-in node that records its arguments, except for the backup-age helper, which runs on the real node. */
function stubNode(body = 'exit 0') {
  const file = path.join(dir, 'bin', 'node');
  writeFileSync(
    file,
    `#!/bin/sh\ncase "$1" in *backup-age.mjs) exec "$REAL_NODE" "$@" ;; esac\nprintf '%s' "node" >> "$CALL_LOG"\nfor a in "$@"; do printf ' [%s]' "$a" >> "$CALL_LOG"; done\nprintf '\\n' >> "$CALL_LOG"\n${body}\n`,
  );
  chmodSync(file, 0o755);
}

function env(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`, CALL_LOG: log, REAL_NODE: process.execPath, ...extra };
}

// The image's /bin/sh is dash (Debian); a Mac's is bash in POSIX mode. Every test runs under both.
let shell = '/bin/sh';

function run(extra: Record<string, string>) {
  return spawnSync(shell, [START], { env: env(extra), encoding: 'utf8' });
}

function calls(): string[] {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** `litestream ltx -json` output with one file of the given age, after a log line as Litestream prints it. */
function listing(ageSeconds: number): string {
  const timestamp = new Date(Date.now() - ageSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `time=2026-10-29T10:00:00Z level=INFO msg="initialized replica"\n${JSON.stringify([{ level: 0, min_txid: '1', max_txid: '9', size: 512, timestamp }], null, 2)}`;
}

const URL = 's3://bucket/app/chat.db?region=eu-central-1';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hosted-start-'));
  log = path.join(dir, 'calls.log');
  mkdirSync(path.join(dir, 'bin'));
  stubNode();
  stubLitestream();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SERVER_CALL = 'node [node_modules/next/dist/bin/next] [start] [-H] [0.0.0.0] [-p] [8501] [--keepAliveTimeout] [65000]';

const SHELLS = ['/bin/sh', ...(existsSync('/bin/dash') ? ['/bin/dash'] : [])];

describe.each(SHELLS)('under %s', (shellPath) => {
beforeEach(() => {
  shell = shellPath;
});

describe('scripts/hosted/start.sh without a backup', () => {
  it('starts the server, with a keep-alive longer than the load balancer idle timeout', () => {
    const result = run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), HOST: '0.0.0.0', PORT: '8501' });
    expect(result.status).toBe(0);
    expect(calls()).toEqual([SERVER_CALL]);
  });

  it('listens on all addresses and port 8501 unless told otherwise', () => {
    expect(run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db') }).status).toBe(0);
    expect(calls()).toEqual([SERVER_CALL]);
    rmSync(log);
    run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), HOST: '127.0.0.1', PORT: '3300' });
    expect(calls()).toEqual(['node [node_modules/next/dist/bin/next] [start] [-H] [127.0.0.1] [-p] [3300] [--keepAliveTimeout] [65000]']);
  });

  it('refuses to start without a database path', () => {
    const result = run({});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/CHAT_DB_PATH/);
    expect(calls()).toEqual([]);
  });
});

describe('scripts/hosted/start.sh and sign-in', () => {
  it('requires sign-in even when the setting arrives empty (as copied from env.example); only an explicit 0 turns it off', () => {
    const snapshot = path.join(dir, 'require.txt');
    stubNode(`printf '%s' "\${RAAGENTS_REQUIRE_SIGN_IN-unset}" > "$ENV_SNAPSHOT"`);
    const db = path.join(dir, 'data', 'chat.db');
    run({ CHAT_DB_PATH: db, RAAGENTS_REQUIRE_SIGN_IN: '', ENV_SNAPSHOT: snapshot });
    expect(readFileSync(snapshot, 'utf8')).toBe('1');
    run({ CHAT_DB_PATH: db, ENV_SNAPSHOT: snapshot });
    expect(readFileSync(snapshot, 'utf8')).toBe('1');
    run({ CHAT_DB_PATH: db, RAAGENTS_REQUIRE_SIGN_IN: '0', ENV_SNAPSHOT: snapshot });
    expect(readFileSync(snapshot, 'utf8')).toBe('0');
  });
});

describe('scripts/hosted/start.sh with a backup', () => {
  it('checks that no other copy is writing, restores, then replicates while running the server as its child', () => {
    const db = path.join(dir, 'data', 'chat.db');
    const result = run({ CHAT_DB_PATH: db, LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: listing(600) });

    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      `litestream [ltx] [-json] [-level] [all] [${URL}]`,
      `litestream [restore] [-if-db-not-exists] [-integrity-check] [quick] [-o] [${db}] [${URL}]`,
      `litestream [replicate] [-exec] [/bin/sh '${SERVER}'] [${db}] [${URL}]`,
    ]);
    expect(existsSync(path.dirname(db))).toBe(true);
  });

  it('refuses to start while another copy is still writing the backup', () => {
    const result = run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: listing(5) });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Another copy is still writing this backup/);
    expect(calls()).toEqual([`litestream [ltx] [-json] [-level] [all] [${URL}]`]);
  });

  it('refuses a backup file dated in the future rather than guessing it is old', () => {
    const result = run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: listing(-120) });
    expect(result.status).not.toBe(0);
  });

  it('does not start when the backup cannot be listed or the listing cannot be read', () => {
    expect(run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), LITESTREAM_REPLICA_URL: URL, LTX_FAIL: '1' }).status).not.toBe(0);
    expect(calls()).toHaveLength(1);
    rmSync(log);
    expect(run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: 'level=ERROR msg="access denied"' }).status).not.toBe(0);
    expect(calls()).toHaveLength(1);
  });

  it('asks the restore to fail when there is no backup, so a wrong or changed path cannot start empty', () => {
    const db = path.join(dir, 'data', 'chat.db');
    const result = run({ CHAT_DB_PATH: db, LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: '[]', RESTORE_EXIT: '1' });

    expect(result.status).not.toBe(0);
    expect(calls()[1]).toBe(`litestream [restore] [-if-db-not-exists] [-integrity-check] [quick] [-o] [${db}] [${URL}]`);
    expect(calls()).toHaveLength(2);
  });

  it('starts empty only when told this is the first start, and says so', () => {
    const db = path.join(dir, 'data', 'chat.db');
    const result = run({ CHAT_DB_PATH: db, LITESTREAM_REPLICA_URL: URL, LTX_OUTPUT: '[]', LITESTREAM_ALLOW_EMPTY_START: '1' });

    expect(result.status).toBe(0);
    expect(calls()[1]).toBe(`litestream [restore] [-if-db-not-exists] [-if-replica-exists] [-integrity-check] [quick] [-o] [${db}] [${URL}]`);
    expect(result.stdout).toMatch(/starting with an empty database/);
  });
});

describe('scripts/hosted/server.sh', () => {
  /** Starts server.sh with a stand-in server, waits until that server runs, sends SIGTERM and returns the exit code. */
  async function stopWhileRunning(): Promise<number | null> {
    const started = path.join(dir, 'started');
    const child = spawn(shell, [SERVER], { env: env({ STARTED: started }) });
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    for (let i = 0; i < 100 && !existsSync(started); i++) await new Promise((resolve) => setTimeout(resolve, 30));
    await new Promise((resolve) => setTimeout(resolve, 150));
    child.kill('SIGTERM');
    return exited;
  }

  it('passes a stop signal to the server and counts its signal exit as clean, so Litestream makes its final upload', async () => {
    stubNode(`trap 'exit 143' TERM\ntouch "$STARTED"\nwhile :; do sleep 0.1; done`);
    expect(await stopWhileRunning()).toBe(0);
  });

  it('waits until the server has finished its shutdown (saving running turns) before it exits', async () => {
    const saved = path.join(dir, 'saved');
    stubNode(`trap 'sleep 1; touch "${saved}"; exit 143' TERM\ntouch "$STARTED"\nwhile :; do sleep 0.1; done`);
    expect(await stopWhileRunning()).toBe(0);
    expect(existsSync(saved)).toBe(true);
  });

  it('passes on a crash of the server', () => {
    stubNode('exit 3');
    expect(spawnSync(shell, [SERVER], { env: env({}) }).status).toBe(3);
  });
});
});
