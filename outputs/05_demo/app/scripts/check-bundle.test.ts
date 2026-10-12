import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PROMPT_MARKER } from '@/server/prompts';
import { checkBundle, main, readPromptMarker, scanForMarker } from './check-bundle.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-bundle.mjs');
const MARKER = 'unit-test-marker-0f1e2d3c';

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'check-bundle-'));
  temps.push(path);
  return path;
}

/** A folder with the given files (paths relative to it, with text contents). */
function folder(files: Record<string, string>): string {
  const root = temp();
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

/** A passing dist: a clean client bundle and a server bundle that carries the marker. */
const GOOD = {
  'static/chunks/app.js': 'console.log("client code with no prompt text");',
  'static/css/app.css': 'body{margin:0}',
  'server/app/team/page.js': `module.exports = "ref ${MARKER}";`,
};

describe('scanForMarker', () => {
  it('finds the marker in nested files and lists each file once, sorted', () => {
    const root = folder({
      'b/deep/er/two.js': `x ${MARKER} y ${MARKER}`,
      'a.js': MARKER,
      'c.js': 'nothing here',
    });

    expect(scanForMarker(root, MARKER)).toEqual({ hits: ['a.js', 'b/deep/er/two.js'], scanned: 3, couldNotCheck: [] });
  });

  it('matches bytes in any file type, including source maps and binary files', () => {
    const root = folder({ 'x.js.map': `{"sourcesContent":["${MARKER}"]}`, 'blob.bin': 'abc' });
    writeFileSync(join(root, 'raw.bin'), Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(MARKER), Buffer.from([2])]));

    expect(scanForMarker(root, MARKER).hits).toEqual(['raw.bin', 'x.js.map']);
  });

  it('does not match a near miss', () => {
    const root = folder({ 'a.js': MARKER.slice(0, -1), 'b.js': MARKER.toUpperCase() });

    expect(scanForMarker(root, MARKER).hits).toEqual([]);
  });

  it('refuses an empty marker, which would match every file', () => {
    expect(() => scanForMarker(folder({ 'a.js': 'x' }), '')).toThrow(/marker/i);
  });

  it('reports a symlink as not checkable instead of skipping it quietly', () => {
    const root = folder({ 'a.js': 'x' });
    symlinkSync(join(root, 'a.js'), join(root, 'link.js'));

    const result = scanForMarker(root, MARKER);

    expect(result.scanned).toBe(1);
    expect(result.couldNotCheck).toEqual([expect.stringContaining('link.js')]);
  });
});

