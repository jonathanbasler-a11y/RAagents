import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findPayloadRoot, runBuild } from './build-bundles.mjs';
import {
  HELP,
  KEY_ASSIGNMENT,
  LAUNCHER_FILES,
  SCAN_RULES,
  STARTER_NAMES,
  TARGETS,
  applyPreset,
  assertKeysEmpty,
  downloadUrl,
  ensureArchive,
  expandHome,
  extractRuntime,
  fixLineEndings,
  formatSize,
  isInside,
  lineEndingStyleFor,
  listZip,
  makeZip,
  modeFor,
  normalizeTree,
  parseArgs,
  parseDenyList,
  parseRuntimes,
  requiredMembers,
  runtimeMembers,
  runtimesFor,
  scanStagedTree,
  sha256OfFile,
  sha256SumsText,
  targetsFor,
  verifyArchive,
  zipNameFor,
  zipProblems,
} from './build-lib.mjs';

// Offline. The system zip, unzip and tar are real; the network is a fake fetch.

const HERE = dirname(fileURLToPath(import.meta.url));
const HAS_TOOLS = ['zip', 'unzip', 'tar'].every((tool) => spawnSync(tool, ['-v']).error === undefined);

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});
function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'build-lib-'));
  temps.push(path);
  return path;
}
function put(root: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
/** A home-folder-looking path, assembled so no such literal sits in this file. */
const homePath = (...rest: string[]) => ['', 'Users', 'someone', ...rest].join('/');
const winHomePath = () => ['C:', 'Users', 'someone', 'file.txt'].join('\\');
/** A value shaped like a key: long, with digits. */
const KEY_VALUE = 'abcd1234'.repeat(4);

describe('parseArgs', () => {
  const context = { home: '/h', cwd: '/w' };

  it('defaults to the two folders under the home folder and builds both ZIPs', () => {
    expect(parseArgs([], context)).toEqual({
      help: false,
      out: '/h/RAagents-bundles/out',
      cache: '/h/RAagents-bundles/cache',
      preset: null,
      only: null,
      skipBuild: false,
      denyList: null,
    });
  });

  it('reads every option, with a space or an equals sign, and expands ~ and relative paths', () => {
    const args = parseArgs(['--out', '~/o', '--cache=rel/c', '--preset', '/p.env', '--only', 'mac', '--skip-build', '--deny-list=~/d.txt'], context);
    expect(args).toMatchObject({ out: '/h/o', cache: '/w/rel/c', preset: '/p.env', only: 'mac', skipBuild: true, denyList: '/h/d.txt' });
  });

  it('knows --help and -h', () => {
    expect(parseArgs(['--help'], context).help).toBe(true);
    expect(parseArgs(['-h'], context).help).toBe(true);
  });

  it('the help text describes every option the parser accepts, and no key or host', () => {
    for (const option of ['--out', '--cache', '--preset', '--only', '--skip-build', '--deny-list', '--help']) expect(HELP).toContain(option);
    expect(HELP).toContain('HybridTeamDemo-mac.zip');
    expect(HELP).toContain('HybridTeamDemo-windows.zip');
    expect(HELP).toContain('SHA256SUMS.txt');
    expect(HELP).not.toMatch(/https?:\/\/(?!nodejs\.org)/);
  });

  it('refuses an unknown option, a stray word, a missing value and a bad --only', () => {
    expect(() => parseArgs(['--nope'], context)).toThrow(/unknown option "--nope"/);
    expect(() => parseArgs(['mac'], context)).toThrow(/unknown option "mac"/);
    expect(() => parseArgs(['--out'], context)).toThrow(/--out needs a value/);
    expect(() => parseArgs(['--out', '--cache', 'x'], context)).toThrow(/--out needs a value/);
    expect(() => parseArgs(['--only', 'linux'], context)).toThrow(/"mac" or "windows"/);
    expect(() => parseArgs(['--skip-build=1'], context)).toThrow(/takes no value/);
  });

  it('expandHome only touches a leading ~', () => {
    expect(expandHome('~', '/h')).toBe('/h');
    expect(expandHome('~/a', '/h')).toBe('/h/a');
    expect(expandHome('/a/~/b', '/h')).toBe('/a/~/b');
    expect(expandHome('~x', '/h')).toBe('~x');
  });
});

describe('paths and names', () => {
  it('isInside is true for the folder itself and its children, false for siblings and parents', () => {
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/repo', '/repo/out/x')).toBe(true);
    expect(isInside('/repo', '/repo-other')).toBe(false);
    expect(isInside('/repo/app', '/repo')).toBe(false);
    expect(isInside('/repo', '/elsewhere/out')).toBe(false);
  });

  it('names the two ZIPs as the release contract says', () => {
    expect(zipNameFor('mac')).toBe('HybridTeamDemo-mac.zip');
    expect(zipNameFor('windows')).toBe('HybridTeamDemo-windows.zip');
  });

  it('--only picks one target, nothing picks both', () => {
    expect(targetsFor('mac')).toEqual(['mac']);
    expect(targetsFor('windows')).toEqual(['windows']);
    expect(targetsFor(null)).toEqual(['mac', 'windows']);
  });

  it('formats sizes and the checksum file', () => {
    expect(formatSize(2_500_000)).toBe('2.5 MB');
    expect(formatSize(1_230_000_000)).toBe('1.23 GB');
    expect(formatSize(10)).toBe('1 KB');
    expect(sha256SumsText([{ name: 'b.zip', sha256: 'bb' }, { name: 'a.zip', sha256: 'aa' }])).toBe('aa  a.zip\nbb  b.zip\n');
  });
});

describe('the pinned runtimes', () => {
  const real = JSON.parse(readFileSync(join(HERE, 'node-runtimes.json'), 'utf8'));

  it('the committed manifest is valid: three archives, Apple silicon, Intel and Windows x64', () => {
    const manifest = parseRuntimes(real);
    expect(manifest.version).toBe('v24.21.0');
    expect(manifest.files.map((f) => `${f.platform}-${f.arch}`)).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
    expect(runtimesFor(manifest, 'darwin')).toHaveLength(2);
    expect(runtimesFor(manifest, 'win32')).toHaveLength(1);
  });

  it('rejects a bad version, a file name that does not match, a bad hash and a duplicate', () => {
    const file = real.files[0];
    expect(() => parseRuntimes({ ...real, version: '24.21.0' })).toThrow(/version/);
    expect(() => parseRuntimes({ ...real, files: [] })).toThrow(/at least one/);
    expect(() => parseRuntimes({ ...real, files: [{ ...file, file: '../evil.tar.gz' }] })).toThrow(/file must be/);
    expect(() => parseRuntimes({ ...real, files: [{ ...file, sha256: 'ABC' }] })).toThrow(/sha256/);
    expect(() => parseRuntimes({ ...real, files: [file, file] })).toThrow(/listed twice/);
    expect(() => parseRuntimes({ ...real, files: [{ ...file, platform: 'linux' }] })).toThrow(/platform/);
  });

  it('names the members to keep: bin/node and LICENSE on the Mac, node.exe and LICENSE on Windows', () => {
    const manifest = parseRuntimes(real);
    const arm = manifest.files[0];
    const win = manifest.files[2];
    expect(runtimeMembers(arm)).toEqual([
      ['node-v24.21.0-darwin-arm64/bin/node', 'runtime/darwin-arm64/bin/node'],
      ['node-v24.21.0-darwin-arm64/LICENSE', 'runtime/darwin-arm64/LICENSE'],
    ]);
    expect(runtimeMembers(win)).toEqual([
      ['node-v24.21.0-win-x64/node.exe', 'runtime/win32-x64/node.exe'],
      ['node-v24.21.0-win-x64/LICENSE', 'runtime/win32-x64/LICENSE'],
    ]);
  });

  it('downloads only from nodejs.org/dist/<version>/', () => {
    expect(downloadUrl('v24.21.0', 'node-v24.21.0-win-x64.zip')).toBe('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip');
  });
});

describe('verifying and fetching archives', () => {
  const entry = (data: string) => ({ platform: 'darwin' as const, arch: 'arm64' as const, file: 'node-v24.21.0-darwin-arm64.tar.gz', sha256: sha(data) });
  const fakeFetch = (body: string, status = 200) =>
    (async () => (status === 200 ? new Response(body, { status }) : new Response(null, { status }))) as unknown as typeof fetch;

  it('accepts a file with the right hash', async () => {
    const dir = put(temp(), { 'a.bin': 'hello' });
    await expect(verifyArchive(join(dir, 'a.bin'), sha('hello'))).resolves.toBeUndefined();
    expect(await sha256OfFile(join(dir, 'a.bin'))).toBe(sha('hello'));
  });

  it('refuses a file with the wrong hash', async () => {
    const dir = put(temp(), { 'a.bin': 'hello' });
    await expect(verifyArchive(join(dir, 'a.bin'), sha('other'))).rejects.toThrow(/does not match the pinned hash/);
  });

  it('refuses a missing file', async () => {
    await expect(verifyArchive(join(temp(), 'nope.bin'), sha('x'))).rejects.toThrow(/is not there/);
  });

  it('uses a good cached archive without touching the network', async () => {
    const cache = put(temp(), { 'node-v24.21.0-darwin-arm64.tar.gz': 'payload' });
    const failing = (async () => {
      throw new Error('network used');
    }) as unknown as typeof fetch;
    const path = await ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: failing });
    expect(path).toBe(join(cache, 'node-v24.21.0-darwin-arm64.tar.gz'));
  });

  it('refuses a cached archive with the wrong hash and leaves it alone', async () => {
    const cache = put(temp(), { 'node-v24.21.0-darwin-arm64.tar.gz': 'tampered' });
    await expect(ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: fakeFetch('payload') })).rejects.toThrow(/pinned hash/);
    expect(readFileSync(join(cache, 'node-v24.21.0-darwin-arm64.tar.gz'), 'utf8')).toBe('tampered');
  });

  it('downloads a missing archive, checks it, and keeps it in the cache', async () => {
    const cache = join(temp(), 'cache');
    const path = await ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: fakeFetch('payload') });
    expect(readFileSync(path, 'utf8')).toBe('payload');
    expect(readdirSync(cache)).toEqual(['node-v24.21.0-darwin-arm64.tar.gz']);
  });

  it('refuses a download with the wrong hash and keeps nothing', async () => {
    const cache = join(temp(), 'cache');
    await expect(ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: fakeFetch('evil') })).rejects.toThrow(/pinned hash/);
    expect(readdirSync(cache)).toEqual([]);
  });

  it('says so when the download fails', async () => {
    const cache = join(temp(), 'cache');
    await expect(ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: fakeFetch('', 404) })).rejects.toThrow(/HTTP 404/);
  });

  it('puts a time limit on the download so a stalled network cannot hang the build', async () => {
    let signal: unknown;
    const spy = (async (_url: string, init?: { signal?: unknown }) => {
      signal = init?.signal;
      return new Response('payload');
    }) as unknown as typeof fetch;
    await ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: join(temp(), 'cache'), fetchImpl: spy });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('says in plain words when nodejs.org cannot be reached, with a short code and never the error text', async () => {
    const cache = join(temp(), 'cache');
    const unreachable = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND proxy.internal.example'), { code: 'ENOTFOUND' }) });
    }) as unknown as typeof fetch;
    let message = '';
    try {
      await ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: unreachable });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/could not reach nodejs\.org/);
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain(cache);
    expect(message).not.toContain('proxy.internal.example');
  });

  it('says so when the download is cut off half way, and keeps nothing', async () => {
    const cache = join(temp(), 'cache');
    const cutOff = (async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('pay'));
          controller.error(new Error('connection reset by peer'));
        },
      });
      return new Response(body);
    }) as unknown as typeof fetch;
    await expect(ensureArchive({ entry: entry('payload'), version: 'v24.21.0', cacheDir: cache, fetchImpl: cutOff })).rejects.toThrow(/download of node-v24\.21\.0-darwin-arm64\.tar\.gz was interrupted/);
    expect(readdirSync(cache)).toEqual([]);
  });
});

