import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The backup-age helper read by scripts/hosted/start.sh: what it prints for the output of `litestream ltx -json`.
// Anything it cannot read must stop the start (exit 2), never pass as "no backup" or as an old one.

const SCRIPT = path.join(__dirname, 'backup-age.mjs');

function age(stdin: string) {
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8' });
}

const file = (timestamp: unknown) => ({ level: 0, min_txid: '1', max_txid: '2', size: 10, timestamp });

describe('scripts/hosted/backup-age.mjs', () => {
  it('prints "none" for an empty backup', () => {
    expect(age('[]\n')).toMatchObject({ status: 0, stdout: 'none\n' });
  });

  it('prints the age in seconds of the newest file, skipping log lines before the list', () => {
    const old = new Date(Date.now() - 600_000).toISOString();
    const older = new Date(Date.now() - 3_600_000).toISOString();
    const result = age(`time=x level=INFO msg="initialized replica"\n${JSON.stringify([file(older), file(old)], null, 2)}\n`);
    expect(result.status).toBe(0);
    expect(Number(result.stdout)).toBeGreaterThanOrEqual(599);
    expect(Number(result.stdout)).toBeLessThan(620);
  });

  it('stops for a file without a readable time, rather than treating it as old', () => {
    expect(age(JSON.stringify([file(new Date().toISOString()), file(undefined)])).status).toBe(2);
    expect(age(JSON.stringify([file('yesterday')])).status).toBe(2);
  });

  it('stops for output it cannot read', () => {
    expect(age('level=ERROR msg="access denied"\n').status).toBe(2);
    expect(age('[{"level": 0,\n').status).toBe(2);
    expect(age('{"files": []}\n').status).toBe(2);
  });
});
