import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assemblePayload,
  buildEnv,
  collectBuildSecrets,
  findNativeBinaries,
  findSecretsInTree,
  findStandaloneRoot,
  isExcludedFromStandalone,
  isPlatformPackage,
  listAgentSpecFiles,
  measureTree,
  NEUTRAL_APP_PATH,
  scrubBuildPaths,
  stripAnswerKey,
} from './assemble-payload.mjs';

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'assemble-payload-'));
  temps.push(path);
  return path;
}

function put(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
}

const PACK = [
  '# Practice case 01: a fictional data room, and its answer key.',
  'id: practice-01',
  "as_of: '2026-10-12'",
  '',
  'documents:',
  '  - { id: DR-00, title: Index, file: dr-00-index.md }',
  '',
  'issues:',
  '  - id: PI-01',
  '    right_response: SECRET-ANSWER',
  '',
].join('\n');

/** A repo layout with an app folder, a fake standalone build output and agent specs. `nested` puts server.js below the standalone root. */
function fakeRepo(options: { nested?: string; extraStandalone?: Record<string, string> } = {}) {
  const repoRoot = temp();
  const appDir = join(repoRoot, 'outputs', '05_demo', 'app');
  const prefix = options.nested ? `${options.nested}/` : '';
  const standalone = (path: string) => `.next-bundle/standalone/${prefix}${path}`;
  put(appDir, {
    'public/avatars/reglead.svg': '<svg/>',
    'public/avatars/.DS_Store': 'x',
    'evals/packs/practice-01/pack.yaml': PACK,
    'evals/packs/practice-01/dr-00-index.md': 'index text',
    'evals/packs/other-case/pack.yaml': 'id: other',
    '.next-bundle/static/chunks/app.js': 'chunk',
    '.next-bundle/static/chunks/app.js.map': '{}',
    [standalone('server.js')]: 'require("next")',
    [standalone('package.json')]: '{"name":"hybrid-team-chat"}',
    [standalone('.next-bundle/BUILD_ID')]: 'abc',
    [standalone('.next-bundle/server/app/page.js')]: 'page',
    [standalone('.next-bundle/server/app/page.js.map')]: '{}',
    [standalone('.data/chat.db')]: 'OWNER-DATABASE',
    [standalone('.env.local')]: 'LLM_API_KEY=whatever',
    [standalone('src/server/chat/store.test.ts')]: 'test',
    [standalone('evals/packs/practice-01/pack.yaml')]: PACK,
    [standalone('public/avatars/old.svg')]: '<svg/>',
    [standalone('node_modules/next/index.js')]: 'next',
    [standalone('node_modules/next/dist/x.js.map')]: '{}',
    [standalone('node_modules/react/index.js')]: 'react',
    [standalone('node_modules/@swc/helpers/index.js')]: 'helpers',
    [standalone('node_modules/sharp/index.js')]: 'sharp',
    [standalone('node_modules/@img/sharp-darwin-arm64/lib/sharp.node')]: 'bin',
    [standalone('node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips.dylib')]: 'bin',
    [standalone('node_modules/@next/swc-darwin-arm64/next-swc.node')]: 'bin',
  });
  if (options.extraStandalone) put(appDir, Object.fromEntries(Object.entries(options.extraStandalone).map(([k, v]) => [standalone(k), v])));
  put(repoRoot, {
    'outputs/04_agents/README.md': 'authoring guide',
    'outputs/04_agents/reglead.md': 'spec 1',
    'outputs/04_agents/clin.md': 'spec 2',
    'outputs/04_agents/.hidden.md': 'editor lock',
    'outputs/04_agents/notes.txt': 'not a spec',
  });
  return { repoRoot, appDir };
}

const noBuild = async () => {};
const quiet = () => {};

describe('isPlatformPackage', () => {
  it.each(['sharp', 'detect-libc', '@img/sharp-darwin-arm64', '@img/sharp-libvips-linuxmusl-x64', '@img/colour', '@next/swc-darwin-arm64', '@next/swc-win32-x64-msvc', '@swc/core-linux-x64-gnu'])(
    'removes %s',
    (name) => expect(isPlatformPackage(name)).toBe(true),
  );

  it.each(['next', 'react', 'react-dom', 'styled-jsx', 'client-only', 'semver', '@next/env', '@swc/helpers', 'sharpen', 'img'])(
    'keeps %s',
    (name) => expect(isPlatformPackage(name)).toBe(false),
  );
});