describe('applyPreset', () => {
  const TEMPLATE = ['# Header line one', '# Header line two', '', 'LLM_BASE_URL=', 'LLM_API_KEY=', 'LLM_MODEL=', 'LLM_API_KEY_HEADER=', 'LLM_MAX_TOKENS=', ''].join('\n');

  it('fills the four non-secret lines and leaves the key empty', () => {
    const preset = ['LLM_BASE_URL=https://gateway.example/v1', 'LLM_API_KEY_HEADER=api-key', 'LLM_MODEL=some-model', 'LLM_MAX_TOKENS=2000'].join('\n');
    const { text, applied } = applyPreset(TEMPLATE, preset);
    expect(applied).toEqual(['LLM_BASE_URL', 'LLM_API_KEY_HEADER', 'LLM_MODEL', 'LLM_MAX_TOKENS']);
    expect(text).toContain('LLM_BASE_URL=https://gateway.example/v1\n');
    expect(text).toContain('LLM_API_KEY_HEADER=api-key\n');
    expect(text).toContain('LLM_MODEL=some-model\n');
    expect(text).toContain('LLM_MAX_TOKENS=2000\n');
    expect(text).toContain('\nLLM_API_KEY=\n');
  });

  it('treats a value with $ characters literally and strips quotes and an export prefix', () => {
    const { text } = applyPreset(TEMPLATE, 'export LLM_MODEL="m-$&-1"\n');
    expect(text).toContain('LLM_MODEL=m-$&-1\n');
  });

  it('copies the preset comments into a notes block right under the template header', () => {
    const { text } = applyPreset(TEMPLATE, '# Use the team gateway.\n# Ask the AI team for a key.\nLLM_MODEL=m\n');
    expect(text.split('\n').slice(0, 8)).toEqual([
      '# Header line one',
      '# Header line two',
      '',
      '# Notes from the person who prepared this',
      '# Use the team gateway.',
      '# Ask the AI team for a key.',
      '',
      'LLM_BASE_URL=',
    ]);
  });

  it('adds no notes block when the preset has no comments', () => {
    expect(applyPreset(TEMPLATE, 'LLM_MODEL=m\n').text).not.toContain('Notes from');
  });

  it('refuses a preset with an API key, and the error names the key but never its value', () => {
    let message = '';
    try {
      applyPreset(TEMPLATE, `LLM_API_KEY=${KEY_VALUE}\n`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/LLM_API_KEY/);
    expect(message).not.toContain(KEY_VALUE);
    expect(() => applyPreset(TEMPLATE, 'LLM_JUDGE_API_KEY=x\n')).toThrow(/LLM_JUDGE_API_KEY/);
    expect(() => applyPreset(TEMPLATE, 'LLM_API_KEY="short"\n')).toThrow(/LLM_API_KEY/);
  });

  it('accepts a preset whose key lines are empty', () => {
    expect(() => applyPreset(TEMPLATE, 'LLM_API_KEY=\nLLM_JUDGE_API_KEY=""\nLLM_MODEL=m\n')).not.toThrow();
  });

  it('refuses a note that looks like it holds a key', () => {
    expect(() => applyPreset(TEMPLATE, `# LLM_API_KEY=${KEY_VALUE}\nLLM_MODEL=m\n`)).toThrow(/line 1/);
  });

  it('ignores every other key and reports names only', () => {
    const { text, ignored } = applyPreset(TEMPLATE, 'LLM_JUDGE_MODEL=judge-secret-name\nOTHER=1\nLLM_MODEL=m\n');
    expect(ignored).toEqual(['LLM_JUDGE_MODEL', 'OTHER']);
    expect(text).not.toContain('judge-secret-name');
  });

  it('throws when the template has no line for a key the preset sets', () => {
    expect(() => applyPreset('# only a header\n', 'LLM_MODEL=m\n')).toThrow(/no LLM_MODEL line/);
  });

  it('assertKeysEmpty catches a filled key in any final text', () => {
    expect(() => assertKeysEmpty('LLM_API_KEY=\nLLM_JUDGE_API_KEY=\n')).not.toThrow();
    expect(() => assertKeysEmpty('LLM_API_KEY=abc\n')).toThrow(/LLM_API_KEY/);
    expect(() => assertKeysEmpty('x=1\r\nLLM_JUDGE_API_KEY = "abc"\r\n')).toThrow(/LLM_JUDGE_API_KEY/);
  });

  it('refuses a template that already holds a key, even when the preset is harmless', () => {
    expect(() => applyPreset(`${TEMPLATE}LLM_JUDGE_API_KEY=${KEY_VALUE}\n`, 'LLM_MODEL=m\n')).toThrow(/LLM_JUDGE_API_KEY/);
  });

  it('works on a template with Windows line endings', () => {
    const { text } = applyPreset(TEMPLATE.replace(/\n/g, '\r\n'), 'LLM_MODEL=m\r\n');
    expect(text).not.toContain('\r');
    expect(text).toContain('LLM_MODEL=m\n');
  });
});

describe('line endings and modes', () => {
  it('fixLineEndings gives clean LF or CRLF from any mix', () => {
    expect(fixLineEndings('a\r\nb\nc\rd', 'lf')).toBe('a\nb\nc\nd');
    expect(fixLineEndings('a\r\nb\nc', 'crlf')).toBe('a\r\nb\r\nc');
    expect(fixLineEndings('a\r\nb', 'crlf')).toBe('a\r\nb');
  });

  it('picks the style per file: CRLF for .cmd, LF for .command, .mjs and the Mac text files', () => {
    expect(lineEndingStyleFor('Start live demo.cmd', 'win32')).toBe('crlf');
    expect(lineEndingStyleFor('Start live demo.command', 'darwin')).toBe('lf');
    expect(lineEndingStyleFor('launcher/bundle/launcher.mjs', 'win32')).toBe('lf');
    expect(lineEndingStyleFor('READ ME FIRST.txt', 'darwin')).toBe('lf');
    expect(lineEndingStyleFor('my-settings.env', 'darwin')).toBe('lf');
  });

  it('gives the Windows copies of the readme and the settings CRLF so Notepad shows them', () => {
    expect(lineEndingStyleFor('READ ME FIRST.txt', 'win32')).toBe('crlf');
    expect(lineEndingStyleFor('my-settings.env', 'win32')).toBe('crlf');
  });

  it('leaves the app, the runtimes and the data alone', () => {
    expect(lineEndingStyleFor('app/server.js', 'darwin')).toBeNull();
    expect(lineEndingStyleFor('app/agents/notes.txt', 'win32')).toBeNull();
    expect(lineEndingStyleFor('runtime/darwin-arm64/LICENSE', 'darwin')).toBeNull();
    expect(lineEndingStyleFor('data/demo.log', 'darwin')).toBeNull();
    expect(lineEndingStyleFor('app/node_modules/pkg/run.cmd', 'win32')).toBeNull();
    expect(lineEndingStyleFor('app/node_modules/pkg/run.command', 'darwin')).toBeNull();
    expect(lineEndingStyleFor('runtime/win32-x64/readme.txt', 'win32')).toBeNull();
  });

  it('modes: 755 for the starters and runtime binaries, 644 for everything else', () => {
    expect(modeFor('Start live demo.command')).toBe(0o755);
    expect(modeFor('runtime/darwin-arm64/bin/node')).toBe(0o755);
    expect(modeFor('runtime/darwin-x64/bin/node')).toBe(0o755);
    expect(modeFor('runtime/win32-x64/node.exe')).toBe(0o644);
    expect(modeFor('Start live demo.cmd')).toBe(0o644);
    expect(modeFor('READ ME FIRST.txt')).toBe(0o644);
    expect(modeFor('launcher/bundle/launcher.mjs')).toBe(0o644);
    expect(modeFor('app/node_modules/x/run.command')).toBe(0o644);
    expect(modeFor('app/server.js')).toBe(0o644);
  });

  it('normalizeTree applies modes and line endings on disk, and leaves the app text untouched', () => {
    const root = put(temp(), {
      'Start live demo.command': '#!/bin/sh\r\necho hi\r\n',
      'Start live demo.cmd': '@echo off\necho hi\n',
      'my-settings.env': 'A=1\nB=2\n',
      'launcher/bundle/launcher.mjs': 'a\r\nb\r\n',
      'app/server.js': 'x\r\ny\r\n',
      'runtime/darwin-arm64/bin/node': 'binary',
    });
    chmodSync(join(root, 'app/server.js'), 0o600);

    const win = normalizeTree(root, 'win32');
    expect(win.rewritten).toBe(4);
    expect(readFileSync(join(root, 'Start live demo.command'), 'utf8')).toBe('#!/bin/sh\necho hi\n');
    expect(readFileSync(join(root, 'Start live demo.cmd'), 'utf8')).toBe('@echo off\r\necho hi\r\n');
    expect(readFileSync(join(root, 'my-settings.env'), 'utf8')).toBe('A=1\r\nB=2\r\n');
    expect(readFileSync(join(root, 'launcher/bundle/launcher.mjs'), 'utf8')).toBe('a\nb\n');
    expect(readFileSync(join(root, 'app/server.js'), 'utf8')).toBe('x\r\ny\r\n');
    expect(statSync(join(root, 'Start live demo.command')).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, 'runtime/darwin-arm64/bin/node')).mode & 0o777).toBe(0o755);
    expect(statSync(join(root, 'app/server.js')).mode & 0o777).toBe(0o644);
    expect(statSync(join(root, 'app')).mode & 0o777).toBe(0o755);
  });
});

