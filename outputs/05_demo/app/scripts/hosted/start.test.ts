import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The container's start script, run for real with stand-in `node` and `litestream` commands
// that record how they were called. No server starts and no network is used.

const SCRIPT = path.join(__dirname, 'start.sh');
let dir: string;
let log: string;

function stub(name: string, exitCode = 0) {
  const file = path.join(dir, 'bin', name);
  writeFileSync(file, `#!/bin/sh\nprintf '%s' "${name}" >> "$CALL_LOG"\nfor a in "$@"; do printf ' [%s]' "$a" >> "$CALL_LOG"; done\nprintf '\\n' >> "$CALL_LOG"\nexit ${exitCode}\n`);
  chmodSync(file, 0o755);
}

function run(env: Record<string, string>) {
  return spawnSync('/bin/sh', [SCRIPT], {
    env: { NODE_ENV: 'test', PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`, CALL_LOG: log, ...env },
    encoding: 'utf8',
  });
}

function calls(): string[] {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hosted-start-'));
  log = path.join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', path.join(dir, 'bin')]);
  stub('node');
  stub('litestream');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scripts/hosted/start.sh', () => {
  it('starts the server directly when no replica is configured', () => {
    const result = run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), HOST: '0.0.0.0', PORT: '8501' });

    expect(result.status).toBe(0);
    expect(calls()).toEqual(['node [node_modules/next/dist/bin/next] [start] [-H] [0.0.0.0] [-p] [8501]']);
  });

  it('restores the database from the replica, then replicates while running the server as its child', () => {
    const db = path.join(dir, 'data', 'chat.db');
    const result = run({ CHAT_DB_PATH: db, HOST: '0.0.0.0', PORT: '8501', LITESTREAM_REPLICA_URL: 's3://bucket/app/chat.db' });

    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      `litestream [restore] [-if-db-not-exists] [-if-replica-exists] [-o] [${db}] [s3://bucket/app/chat.db]`,
      `litestream [replicate] [-exec] [node node_modules/next/dist/bin/next start -H 0.0.0.0 -p 8501] [${db}] [s3://bucket/app/chat.db]`,
    ]);
  });

  it('does not start the server when the restore fails', () => {
    stub('litestream', 1);
    const result = run({ CHAT_DB_PATH: path.join(dir, 'data', 'chat.db'), LITESTREAM_REPLICA_URL: 's3://bucket/app/chat.db' });

    expect(result.status).not.toBe(0);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatch(/^litestream \[restore\]/);
  });

  it('refuses to start without a database path', () => {
    const result = run({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/CHAT_DB_PATH/);
    expect(calls()).toEqual([]);
  });
});
