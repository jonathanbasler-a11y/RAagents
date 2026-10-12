import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The repo's pre-commit guard (.githooks/pre-commit), run against a throwaway repository so
// the real index is never touched. The hook sits four folders above this file; a copy of the
// app folder alone (for example an install check under /tmp) has no hook to test.
const HOOK = fileURLToPath(new URL('../../../../.githooks/pre-commit', import.meta.url));

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  return env;
}

describe.skipIf(!existsSync(HOOK))('.githooks/pre-commit', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'hook-test-'));
    execFileSync('git', ['init', '-q'], { cwd: repo, env: cleanGitEnv() });
    mkdirSync(join(repo, '.githooks'));
    copyFileSync(HOOK, join(repo, '.githooks', 'pre-commit'));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** Stages the named files (each with a line of text) and runs the hook; returns its exit code and stderr. */
  function runWithStaged(...names: string[]): { code: number | null; stderr: string } {
    for (const name of names) {
      mkdirSync(dirname(join(repo, name)), { recursive: true });
      writeFileSync(join(repo, name), 'KEY=value\n');
    }
    execFileSync('git', ['add', '--force', '--', ...names], { cwd: repo, env: cleanGitEnv() });
    const result = spawnSync('sh', [join(repo, '.githooks', 'pre-commit')], { cwd: repo, env: cleanGitEnv(), encoding: 'utf8' });
    return { code: result.status, stderr: result.stderr };
  }

  it.each(['.env', '.env.local', '.env.production', 'llm.env', 'dummy.env', 'app/.env', 'outputs/05_demo/app/.env.local', 'config/prod.env', 'ü.env'])(
    'refuses the staged environment file %s and names it',
    (name) => {
      const result = runWithStaged(name);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('environment files');
      expect(result.stderr).toContain(name);
    },
  );

  it('refuses a commit that mixes an environment file with harmless files', () => {
    expect(runWithStaged('README.md', 'src/app.ts', 'x/secrets.env').code).toBe(1);
  });

  it.each(['.env.example', 'env.example', 'outputs/05_demo/app/env.example', 'outputs/05_demo/app/.env.example'])(
    'allows the template %s',
    (name) => {
      expect(runWithStaged(name).code).toBe(0);
    },
  );

  it.each(['README.md', 'src/env.ts', 'docs/environment.md', 'envelope.txt', 'src/dotenv.ts', 'notes.env.md'])(
    'allows the look-alike %s (positive control)',
    (name) => {
      expect(runWithStaged(name).code).toBe(0);
    },
  );

  it('still refuses confidential inputs and audio files (the older checks)', () => {
    expect(runWithStaged('inputs/confidential/note.txt').code).toBe(1);
  });

  it('still refuses audio files', () => {
    expect(runWithStaged('recording.m4a').code).toBe(1);
  });

  it('passes when nothing is staged', () => {
    const result = spawnSync('sh', [join(repo, '.githooks', 'pre-commit')], { cwd: repo, env: cleanGitEnv(), encoding: 'utf8' });

    expect(result.status).toBe(0);
  });
});