describe('scanStagedTree: each rule fails on its fixture and passes on a clean one', () => {
  const rules = (root: string, denyTerms: string[] = []) => scanStagedTree(root, { denyTerms }).map((f) => `${f.file}:${f.rule}`);

  it('passes a clean tree, including my-settings.env, empty key lines and ordinary code', () => {
    const root = put(temp(), {
      'my-settings.env': 'LLM_API_KEY=\nLLM_JUDGE_API_KEY=\nLLM_API_KEY_HEADER=api-key\n',
      'app/server.js': 'const key = process.env.LLM_API_KEY; const url = "/Users/";',
      'app/node_modules/pkg/index.js': 'LLM_API_KEY = process.env.SOMETHING_LONG_ENOUGH_TO_LOOK_LIKE_A_KEY',
      'Start demo.cmd': '@echo off\r\necho plain ascii\r\n',
    });
    expect(rules(root)).toEqual([]);
  });

  it('lists every rule it can report', () => {
    expect([...SCAN_RULES].sort()).toEqual(
      ['api-key-value', 'build-path', 'database-file', 'deny-list', 'env-file', 'git-file', 'home-path', 'key-file', 'non-ascii-cmd', 'symlink', 'unusual-file'].sort(),
    );
  });

  it('env-file: a file named .env*', () => {
    expect(rules(put(temp(), { 'app/.env.local': 'A=1' }))).toEqual(['app/.env.local:env-file']);
    expect(rules(put(temp(), { 'app/env.example': 'A=1' }))).toEqual([]);
  });

  it('database-file: *.db and its sidecar files', () => {
    expect(rules(put(temp(), { 'data/demo.db': 'x', 'data/demo.db-wal': 'x' }))).toEqual(['data/demo.db:database-file', 'data/demo.db-wal:database-file']);
    expect(rules(put(temp(), { 'data/db.txt': 'x', 'data/dbfile': 'x' }))).toEqual([]);
  });

  it('key-file: *.pem and *.key', () => {
    expect(rules(put(temp(), { 'a/cert.pem': 'x', 'a/server.key': 'x' }))).toEqual(['a/cert.pem:key-file', 'a/server.key:key-file']);
    expect(rules(put(temp(), { 'a/keyboard.js': 'x', 'a/pem.txt': 'x' }))).toEqual([]);
  });

  it('git-file: .git*, a folder or a file', () => {
    expect(rules(put(temp(), { 'a/.gitignore': 'x' }))).toEqual(['a/.gitignore:git-file']);
    expect(rules(put(temp(), { 'a/.git/config': 'x' }))).toEqual(['a/.git:git-file']);
    expect(rules(put(temp(), { 'a/digit.js': 'x' }))).toEqual([]);
  });

  it('home-path: a Mac home path or a Windows one in a text file', () => {
    expect(rules(put(temp(), { 'a.json': `{"dir":"${homePath('proj')}"}` }))).toEqual(['a.json:home-path']);
    expect(rules(put(temp(), { 'b.txt': `see ${winHomePath()}` }))).toEqual(['b.txt:home-path']);
    expect(rules(put(temp(), { 'b.txt': `see ${winHomePath().replace(/\\/g, '/')}` }))).toEqual(['b.txt:home-path']);
    expect(rules(put(temp(), { 'c.txt': 'plain /usr/local/bin and /Users/ alone' }))).toEqual([]);
  });

  it('home-path: not applied to third-party code (app/node_modules and the app/.next-* build output), where packages keep example paths in comments', () => {
    const example = '// e.g. "/Users/foo/APP/.next/server/chunk.js" or C:\\Users\\foo\\APP';
    expect(rules(put(temp(), { 'app/node_modules/next/dist/server/patch-error-inspect.js': example }))).toEqual([]);
    expect(rules(put(temp(), { 'app/.next-bundle/server/chunks/a.js': example }))).toEqual([]);
    expect(rules(put(temp(), { 'app/.next/server/a.js': example }))).toEqual([]);
    // the same text in anything we wrote ourselves is still refused
    expect(rules(put(temp(), { 'app/server.js': example }))).toEqual(['app/server.js:home-path']);
    expect(rules(put(temp(), { 'launcher/bundle/launcher.mjs': example }))).toEqual(['launcher/bundle/launcher.mjs:home-path']);
    // and the exemption is the whole folder name, not a prefix of it
    expect(rules(put(temp(), { 'app/node_modules_extra/a.js': example }))).toEqual(['app/node_modules_extra/a.js:home-path']);
    expect(rules(put(temp(), { 'app/.nextx/a.js': example }))).toEqual(['app/.nextx/a.js:home-path']);
  });

  it("build-path: this machine's own folders are refused everywhere, third-party code included, and never printed", () => {
    const mine = '/Volumes/work/someone';
    const findings = (root: string, buildPaths: string[] = [mine]) => scanStagedTree(root, { buildPaths });
    const inPackage = put(temp(), { 'app/node_modules/pkg/index.js': `const dir = "${mine}/project";` });
    expect(findings(inPackage).map((f) => `${f.file}:${f.rule}`)).toEqual(['app/node_modules/pkg/index.js:build-path']);
    expect(findings(put(temp(), { 'app/.next-bundle/required.json': `{"root":"${mine.toUpperCase()}/x"}` })).map((f) => f.rule)).toEqual(['build-path']);
    expect(JSON.stringify(findings(inPackage))).not.toContain('someone');
    expect(findings(put(temp(), { 'app/a.js': 'const dir = "/Volumes/elsewhere/x";' }))).toEqual([]);
  });

  it('build-path: a path that is too short to mean anything ("/", "") matches nothing', () => {
    const root = put(temp(), { 'a.txt': 'plain text with / slashes /usr/local and more' });
    expect(scanStagedTree(root, { buildPaths: ['/', '', '/usr'] })).toEqual([]);
  });

  it('home-path: skipped inside a binary file', () => {
    const root = temp();
    writeFileSync(join(root, 'node'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(homePath('x'))]));
    expect(rules(root)).toEqual([]);
  });

  it('api-key-value: a long key-like value assigned to either key name', () => {
    expect(rules(put(temp(), { 'a.env': `LLM_API_KEY=${KEY_VALUE}\n` }))).toEqual(['a.env:api-key-value']);
    expect(rules(put(temp(), { 'b.env': `LLM_JUDGE_API_KEY="${KEY_VALUE}"\n` }))).toEqual(['b.env:api-key-value']);
    expect(rules(put(temp(), { 'c.json': `{"LLM_API_KEY": "${KEY_VALUE}"}` }))).toEqual(['c.json:api-key-value']);
    expect(rules(put(temp(), { 'd.env': '# LLM_API_KEY=' + KEY_VALUE }))).toEqual(['d.env:api-key-value']);
  });

  it('api-key-value: not a short value, a placeholder without digits, the header name or code', () => {
    expect(KEY_ASSIGNMENT.test('LLM_API_KEY=short1')).toBe(false);
    expect(KEY_ASSIGNMENT.test('LLM_API_KEY=your-key-goes-here-please')).toBe(false);
    expect(KEY_ASSIGNMENT.test(`LLM_API_KEY_HEADER=${KEY_VALUE}`)).toBe(false);
    expect(KEY_ASSIGNMENT.test('LLM_API_KEY = process.env.LLM_API_KEY_2')).toBe(false);
  });

  it('non-ascii-cmd: a .cmd with a non-ASCII character (cmd.exe reads the OEM code page)', () => {
    expect(rules(put(temp(), { 'Go.cmd': '@echo off\r\necho café\r\n' }))).toEqual(['Go.cmd:non-ascii-cmd']);
    expect(rules(put(temp(), { 'Go.txt': 'café' }))).toEqual([]);
  });

  it('symlink: a link is refused (zip would follow it out of the tree)', () => {
    const root = put(temp(), { 'a.txt': 'x' });
    symlinkSync('/etc', join(root, 'link'));
    expect(rules(root)).toEqual(['link:symlink']);
  });

  it('deny-list: a term in a file name or in text, case-insensitive, and the finding never carries the term', () => {
    const root = put(temp(), { 'notes.txt': 'Contact ACME-Corp today', 'acme-corp-plan.md': 'x', 'ok.txt': 'fine' });
    const findings = scanStagedTree(root, { denyTerms: ['acme-corp'] });
    expect(findings.map((f) => `${f.file}:${f.rule}`).sort()).toEqual(['acme-corp-plan.md:deny-list', 'notes.txt:deny-list']);
    expect(JSON.stringify(findings)).not.toContain('Contact');
    expect(rules(put(temp(), { 'ok.txt': 'fine' }), ['acme-corp'])).toEqual([]);
  });

  it('parseDenyList skips blanks and comments and lowercases', () => {
    expect(parseDenyList('# note\n\n  Acme-Corp \nOther\r\n')).toEqual(['acme-corp', 'other']);
  });

  it('reports a file once per rule even when the rule matches twice', () => {
    const root = put(temp(), { 'a.txt': `${homePath('a')} ${homePath('b')}` });
    expect(rules(root)).toEqual(['a.txt:home-path']);
  });
});