describe('isExcludedFromStandalone', () => {
  it.each([
    '.data',
    '.data/chat.db',
    'src/server/chat/store.ts',
    'evals/packs/practice-01/pack.yaml',
    'public/avatars/reglead.svg',
    'agents/reglead.md',
    '.env',
    '.env.local',
    '.next-bundle/.env.production',
    '.next-bundle/server/app/page.js.map',
    'node_modules/next/dist/server/next.js.map',
    'node_modules/foo/lib/thing.test.js',
    'node_modules/sharp',
    'node_modules/sharp/lib/index.js',
    'node_modules/@img/sharp-darwin-arm64/lib/sharp.node',
    'node_modules/@next/swc-darwin-arm64/next-swc.node',
    'node_modules/next/node_modules/sharp/index.js',
    'node_modules\\@img\\colour\\index.js',
    '.DS_Store',
    'tsconfig.tsbuildinfo',
  ])('leaves out %s', (path) => expect(isExcludedFromStandalone(path)).toBe(true));

  it.each([
    'server.js',
    'package.json',
    '.next-bundle/BUILD_ID',
    '.next-bundle/server/app/page.js',
    '.next-bundle/required-server-files.json',
    'node_modules/next/dist/server/next.js',
    'node_modules/@next/env/index.js',
    'node_modules/@swc/helpers/index.js',
    'node_modules/react/index.js',
    'node_modules/styled-jsx/index.js',
    'node_modules/next/src-like/file.js',
  ])('keeps %s', (path) => expect(isExcludedFromStandalone(path)).toBe(false));
});