describe('checkBundle', () => {
  it('passes when the client bundle is clean and the server bundle carries the marker', () => {
    const result = checkBundle({ distDir: folder(GOOD), marker: MARKER });

    expect(result).toEqual({
      ok: true,
      problems: [],
      leaks: [],
      serverHits: ['server/app/team/page.js'],
      scanned: { static: 2, server: 1 },
    });
  });

  it('FAILS when the marker is in the client bundle, and names the file', () => {
    const dist = folder({ ...GOOD, 'static/chunks/pages/leaky-123.js': `var s="${MARKER}"` });

    const result = checkBundle({ distDir: dist, marker: MARKER });

    expect(result.ok).toBe(false);
    expect(result.leaks).toEqual(['static/chunks/pages/leaky-123.js']);
    expect(result.problems.join('\n')).toMatch(/client bundle.*static\/chunks\/pages\/leaky-123\.js/);
  });

  it('FAILS on a leak in a source map or any other file type under static', () => {
    const dist = folder({ ...GOOD, 'static/media/notes.txt': MARKER, 'static/chunks/app.js.map': `["${MARKER}"]` });

    expect(checkBundle({ distDir: dist, marker: MARKER }).leaks).toEqual(['static/chunks/app.js.map', 'static/media/notes.txt']);
  });

  it('ignores a marker outside static: the server bundle is the right place for it', () => {
    const dist = folder({ ...GOOD, 'server/chunks/rules.js': `"${MARKER}"` });

    const result = checkBundle({ distDir: dist, marker: MARKER });

    expect(result.ok).toBe(true);
    expect(result.serverHits).toEqual(['server/app/team/page.js', 'server/chunks/rules.js']);
  });

  it('FAILS the positive control when the marker is NOT in the server bundle', () => {
    const dist = folder({ ...GOOD, 'server/app/team/page.js': 'module.exports = "no marker";' });

    const result = checkBundle({ distDir: dist, marker: MARKER });

    expect(result.ok).toBe(false);
    expect(result.leaks).toEqual([]);
    expect(result.problems.join('\n')).toMatch(/not found under server/i);
  });

  it('reports both failures together', () => {
    const dist = folder({ 'static/a.js': MARKER, 'server/b.js': 'clean' });

    expect(checkBundle({ distDir: dist, marker: MARKER }).problems).toHaveLength(2);
  });

  it('FAILS when the dist folder does not exist', () => {
    const result = checkBundle({ distDir: join(temp(), 'missing'), marker: MARKER });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/dist folder.*not found/i)]);
  });

  it('FAILS when static or server is missing, so a half-built dist never passes', () => {
    const noStatic = checkBundle({ distDir: folder({ 'server/a.js': MARKER }), marker: MARKER });
    const noServer = checkBundle({ distDir: folder({ 'static/a.js': 'x' }), marker: MARKER });

    expect(noStatic.ok).toBe(false);
    expect(noStatic.problems.join('\n')).toMatch(/static.*not found/i);
    expect(noServer.ok).toBe(false);
    expect(noServer.problems.join('\n')).toMatch(/server.*not found/i);
  });

  it('FAILS when static has no files, because nothing was checked', () => {
    const dist = folder({ 'server/a.js': MARKER });
    mkdirSync(join(dist, 'static', 'chunks'), { recursive: true });

    const result = checkBundle({ distDir: dist, marker: MARKER });

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/static.*no files/i);
  });

  it('FAILS when a file could not be checked', () => {
    const dist = folder(GOOD);
    symlinkSync(join(dist, 'static', 'css', 'app.css'), join(dist, 'static', 'css', 'alias.css'));

    const result = checkBundle({ distDir: dist, marker: MARKER });

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/could not check.*alias\.css/i);
  });
});

describe('readPromptMarker', () => {
  it('reads the value of the exported constant', () => {
    const dir = folder({ 'rules.ts': `export const PROMPT_MARKER = 'abc-123-def-4567';\nexport const SHARED_RULES = 'x';\n` });

    expect(readPromptMarker(dir)).toBe('abc-123-def-4567');
  });

  it('reads the marker the app really uses', () => {
    const promptsDir = join(dirname(SCRIPT), '..', 'src', 'server', 'prompts');

    expect(readPromptMarker(promptsDir)).toBe(PROMPT_MARKER);
  });

  it('ignores test files and other constants', () => {
    const dir = folder({
      'rules.ts': `export const PROMPT_MARKER = 'real-marker-0001';`,
      'rules.test.ts': `export const PROMPT_MARKER = 'fake-marker-9999';`,
      'other.ts': `export const OTHER_MARKER = 'other-marker-0002';`,
    });

    expect(readPromptMarker(dir)).toBe('real-marker-0001');
  });

  it('fails when there is no marker, when there are two different ones, or when the folder is missing', () => {
    expect(() => readPromptMarker(folder({ 'a.ts': 'export const X = 1;' }))).toThrow(/PROMPT_MARKER/);
    expect(() =>
      readPromptMarker(
        folder({ 'a.ts': `export const PROMPT_MARKER = 'first-marker-0001';`, 'b.ts': `export const PROMPT_MARKER = 'second-marker-0002';` }),
      ),
    ).toThrow(/more than one/i);
    expect(() => readPromptMarker(join(temp(), 'nope'))).toThrow(/prompts/i);
  });

  it('refuses a marker too short to be reliable', () => {
    expect(() => readPromptMarker(folder({ 'a.ts': `export const PROMPT_MARKER = 'ab';` }))).toThrow(/too short/i);
  });
});