describe('zipProblems: the check of a finished ZIP', () => {
  const manifest = parseRuntimes(JSON.parse(readFileSync(join(HERE, 'node-runtimes.json'), 'utf8')));
  const EXEC = '-rwxr-xr-x';
  const PLAIN = '-rw-r--r--';
  const entriesFor = (target: 'mac' | 'windows') => runtimesFor(manifest, TARGETS[target].platform);
  const row = (perms: string, name: string) => `${perms}  3.0 unx      100 b- defN 26-Oct-21 11:00 ${name}`;
  /** The text `unzip -Z` prints for a ZIP that has every required member with the right mode. */
  function listing(target: 'mac' | 'windows', change: (rows: Map<string, string>) => void = () => {}, extra: string[] = []) {
    const rows = new Map<string, string>();
    for (const name of requiredMembers(target, entriesFor(target))) rows.set(name, modeFor(name) === 0o755 ? EXEC : PLAIN);
    change(rows);
    return [
      'Archive:  x.zip',
      'Zip file size: 1 bytes, number of entries: 9',
      row('drwxr-xr-x', 'HybridDemo/'),
      ...[...rows].map(([name, perms]) => row(perms, `HybridDemo/${name}`)),
      ...extra,
      '9 files, 1 bytes uncompressed, 1 bytes compressed:  0.0%',
    ].join('\n');
  }
  const problems = (target: 'mac' | 'windows', text: string) => zipProblems(text, { target, runtimeEntries: entriesFor(target) });

  it('a complete ZIP has no problems, for either target', () => {
    expect(problems('mac', listing('mac'))).toEqual([]);
    expect(problems('windows', listing('windows'))).toEqual([]);
  });

  it('requiredMembers: starters, readme, settings, launcher files, server and the runtimes of that target only', () => {
    const mac = requiredMembers('mac', entriesFor('mac'));
    const win = requiredMembers('windows', entriesFor('windows'));
    expect(mac).toEqual(expect.arrayContaining([...STARTER_NAMES.mac, 'READ ME FIRST.txt', 'my-settings.env', 'app/server.js', 'runtime/darwin-arm64/bin/node', 'runtime/darwin-x64/bin/node']));
    expect(win).toEqual(expect.arrayContaining([...STARTER_NAMES.windows, 'READ ME FIRST.txt', 'my-settings.env', 'app/server.js', 'runtime/win32-x64/node.exe']));
    for (const [, destination] of LAUNCHER_FILES) expect(mac).toContain(destination);
    expect(mac.some((name) => name.includes('win32') || name.endsWith('.cmd'))).toBe(false);
    expect(win.some((name) => name.includes('darwin') || name.endsWith('.command'))).toBe(false);
  });

  it('names a missing member', () => {
    expect(problems('mac', listing('mac', (rows) => rows.delete('app/server.js')))).toEqual(['app/server.js is missing from the ZIP.']);
    expect(problems('mac', listing('mac', (rows) => rows.delete('runtime/darwin-x64/bin/node')))).toEqual(['runtime/darwin-x64/bin/node is missing from the ZIP.']);
    expect(problems('windows', listing('windows', (rows) => rows.delete('Stop demo.cmd')))).toEqual(['Stop demo.cmd is missing from the ZIP.']);
  });

  it('a Mac starter or Mac runtime that is not executable is a problem (a double-click would do nothing)', () => {
    expect(problems('mac', listing('mac', (rows) => rows.set('Start live demo.command', PLAIN)))).toEqual(['Start live demo.command is not executable in the ZIP.']);
    expect(problems('mac', listing('mac', (rows) => rows.set('runtime/darwin-arm64/bin/node', PLAIN)))).toEqual(['runtime/darwin-arm64/bin/node is not executable in the ZIP.']);
  });

  it('the Windows ZIP needs no executable bits', () => {
    expect(problems('windows', listing('windows', (rows) => rows.set('runtime/win32-x64/node.exe', PLAIN)))).toEqual([]);
  });

  it('anything outside the one top folder is a problem', () => {
    const text = listing('mac', () => {}, [row(PLAIN, 'Other/notes.txt')]);
    expect(problems('mac', text)).toEqual(['Other/notes.txt is outside the HybridDemo folder.']);
  });

  it('an empty or unreadable listing is a problem, not a pass', () => {
    expect(problems('mac', '')).toEqual(['the ZIP holds no files or could not be read.']);
    expect(problems('mac', 'Archive:  x.zip\nsome error text\n')).toEqual(['the ZIP holds no files or could not be read.']);
  });

  it('reports a long list of problems in short form', () => {
    const text = listing('mac', (rows) => {
      for (const name of [...rows.keys()]) if (name !== 'my-settings.env') rows.delete(name);
    });
    const found = problems('mac', text);
    expect(found).toHaveLength(11);
    expect(found[10]).toBe('and 1 more.');
  });
});