describe('stripAnswerKey', () => {
  it('drops the issues block and keeps everything the app reads', () => {
    const text = stripAnswerKey(PACK);

    expect(text).not.toContain('SECRET-ANSWER');
    expect(text).not.toContain('issues:');
    expect(text).toContain("as_of: '2026-10-12'");
    expect(text).toContain('{ id: DR-00, title: Index, file: dr-00-index.md }');
    expect(text).toContain('# Practice case 01: a fictional data room.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('keeps a key that comes after the issues block', () => {
    const text = stripAnswerKey('id: a\nissues:\n  - id: x\nafter: kept\n');

    expect(text).toBe('id: a\nafter: kept\n');
  });
});

describe('small helpers', () => {
  it('lists agent specs the way the loader does', () => {
    const { repoRoot } = fakeRepo();

    expect(listAgentSpecFiles(join(repoRoot, 'outputs', '04_agents'))).toEqual(['clin.md', 'reglead.md']);
  });

  it('finds native binaries by extension and not by lookalike names', () => {
    const root = temp();
    put(root, { 'a/x.node': '', 'a/lib.dylib': '', 'b/libz.so.1': '', 'c/tool.EXE': '', 'd/page.node.js': '', 'e/notes.txt': '', 'f/also.sort': '' });

    expect(findNativeBinaries(root).sort()).toEqual(['a/lib.dylib', 'a/x.node', 'b/libz.so.1', 'c/tool.EXE']);
  });

  it('finds a secret value but reports only the label and the file', () => {
    const root = temp();
    put(root, { 'server/a.js': 'const k = "super-secret-value-123"', 'server/b.js': 'nothing here' });

    const hits = findSecretsInTree(root, { LLM_API_KEY: 'super-secret-value-123', SHORT: 'const' });

    expect(hits).toEqual([{ label: 'LLM_API_KEY', file: 'server/a.js' }]);
    expect(JSON.stringify(hits)).not.toContain('super-secret-value-123');
  });

  it('collects the build machine settings from the environment and the env files', () => {
    const appDir = temp();
    put(appDir, { '.env.local': 'LLM_API_KEY="from-the-file-0001"\nOTHER=1\n# LLM_BASE_URL=commented\nexport LLM_BASE_URL=https://example.invalid/v1\n' });

    const secrets = collectBuildSecrets(appDir, { LLM_JUDGE_API_KEY: 'from-the-env-0002' });

    expect(secrets).toEqual({
      LLM_JUDGE_API_KEY: 'from-the-env-0002',
      'LLM_API_KEY (from .env.local)': 'from-the-file-0001',
      'LLM_BASE_URL (from .env.local)': 'https://example.invalid/v1',
    });
  });

  it('builds with standalone output on, into the named folder', () => {
    const env = buildEnv('.next-bundle', { PATH: '/bin', BUNDLE_BUILD: '0' });

    expect(env).toMatchObject({ PATH: '/bin', BUNDLE_BUILD: '1', NEXT_DIST_DIR: '.next-bundle', NEXT_TELEMETRY_DISABLED: '1' });
  });

  it('builds with no model settings: inherited LLM_* names are dropped and the app\'s names are blank, so .env.local cannot fill them', () => {
    const env = buildEnv('.next-bundle', { PATH: '/bin', LLM_API_KEY: 'from-the-shell', LLM_SOMETHING_ELSE: 'x', LLM_BASE_URL: 'https://example.invalid/v1' });

    expect(Object.entries(env).filter(([name, value]) => name.startsWith('LLM_') && value !== '')).toEqual([]);
    // Next.js never replaces a name that is already set, even to "": blank is what keeps the file's values out.
    for (const name of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_JUDGE_API_KEY']) expect(env[name]).toBe('');
    expect(env.PATH).toBe('/bin');
  });

  it('measures files and bytes', () => {
    const root = temp();
    put(root, { 'a.txt': '12345', 'b/c.txt': '123' });

    expect(measureTree(root)).toEqual({ files: 2, bytes: 8 });
  });

  it('finds server.js at the root or a few levels down, and null when absent', () => {
    const flat = temp();
    put(flat, { 'server.js': '' });
    const nested = temp();
    put(nested, { 'outputs/05_demo/app/server.js': '', 'node_modules/x/server.js': '' });
    const none = temp();
    put(none, { 'a/b.js': '' });

    expect(findStandaloneRoot(flat)).toBe(flat);
    expect(findStandaloneRoot(nested)).toBe(join(nested, 'outputs', '05_demo', 'app'));
    expect(findStandaloneRoot(none)).toBeNull();
  });
});

describe('scrubBuildPaths', () => {
  const APP = '/Users/example-owner/work/repo/outputs/05_demo/app';
  const manifest = (appDir: string) => JSON.stringify({ config: { outputFileTracingRoot: appDir, turbopack: { root: appDir } }, appDir, relativeAppDir: '.' });

  it('replaces the build machine folder in server.js and the server-files manifest, and keeps the manifest valid JSON', () => {
    const out = temp();
    put(out, {
      'server.js': `const nextConfig = {"outputFileTracingRoot":"${APP}","distDir":"./.next-bundle"}`,
      '.next-bundle/required-server-files.json': manifest(APP),
    });

    expect(scrubBuildPaths(out, '.next-bundle', [APP])).toBe(2);

    expect(readFileSync(join(out, 'server.js'), 'utf8')).toBe(`const nextConfig = {"outputFileTracingRoot":"${NEUTRAL_APP_PATH}","distDir":"./.next-bundle"}`);
    const parsed = JSON.parse(readFileSync(join(out, '.next-bundle/required-server-files.json'), 'utf8'));
    expect(parsed.appDir).toBe(NEUTRAL_APP_PATH);
    expect(parsed.config.outputFileTracingRoot).toBe(NEUTRAL_APP_PATH);
    expect(parsed.config.turbopack.root).toBe(NEUTRAL_APP_PATH);
    expect(parsed.relativeAppDir).toBe('.');
  });

  it('replaces the longer folder first, so the repository folder never leaves a half-replaced path behind', () => {
    const out = temp();
    const repo = '/Users/example-owner/work/repo';
    put(out, { 'server.js': `a="${APP}" b="${repo}/outputs/04_agents"` });

    scrubBuildPaths(out, '.next-bundle', [repo, APP]);

    const text = readFileSync(join(out, 'server.js'), 'utf8');
    expect(text).toContain(`a="${NEUTRAL_APP_PATH}"`);
    expect(text).not.toContain('example-owner');
  });

  it('finds a folder written the way JSON writes a Windows path', () => {
    const out = temp();
    const windowsApp = 'C:\\Users\\example-owner\\repo\\app';
    put(out, { '.next-bundle/required-server-files.json': `{"appDir":${JSON.stringify(windowsApp)}}` });

    scrubBuildPaths(out, '.next-bundle', [windowsApp]);

    expect(readFileSync(join(out, '.next-bundle/required-server-files.json'), 'utf8')).toBe(`{"appDir":"${NEUTRAL_APP_PATH}"}`);
  });

  it('ignores a very short folder (it would match ordinary text) and a file that is not there', () => {
    const out = temp();
    put(out, { 'server.js': 'const a = "/usr/lib"; // /tmp' });

    expect(scrubBuildPaths(out, '.next-bundle', ['/', '/usr', '/tmp'])).toBe(0);
    expect(readFileSync(join(out, 'server.js'), 'utf8')).toBe('const a = "/usr/lib"; // /tmp');
  });

  it('leaves other files alone', () => {
    const out = temp();
    put(out, { 'package.json': `{"x":"${APP}"}`, 'server.js': 'ok' });

    expect(scrubBuildPaths(out, '.next-bundle', [APP])).toBe(0);
    expect(readFileSync(join(out, 'package.json'), 'utf8')).toContain(APP);
  });
});

describe('assemblePayload', () => {
  it('writes no folder of the build machine into server.js or the server-files manifest', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const real = realpathSync(appDir);
    const outDir = join(temp(), 'app');
    // What the real build writes: the app folder in the embedded config and in the manifest.
    put(appDir, {
      '.next-bundle/standalone/server.js': `const nextConfig = {"outputFileTracingRoot":"${real}","distDir":"./.next-bundle"}\nrequire("next")`,
      '.next-bundle/standalone/.next-bundle/required-server-files.json': JSON.stringify({ appDir: real, config: { repoRoot: real } }),
    });

    await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });

    for (const file of ['server.js', '.next-bundle/required-server-files.json']) {
      const text = readFileSync(join(outDir, file), 'utf8');
      expect(text, file).not.toContain(real);
      expect(text, file).not.toContain(realpathSync(repoRoot));
      expect(text, file).toContain(NEUTRAL_APP_PATH);
    }
    // The whole app folder is replaced, not just the repository part of it.
    expect(JSON.parse(readFileSync(join(outDir, '.next-bundle/required-server-files.json'), 'utf8')).appDir).toBe(NEUTRAL_APP_PATH);
  });

  it('lays out the payload and leaves out data, sources, env files, maps and platform packages', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const outDir = join(temp(), 'app');

    const result = await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });

    const has = (path: string) => existsSync(join(outDir, path));
    for (const kept of [
      'server.js',
      'package.json',
      '.next-bundle/BUILD_ID',
      '.next-bundle/server/app/page.js',
      '.next-bundle/static/chunks/app.js',
      'node_modules/next/index.js',
      'node_modules/react/index.js',
      'node_modules/@swc/helpers/index.js',
      'public/avatars/reglead.svg',
      'evals/packs/practice-01/dr-00-index.md',
      'agents/reglead.md',
      'agents/clin.md',
    ]) {
      expect(has(kept), kept).toBe(true);
    }
    for (const gone of [
      '.data',
      '.env.local',
      'src',
      'public/avatars/old.svg',
      'public/avatars/.DS_Store',
      'evals/packs/other-case',
      'agents/README.md',
      'agents/.hidden.md',
      'agents/notes.txt',
      '.next-bundle/server/app/page.js.map',
      '.next-bundle/static/chunks/app.js.map',
      'node_modules/next/dist/x.js.map',
      'node_modules/sharp',
      'node_modules/@img',
      'node_modules/@next/swc-darwin-arm64',
    ]) {
      expect(has(gone), gone).toBe(false);
    }
    expect(result.distDir).toBe('.next-bundle');
    expect(result.specCount).toBe(2);
    expect(result.removedPlatformPackages).toEqual(['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64', '@next/swc-darwin-arm64', 'sharp']);
    expect(result.files).toBe(measureTree(outDir).files);
    expect(findNativeBinaries(outDir)).toEqual([]);
  });

  it('ships the practice case without its answer key', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const outDir = join(temp(), 'app');

    await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });

    const pack = readFileSync(join(outDir, 'evals/packs/practice-01/pack.yaml'), 'utf8');
    expect(pack).toContain('as_of');
    expect(pack).not.toContain('SECRET-ANSWER');
    // The repository's own copy is untouched.
    expect(readFileSync(join(appDir, 'evals/packs/practice-01/pack.yaml'), 'utf8')).toContain('SECRET-ANSWER');
  });

  it('uses a server.js that the tracer nested below the standalone root as the payload root', async () => {
    const { repoRoot, appDir } = fakeRepo({ nested: 'outputs/05_demo/app' });
    const outDir = join(temp(), 'app');

    await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });

    expect(existsSync(join(outDir, 'server.js'))).toBe(true);
    expect(existsSync(join(outDir, '.next-bundle/BUILD_ID'))).toBe(true);
    expect(existsSync(join(outDir, 'outputs'))).toBe(false);
  });

  it('passes the build the folder name it must use', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const build = vi.fn(async () => {});

    await assemblePayload({ appDir, repoRoot, outDir: join(temp(), 'app'), log: quiet, build });

    expect(build).toHaveBeenCalledWith(expect.objectContaining({ appDir, distDir: '.next-bundle' }));
  });

  it('deletes the payload when a setting of the build machine is found in it, so no later step can ship it', async () => {
    const { repoRoot, appDir } = fakeRepo({ extraStandalone: { 'server-extra.js': 'const k = "from-the-file-0001";' } });
    put(appDir, { '.env.local': 'LLM_API_KEY=from-the-file-0001\n' });
    const outDir = join(temp(), 'app');

    await expect(assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild })).rejects.toThrow(/do not ship it/);

    expect(existsSync(outDir)).toBe(false);
  });

  it('deletes the payload when a native binary is left in it', async () => {
    const { repoRoot, appDir } = fakeRepo({ extraStandalone: { 'node_modules/some-addon/build/addon.node': 'bin' } });
    const outDir = join(temp(), 'app');

    await expect(assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild })).rejects.toThrow(/native binaries/);

    expect(existsSync(outDir)).toBe(false);
  });

  it('replaces an earlier payload in the same folder', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const outDir = join(temp(), 'app');
    await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });
    put(outDir, { 'leftover-from-before.txt': 'old' });

    await assemblePayload({ appDir, repoRoot, outDir, log: quiet, build: noBuild });

    expect(existsSync(join(outDir, 'leftover-from-before.txt'))).toBe(false);
    expect(existsSync(join(outDir, 'server.js'))).toBe(true);
  });

  it('refuses a non-empty folder that is not an earlier payload, and the repository itself', async () => {
    const { repoRoot, appDir } = fakeRepo();
    const someFolder = temp();
    put(someFolder, { 'my-photos/a.jpg': 'precious' });

    await expect(assemblePayload({ appDir, repoRoot, outDir: someFolder, log: quiet, build: noBuild })).rejects.toThrow(/not empty/);
    expect(existsSync(join(someFolder, 'my-photos/a.jpg'))).toBe(true);
    await expect(assemblePayload({ appDir, repoRoot, outDir: appDir, log: quiet, build: noBuild })).rejects.toThrow(/repository/);
    await expect(assemblePayload({ appDir, repoRoot, outDir: dirname(repoRoot), log: quiet, build: noBuild })).rejects.toThrow(/repository/);
  });

  it('says so when there is no standalone build output', async () => {
    const { repoRoot, appDir } = fakeRepo();
    rmSync(join(appDir, '.next-bundle', 'standalone'), { recursive: true });

    await expect(assemblePayload({ appDir, repoRoot, outDir: join(temp(), 'app'), log: quiet, build: noBuild })).rejects.toThrow(/BUNDLE_BUILD=1/);
  });

  it('fails when the agent specs or the practice case are missing instead of shipping a hollow payload', async () => {
    const noSpecs = fakeRepo();
    rmSync(join(noSpecs.repoRoot, 'outputs', '04_agents'), { recursive: true });
    const noPack = fakeRepo();
    rmSync(join(noPack.appDir, 'evals'), { recursive: true });

    await expect(assemblePayload({ ...noSpecs, outDir: join(temp(), 'app'), log: quiet, build: noBuild })).rejects.toThrow(/no agent specs/);
    await expect(assemblePayload({ ...noPack, outDir: join(temp(), 'app'), log: quiet, build: noBuild })).rejects.toThrow(/practice case is missing/);
  });

  it('rejects a build folder name the config would reject', async () => {
    const { repoRoot, appDir } = fakeRepo();

    await expect(assemblePayload({ appDir, repoRoot, outDir: join(temp(), 'app'), distDir: '../x', log: quiet, build: noBuild })).rejects.toThrow(/distDir/);
  });

  it('refuses a payload that still holds a native binary', async () => {
    const { repoRoot, appDir } = fakeRepo({ extraStandalone: { 'node_modules/some-addon/build/addon.node': 'bin' } });

    await expect(assemblePayload({ appDir, repoRoot, outDir: join(temp(), 'app'), log: quiet, build: noBuild })).rejects.toThrow(/native binaries.*addon\.node/);
  });

  it('refuses a payload that holds a setting from the build machine, without printing it', async () => {
    vi.stubEnv('LLM_API_KEY', 'owner-key-do-not-ship-9876');
    const { repoRoot, appDir } = fakeRepo({ extraStandalone: { '.next-bundle/server/app/page.js': 'const k = "owner-key-do-not-ship-9876";' } });

    const attempt = assemblePayload({ appDir, repoRoot, outDir: join(temp(), 'app'), log: quiet, build: noBuild });

    await expect(attempt).rejects.toThrow(/LLM_API_KEY in \.next-bundle\/server\/app\/page\.js/);
    await expect(attempt).rejects.not.toThrow(/owner-key-do-not-ship-9876/);
  });
});