describe('main (exit codes and messages)', () => {
  function run(argv: string[], env: Record<string, string | undefined> = {}, cwd = temp()) {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, env, { cwd, log: (line: string) => out.push(line), error: (line: string) => err.push(line) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  const realGood = () => folder({ ...GOOD, 'server/app/team/page.js': `"${PROMPT_MARKER}"` });

  it('exits 0 for a good dist given as an argument', () => {
    const result = run([realGood()]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/ok/i);
  });

  it('exits 1 and names the leaking file when the client bundle carries the marker', () => {
    const dist = folder({ ...GOOD, 'server/app/a.js': PROMPT_MARKER, 'static/chunks/leak.js': PROMPT_MARKER });

    const result = run([dist]);

    expect(result.code).toBe(1);
    expect(result.err).toContain('static/chunks/leak.js');
  });

  it('exits 1 when the marker is missing from the server bundle', () => {
    expect(run([folder(GOOD)]).code).toBe(1);
  });

  it('takes the dist folder from NEXT_DIST_DIR when there is no argument, relative to the working folder', () => {
    const cwd = temp();
    const dist = join(cwd, '.next-case');
    mkdirSync(dist);
    for (const [name, text] of Object.entries({ ...GOOD, 'server/app/team/page.js': PROMPT_MARKER })) {
      mkdirSync(dirname(join(dist, name)), { recursive: true });
      writeFileSync(join(dist, name), text);
    }

    expect(run([], { NEXT_DIST_DIR: '.next-case' }, cwd).code).toBe(0);
  });

  it('prefers the argument over NEXT_DIST_DIR', () => {
    const result = run([join(temp(), 'missing')], { NEXT_DIST_DIR: realGood() });

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/not found/i);
  });

  it('defaults to .next, as next.config.ts does, and exits 1 when that folder is not there', () => {
    const result = run([], {});

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/not found.*\.next/i);
  });

  it('treats an empty NEXT_DIST_DIR as unset', () => {
    expect(run([], { NEXT_DIST_DIR: '' }).err).toMatch(/not found.*\.next/i);
  });

  it('exits 2, not 1, when the marker cannot be read: that is a setup problem, not a verdict on the bundle', () => {
    const emptyPrompts = temp();
    const out: string[] = [];
    const err: string[] = [];

    const code = main([realGood()], {}, { cwd: temp(), promptsDir: emptyPrompts, log: (l: string) => out.push(l), error: (l: string) => err.push(l) });

    expect(code).toBe(2);
    expect(err.join('\n')).toMatch(/PROMPT_MARKER/);
  });
});

describe('the command line', () => {
  function cli(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, NEXT_DIST_DIR: '', ...env } });
    return { status: result.status, out: result.stdout, err: result.stderr };
  }

  it('exits 0 for a good dist and 1 for a leaky one', () => {
    const good = folder({ ...GOOD, 'server/app/a.js': PROMPT_MARKER });
    const leaky = folder({ ...GOOD, 'server/app/a.js': PROMPT_MARKER, 'static/chunks/leak.js': PROMPT_MARKER });

    expect(cli([good]).status).toBe(0);
    const failed = cli([leaky]);
    expect(failed.status).toBe(1);
    expect(failed.err).toContain('static/chunks/leak.js');
  });

  it('exits 1 when the marker is missing from the server (positive control)', () => {
    expect(cli([folder(GOOD)]).status).toBe(1);
  });

  it('reads NEXT_DIST_DIR when there is no argument', () => {
    const dist = folder({ ...GOOD, 'server/app/a.js': PROMPT_MARKER });

    expect(cli([], { NEXT_DIST_DIR: dist }).status).toBe(0);
  });
});