describe.skipIf(!HAS_TOOLS)('with the system archive tools', () => {
  const NODE = 'node-v24.21.0-darwin-arm64';
  const WIN = 'node-v24.21.0-win-x64';

  /** Tiny stand-ins shaped like the official archives. Returns the cache folder and the manifest. */
  function fakeCache() {
    const work = temp();
    const cache = join(work, 'cache');
    mkdirSync(cache);
    for (const arch of ['arm64', 'x64']) {
      const base = `node-v24.21.0-darwin-${arch}`;
      put(join(work, 'src'), { [`${base}/bin/node`]: `node ${arch}`, [`${base}/LICENSE`]: 'license', [`${base}/include/big.h`]: 'not kept' });
      spawnSync('tar', ['-czf', join(cache, `${base}.tar.gz`), base], { cwd: join(work, 'src') });
    }
    put(join(work, 'src'), { [`${WIN}/node.exe`]: 'MZ', [`${WIN}/LICENSE`]: 'license', [`${WIN}/npm.cmd`]: 'not kept' });
    spawnSync('zip', ['-q', '-r', join(cache, `${WIN}.zip`), WIN], { cwd: join(work, 'src') });
    const files = [
      { platform: 'darwin', arch: 'arm64', file: `${NODE}.tar.gz` },
      { platform: 'darwin', arch: 'x64', file: 'node-v24.21.0-darwin-x64.tar.gz' },
      { platform: 'win32', arch: 'x64', file: `${WIN}.zip` },
    ].map((f) => ({ ...f, sha256: sha(readFileSync(join(cache, f.file))) }));
    return { cache, manifest: parseRuntimes({ version: 'v24.21.0', files }) };
  }

  it('extractRuntime keeps only the binary and the LICENSE, for the Mac and for Windows', () => {
    const { cache, manifest } = fakeCache();
    const top = join(temp(), 'HybridDemo');
    for (const entry of manifest.files) {
      extractRuntime({ entry, archivePath: join(cache, entry.file), topDir: top, scratchRoot: join(temp(), 's') });
    }
    expect(readFileSync(join(top, 'runtime/darwin-arm64/bin/node'), 'utf8')).toBe('node arm64');
    expect(readFileSync(join(top, 'runtime/darwin-x64/bin/node'), 'utf8')).toBe('node x64');
    expect(readFileSync(join(top, 'runtime/win32-x64/node.exe'), 'utf8')).toBe('MZ');
    expect(existsSync(join(top, 'runtime/win32-x64/LICENSE'))).toBe(true);
    expect(existsSync(join(top, 'runtime/darwin-arm64/include'))).toBe(false);
    expect(existsSync(join(top, 'runtime/win32-x64/npm.cmd'))).toBe(false);
  });

  it('extractRuntime says so when the archive lacks the binary', () => {
    const work = temp();
    put(join(work, 'src'), { [`${NODE}/LICENSE`]: 'l' });
    spawnSync('tar', ['-czf', join(work, 'a.tar.gz'), NODE], { cwd: join(work, 'src') });
    const entry = { platform: 'darwin' as const, arch: 'arm64' as const, file: `${NODE}.tar.gz`, sha256: sha('x') };
    expect(() => extractRuntime({ entry, archivePath: join(work, 'a.tar.gz'), topDir: join(work, 'top'), scratchRoot: join(work, 's') })).toThrow(/could not unpack/);
  });

  it('makeZip keeps the 755 mode of a starter and has one top folder', () => {
    const stage = put(temp(), { 'HybridDemo/Start.command': '#!/bin/sh\n', 'HybridDemo/READ ME FIRST.txt': 'hi' });
    chmodSync(join(stage, 'HybridDemo/Start.command'), 0o755);
    chmodSync(join(stage, 'HybridDemo/READ ME FIRST.txt'), 0o644);
    const zipPath = join(temp(), 'x.zip');
    makeZip({ stageRoot: stage, zipPath });
    const listing = spawnSync('unzip', ['-Z', zipPath], { encoding: 'utf8' }).stdout;
    expect(listing).toMatch(/-rwxr-xr-x.*HybridDemo\/Start\.command/);
    expect(listing).toMatch(/-rw-r--r--.*HybridDemo\/READ ME FIRST\.txt/);
    const names = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(names.every((n) => n.startsWith('HybridDemo/'))).toBe(true);
  });

  it('makeZip adds no extra attributes (-X): no extended timestamp field ("UT") in the archive', () => {
    const stage = put(temp(), { 'HybridDemo/a.txt': 'hi' });
    const zipPath = join(temp(), 'x.zip');
    makeZip({ stageRoot: stage, zipPath });
    expect(readFileSync(zipPath).includes(Buffer.from('UT'))).toBe(false);
  });

  it('listZip and zipProblems read a real ZIP: a good one passes, a starter that lost its executable bit fails', () => {
    const manifest = parseRuntimes(JSON.parse(readFileSync(join(HERE, 'node-runtimes.json'), 'utf8')));
    const entries = runtimesFor(manifest, 'darwin');
    const stage = temp();
    for (const name of requiredMembers('mac', entries)) {
      put(join(stage, 'HybridDemo'), { [name]: 'x' });
      chmodSync(join(stage, 'HybridDemo', name), modeFor(name));
    }
    const good = join(temp(), 'good.zip');
    makeZip({ stageRoot: stage, zipPath: good });
    expect(zipProblems(listZip(good), { target: 'mac', runtimeEntries: entries })).toEqual([]);

    chmodSync(join(stage, 'HybridDemo/Stop demo.command'), 0o644);
    const bad = join(temp(), 'bad.zip');
    makeZip({ stageRoot: stage, zipPath: bad });
    expect(zipProblems(listZip(bad), { target: 'mac', runtimeEntries: entries })).toEqual(['Stop demo.command is not executable in the ZIP.']);
  });

  it('listZip says so when the file is not a ZIP', () => {
    const dir = put(temp(), { 'not.zip': 'plain text' });
    expect(() => listZip(join(dir, 'not.zip'))).toThrow(/could not read/);
  });

  describe('runBuild, end to end with a fake app', () => {
    const SOURCES: Record<string, string> = {
      'scripts/bundle/launcher.mjs': 'export {};\r\n',
      'scripts/bundle/launcher-lib.mjs': 'export {};\n',
      'scripts/demo/demo-lib.mjs': 'export {};\n',
      'scripts/fake-llm.mjs': 'export {};\n',
      'scripts/bundle/starters/READ-ME-FIRST.mac.txt': 'mac readme\r\n',
      'scripts/bundle/starters/READ-ME-FIRST.windows.txt': 'windows readme\n',
      'scripts/bundle/starters/my-settings.template.env': '# Header\n\nLLM_BASE_URL=\nLLM_API_KEY=\nLLM_MODEL=\nLLM_API_KEY_HEADER=\nLLM_MAX_TOKENS=\n',
      'scripts/bundle/starters/mac/Start practice demo.command': '#!/bin/sh\r\necho practice\r\n',
      'scripts/bundle/starters/mac/Start live demo.command': '#!/bin/sh\necho live\n',
      'scripts/bundle/starters/mac/Stop demo.command': '#!/bin/sh\necho stop\n',
      'scripts/bundle/starters/windows/Start practice demo.cmd': '@echo off\necho practice\n',
      'scripts/bundle/starters/windows/Start live demo.cmd': '@echo off\necho live\n',
      'scripts/bundle/starters/windows/Stop demo.cmd': '@echo off\necho stop\n',
    };

    function setup(extra: Record<string, string> = {}) {
      const repo = temp();
      const appDir = join(repo, 'outputs/05_demo/app');
      put(appDir, { ...SOURCES, ...extra });
      const { cache, manifest } = fakeCache();
      const out = join(temp(), 'out');
      const logs: string[] = [];
      const assemble = async ({ outDir }: { outDir: string }) => {
        put(join(outDir, 'app'), { 'server.js': 'console.log(1)', 'package.json': '{}', '.next/static/a.js': 'x', 'evals/packs/practice-01/case.json': '{}' });
      };
      const options = { out, cache, preset: null, only: null, skipBuild: false, denyList: null };
      const deps = { appDir, repoRoot: repo, manifest, assemble, log: (line: string) => logs.push(line) };
      return { repo, appDir, out, cache, logs, options, deps };
    }
    const list = (zip: string) => spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.trim().split('\n');
    const extract = (zip: string, member: string) => spawnSync('unzip', ['-p', zip, member], { encoding: 'buffer' }).stdout.toString('utf8');

    it('builds both ZIPs with the contract layout, modes and line endings, plus SHA256SUMS.txt', async () => {
      const { out, options, deps } = setup();
      const { zips } = await runBuild(options, deps);
      expect(zips.map((z) => z.name)).toEqual(['HybridTeamDemo-mac.zip', 'HybridTeamDemo-windows.zip']);

      const mac = list(join(out, 'HybridTeamDemo-mac.zip'));
      for (const name of [
        'READ ME FIRST.txt',
        'my-settings.env',
        'Start practice demo.command',
        'Start live demo.command',
        'Stop demo.command',
        'runtime/darwin-arm64/bin/node',
        'runtime/darwin-x64/bin/node',
        'launcher/bundle/launcher.mjs',
        'launcher/bundle/launcher-lib.mjs',
        'launcher/demo/demo-lib.mjs',
        'launcher/fake-llm.mjs',
        'app/server.js',
        'app/.next/static/a.js',
        'app/evals/packs/practice-01/case.json',
      ]) {
        expect(mac).toContain(`HybridDemo/${name}`);
      }
      expect(mac.some((n) => n.endsWith('.cmd') || n.includes('win32'))).toBe(false);
      expect(mac.every((n) => n.startsWith('HybridDemo/'))).toBe(true);

      const win = list(join(out, 'HybridTeamDemo-windows.zip'));
      expect(win).toContain('HybridDemo/runtime/win32-x64/node.exe');
      expect(win).toContain('HybridDemo/Start live demo.cmd');
      expect(win.some((n) => n.endsWith('.command') || n.includes('darwin'))).toBe(false);

      const macListing = spawnSync('unzip', ['-Z', join(out, 'HybridTeamDemo-mac.zip')], { encoding: 'utf8' }).stdout;
      expect(macListing).toMatch(/-rwxr-xr-x.*Start live demo\.command/);
      expect(macListing).toMatch(/-rwxr-xr-x.*runtime\/darwin-arm64\/bin\/node/);
      expect(macListing).toMatch(/-rw-r--r--.*READ ME FIRST\.txt/);

      expect(extract(join(out, 'HybridTeamDemo-mac.zip'), 'HybridDemo/Start practice demo.command')).toBe('#!/bin/sh\necho practice\n');
      expect(extract(join(out, 'HybridTeamDemo-mac.zip'), 'HybridDemo/READ ME FIRST.txt')).toBe('mac readme\n');
      expect(extract(join(out, 'HybridTeamDemo-windows.zip'), 'HybridDemo/Start live demo.cmd')).toBe('@echo off\r\necho live\r\n');
      expect(extract(join(out, 'HybridTeamDemo-windows.zip'), 'HybridDemo/READ ME FIRST.txt')).toBe('windows readme\r\n');
      expect(extract(join(out, 'HybridTeamDemo-windows.zip'), 'HybridDemo/my-settings.env')).toContain('LLM_API_KEY=\r\n');
      expect(extract(join(out, 'HybridTeamDemo-mac.zip'), 'HybridDemo/launcher/bundle/launcher.mjs')).toBe('export {};\n');

      const sums = readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
      expect(sums).toEqual(zips.map((z) => `${z.sha256}  ${z.name}`));
      expect(zips[0].sha256).toBe(sha(readFileSync(join(out, zips[0].name))));
      expect(readdirSync(out).filter((n) => n.startsWith('.stage'))).toEqual([]);
    });

    it('--only builds one ZIP', async () => {
      const { out, options, deps } = setup();
      await runBuild({ ...options, only: 'windows' }, deps);
      expect(readdirSync(out).filter((n) => n.endsWith('.zip'))).toEqual(['HybridTeamDemo-windows.zip']);
    });

    it('a preset prefills the non-secret lines in the settings file of both ZIPs', async () => {
      const { out, options, deps } = setup();
      const preset = join(temp(), 'preset.env');
      writeFileSync(preset, '# Team gateway\nLLM_BASE_URL=https://gateway.example/v1\nLLM_MODEL=some-model\n');
      await runBuild({ ...options, preset }, deps);
      const text = extract(join(out, 'HybridTeamDemo-mac.zip'), 'HybridDemo/my-settings.env');
      expect(text).toContain('LLM_BASE_URL=https://gateway.example/v1\n');
      expect(text).toContain('# Notes from the person who prepared this\n# Team gateway\n');
      expect(text).toContain('LLM_API_KEY=\n');
    });

    it('a settings template that holds a key stops the build even without a preset', async () => {
      const { options, deps } = setup({ 'scripts/bundle/starters/my-settings.template.env': `LLM_API_KEY=${KEY_VALUE}\n` });
      await expect(runBuild(options, deps)).rejects.toThrow(/LLM_API_KEY must stay empty/);
    });

    it('a preset with a key stops the build before anything is built or written', async () => {
      const { out, options, deps } = setup();
      const preset = join(temp(), 'preset.env');
      writeFileSync(preset, `LLM_API_KEY=${KEY_VALUE}\n`);
      await expect(runBuild({ ...options, preset }, deps)).rejects.toThrow(/LLM_API_KEY/);
      expect(existsSync(out)).toBe(false);
    });

    it('a scan hit stops the build: no ZIP, no checksum file, no stage folder, and the message names no matched text', async () => {
      const { out, options, deps } = setup();
      const leaky = async ({ outDir }: { outDir: string }) => {
        put(join(outDir, 'app'), { 'server.js': `const dir = "${homePath('x')}"`, '.env.local': 'A=1' });
      };
      let message = '';
      try {
        await runBuild(options, { ...deps, assemble: leaky });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/app\/server\.js {2}\(home-path\)/);
      expect(message).toMatch(/app\/\.env\.local {2}\(env-file\)/);
      expect(message).not.toContain('someone');
      expect(readdirSync(out).filter((n) => n.endsWith('.zip') || n.startsWith('.stage') || n === 'SHA256SUMS.txt')).toEqual([]);
    });

    it('a scan hit in only one target leaves the output folder exactly as it was (no half-new set of ZIPs)', async () => {
      const { out, options, deps } = setup({ 'scripts/bundle/starters/windows/Start live demo.cmd': '@echo off\r\necho café\r\n' });
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'HybridTeamDemo-mac.zip'), 'old mac zip');
      writeFileSync(join(out, 'SHA256SUMS.txt'), 'old sums\n');
      await expect(runBuild(options, deps)).rejects.toThrow(/Start live demo\.cmd {2}\(non-ascii-cmd\)/);
      expect(readFileSync(join(out, 'HybridTeamDemo-mac.zip'), 'utf8')).toBe('old mac zip');
      expect(readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8')).toBe('old sums\n');
      expect(existsSync(join(out, 'HybridTeamDemo-windows.zip'))).toBe(false);
    });

    it('a ZIP that fails the final check is never published, and the older set stays', async () => {
      const { out, options, deps } = setup();
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'SHA256SUMS.txt'), 'old sums\n');
      const incomplete = ({ zipPath }: { stageRoot: string; zipPath: string }) => {
        makeZip({ stageRoot: put(temp(), { 'HybridDemo/only.txt': 'x' }), zipPath });
      };
      await expect(runBuild(options, { ...deps, makeZip: incomplete })).rejects.toThrow(/HybridTeamDemo-mac\.zip failed the final check[\s\S]*is missing from the ZIP/);
      expect(readdirSync(out).filter((n) => n.endsWith('.zip'))).toEqual([]);
      expect(readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8')).toBe('old sums\n');
      expect(readdirSync(out).filter((n) => n.startsWith('.stage'))).toEqual([]);
    });

    it('calls the payload step with exactly the contract arguments, into <out>/.payload', async () => {
      const { out, appDir, repo, options, deps } = setup();
      let seen: Record<string, unknown> = {};
      await runBuild(options, {
        ...deps,
        assemble: async (args: { outDir: string }) => {
          seen = { ...args };
          put(join(args.outDir, 'app'), { 'server.js': 'x' });
        },
      });
      expect(Object.keys(seen).sort()).toEqual(['appDir', 'distDir', 'log', 'outDir', 'repoRoot']);
      expect(seen).toMatchObject({ appDir, repoRoot: repo, outDir: join(out, '.payload'), distDir: '.next-bundle' });
    });

    it('says the payload step is missing when its own module cannot be found', async () => {
      const { options, deps } = setup();
      const missing = async () => {
        throw Object.assign(new Error("Cannot find module '/x/assemble-payload.mjs' imported from /x/build-bundles.mjs"), { code: 'ERR_MODULE_NOT_FOUND' });
      };
      await expect(runBuild(options, { ...deps, assemble: undefined, loadAssemble: missing })).rejects.toThrow(/assemble-payload\.mjs is missing/);
    });

    it('does not blame the payload step file when one of its own imports is missing', async () => {
      const { options, deps } = setup();
      const brokenImport = async () => {
        throw Object.assign(new Error("Cannot find package 'zzz' imported from /x/assemble-payload.mjs"), { code: 'ERR_MODULE_NOT_FOUND' });
      };
      await expect(runBuild(options, { ...deps, assemble: undefined, loadAssemble: brokenImport })).rejects.toThrow(/Cannot find package 'zzz'/);
    });

    it.each(['home', 'repository', 'output', 'cache'])("the build refuses a payload that carries this machine's %s folder, even inside a package, and never prints it", async (which) => {
      const { repo, out, cache, options, deps } = setup();
      const home = join(temp(), 'home-of-someone');
      const leaked = { home, repository: repo, output: out, cache }[which] as string;
      const leaky = async ({ outDir }: { outDir: string }) => {
        put(join(outDir, 'app'), { 'server.js': 'x', 'node_modules/pkg/config.json': JSON.stringify({ root: `${leaked}/sub` }) });
      };
      let message = '';
      try {
        await runBuild(options, { ...deps, homeDir: home, assemble: leaky });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/app\/node_modules\/pkg\/config\.json {2}\(build-path\)/);
      expect(message).not.toContain(leaked);
    });

    it('a deny-list term stops the build', async () => {
      const { options, deps } = setup();
      const denyList = join(temp(), 'deny.txt');
      writeFileSync(denyList, 'readme\n');
      await expect(runBuild({ ...options, denyList }, deps)).rejects.toThrow(/\(deny-list\)/);
    });

    it('refuses a cached archive that does not match its pinned hash', async () => {
      const { cache, options, deps, out } = setup();
      writeFileSync(join(cache, 'node-v24.21.0-win-x64.zip'), 'tampered');
      await expect(runBuild(options, deps)).rejects.toThrow(/pinned hash/);
      expect(existsSync(join(out, 'HybridTeamDemo-mac.zip'))).toBe(false);
    });

    it('lists missing source files up front, before any build', async () => {
      const { appDir, options, deps } = setup();
      rmSync(join(appDir, 'scripts/fake-llm.mjs'));
      let built = false;
      await expect(
        runBuild(options, {
          ...deps,
          assemble: async () => {
            built = true;
          },
        }),
      ).rejects.toThrow(/scripts\/fake-llm\.mjs/);
      expect(built).toBe(false);
    });

    it('refuses an output or cache folder inside the repository', async () => {
      const { repo, options, deps } = setup();
      await expect(runBuild({ ...options, out: join(repo, 'dist') }, deps)).rejects.toThrow(/outside the repository/);
      await expect(runBuild({ ...options, cache: join(repo, 'cache') }, deps)).rejects.toThrow(/cache folder must be outside/);
    });

    it('--skip-build reuses the earlier app and does not call the build; with nothing to reuse it says so', async () => {
      const { options, deps, out } = setup();
      await expect(runBuild({ ...options, skipBuild: true }, deps)).rejects.toThrow(/nothing to reuse|no assembled app to reuse/);
      await runBuild(options, deps);
      let calls = 0;
      await runBuild(
        { ...options, skipBuild: true },
        {
          ...deps,
          assemble: async () => {
            calls += 1;
          },
        },
      );
      expect(calls).toBe(0);
      expect(existsSync(join(out, 'HybridTeamDemo-mac.zip'))).toBe(true);
    });

    it('starts each build from an empty payload folder, so nothing stale ships', async () => {
      const { options, deps, out } = setup();
      await runBuild(options, {
        ...deps,
        assemble: async ({ outDir }: { outDir: string }) => {
          put(join(outDir, 'app'), { 'server.js': 'x', 'stale.txt': 'old' });
        },
      });
      expect(list(join(out, 'HybridTeamDemo-mac.zip'))).toContain('HybridDemo/app/stale.txt');
      await runBuild(options, deps);
      expect(list(join(out, 'HybridTeamDemo-mac.zip'))).not.toContain('HybridDemo/app/stale.txt');
    });

    it('accepts a payload step that puts server.js directly in the folder it was given', async () => {
      const { options, deps, out } = setup();
      const flat = async ({ outDir }: { outDir: string }) => {
        put(outDir, { 'server.js': 'x' });
      };
      await runBuild(options, { ...deps, assemble: flat });
      expect(list(join(out, 'HybridTeamDemo-mac.zip'))).toContain('HybridDemo/app/server.js');
    });

    it('stops with a plain message when the build produced no server.js', async () => {
      const { options, deps } = setup();
      await expect(runBuild(options, { ...deps, assemble: async () => {} })).rejects.toThrow(/no server\.js/);
    });

    it('findPayloadRoot knows both layouts and neither', () => {
      expect(findPayloadRoot(put(temp(), { 'app/server.js': 'x' }))).toMatch(/app$/);
      const flat = put(temp(), { 'server.js': 'x' });
      expect(findPayloadRoot(flat)).toBe(flat);
      expect(findPayloadRoot(temp())).toBeNull();
    });

    it('copies the launcher files named in the contract', () => {
      expect(LAUNCHER_FILES.map(([, destination]) => destination)).toEqual([
        'launcher/bundle/launcher.mjs',
        'launcher/bundle/launcher-lib.mjs',
        'launcher/demo/demo-lib.mjs',
        'launcher/fake-llm.mjs',
      ]);
    });
  });
});
