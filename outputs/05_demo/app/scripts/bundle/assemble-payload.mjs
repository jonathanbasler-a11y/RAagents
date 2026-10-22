// Builds the app once in "standalone" form and lays out the folder the downloadable demo runs from
// (the app/ folder of the bundle). Plain Node, no dependencies, so the bundle builder can import it.
//
//   import { assemblePayload } from './assemble-payload.mjs';
//   const result = await assemblePayload({ appDir, repoRoot, outDir });
//
// What the folder holds, and why each part is there:
//   server.js, package.json, node_modules/   the traced server (Next.js "standalone" output)
//   <distDir>/                               the built pages and API routes; <distDir>/static the browser files
//   public/                                  avatars (the agent loader checks that each one exists)
//   evals/packs/practice-01/                 the fictional practice case, read from the working folder
//   agents/                                  the agent specs (the launcher points AGENT_SPECS_DIR here)
//
// The server finds its build folder through a name written into server.js, so the folder keeps the name it
// was built with (".next-bundle" by default) and is not renamed to ".next".
import { APP_LLM_NAMES } from '../demo/demo-lib.mjs';

import { spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIST_DIR = '.next-bundle';
export const PRACTICE_PACK_PATH = 'evals/packs/practice-01';

// Native code is per operating system and chip. The payload must work on all of them, so none ships:
// sharp (image resizing, which the app does not use) and its prebuilt binaries, and the compilers.
const PLATFORM_PACKAGE_NAMES = new Set(['sharp', 'detect-libc']);
const PLATFORM_PACKAGE_SCOPES = new Set(['@img']);
const PLATFORM_PACKAGE_PREFIXES = ['@next/swc-', '@swc/core-', '@swc/wasm'];
const NATIVE_EXTENSIONS = ['.node', '.dylib', '.so', '.dll', '.exe'];

/** True for a package that holds per-platform native code. `name` is "sharp", "@img/sharp-darwin-arm64", "@next/swc-win32-x64-msvc". */
export function isPlatformPackage(name) {
  const clean = name.split('\\').join('/');
  if (PLATFORM_PACKAGE_NAMES.has(clean)) return true;
  if (PLATFORM_PACKAGE_SCOPES.has(clean.split('/')[0])) return true;
  return PLATFORM_PACKAGE_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

/** The package name at the start of the path below a node_modules folder, or null when the path ends there. */
function packageNameAfterNodeModules(segments, nodeModulesIndex) {
  const first = segments[nodeModulesIndex + 1];
  if (first === undefined) return null;
  if (first.startsWith('@')) {
    const second = segments[nodeModulesIndex + 2];
    return second === undefined ? first : `${first}/${second}`;
  }
  return first;
}

/**
 * Whether a path inside the standalone folder stays out of the payload. `relPath` is relative to the
 * standalone root, with "/" or the OS separator.
 *
 * Out: the traced copies of the app's own data and sources (the tracer follows the chat database path and
 * pulls the owner's local database in), anything named .env*, source maps, test files, editor and OS litter,
 * and platform packages. The practice pack, avatars and agent specs are copied fresh from the repo.
 */
export function isExcludedFromStandalone(relPath) {
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return false;
  const top = segments[0];
  if (['.data', '.git', 'src', 'tests', 'evals', 'public', 'agents', 'outputs', 'inputs'].includes(top)) return true;
  if (segments.some((segment) => segment.startsWith('.env'))) return true;
  const name = segments[segments.length - 1];
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  if (name.endsWith('.map')) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  if (name.endsWith('.tsbuildinfo')) return true;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== 'node_modules') continue;
    const packageName = packageNameAfterNodeModules(segments, index);
    if (packageName !== null && isPlatformPackage(packageName)) return true;
  }
  return false;
}

/** Drops the answer key (the `issues:` block) from the practice pack text; the app reads only as_of and documents. */
export function stripAnswerKey(packYaml) {
  const lines = packYaml.split('\n');
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const topLevelKey = /^[A-Za-z_][\w-]*:/.exec(line);
    if (topLevelKey) skipping = line.startsWith('issues:');
    if (!skipping) kept.push(line);
  }
  // At most one empty line in a row, and one line end at the close.
  const text = kept.join('\n').replace(/\n\n\n+/g, '\n\n').replace(/\s+$/, '\n');
  return text.replace(', and its answer key.', '.');
}

/** Agent spec files in a folder: *.md except README.md and hidden files, sorted (what the agent loader reads). */
export function listAgentSpecFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('.') && name !== 'README.md')
    .sort();
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

/** Files and bytes under a folder. */
export function measureTree(dir) {
  let files = 0;
  let bytes = 0;
  for (const file of walkFiles(dir)) {
    files += 1;
    bytes += lstatSync(file).size;
  }
  return { files, bytes };
}

/** Relative paths of native binaries under a folder; an empty list means the folder is platform-neutral. */
export function findNativeBinaries(dir) {
  const found = [];
  for (const file of walkFiles(dir)) {
    const lower = file.toLowerCase();
    if (NATIVE_EXTENSIONS.some((extension) => lower.endsWith(extension)) || /\.so\.\d/.test(lower)) {
      found.push(relative(dir, file).split(sep).join('/'));
    }
  }
  return found;
}

/**
 * Looks for secret values inside the payload. `secrets` maps a label to a value; only the label is ever
 * reported, never the value. Values shorter than 8 characters are ignored (too short to mean anything).
 * Returns [{ label, file }].
 */
export function findSecretsInTree(dir, secrets) {
  const needles = Object.entries(secrets).filter(([, value]) => typeof value === 'string' && value.length >= 8);
  if (needles.length === 0) return [];
  const hits = [];
  for (const file of walkFiles(dir)) {
    if (statSync(file).size > 20 * 1024 * 1024) continue;
    const text = readFileSync(file, 'latin1');
    for (const [label, value] of needles) {
      if (text.includes(value)) hits.push({ label, file: relative(dir, file).split(sep).join('/') });
    }
  }
  return hits;
}

/**
 * Where the build writes this machine's app folder into the output: the config object inside server.js
 * and the server-files manifest (outputFileTracingRoot, repoRoot, turbopack.root, appDir). A standalone
 * server never reads those values (it takes its folder from __dirname and runs with the config embedded
 * in server.js), so they are replaced by a neutral path and no folder name of the build machine travels.
 */
export const NEUTRAL_APP_PATH = '/hybrid-demo/app';

/** The two files of the payload that carry the build machine's folders. @param {string} distDir */
export function filesWithBuildPaths(distDir) {
  return ['server.js', join(distDir, 'required-server-files.json')];
}

/**
 * Replaces every occurrence of the given build-machine folders (plain and as written inside JSON text) in
 * the files that carry them. Longest folder first, so the app folder goes before the repository folder it
 * sits in. Returns the number of files changed. A missing file is skipped (the scan of the staged tree
 * still looks at everything).
 * @param {string} outDir @param {string} distDir @param {string[]} buildPaths
 */
export function scrubBuildPaths(outDir, distDir, buildPaths) {
  const variants = new Set();
  for (const path of buildPaths) {
    if (typeof path !== 'string' || path.length < 8) continue; // "/" or "/usr" would match ordinary text
    variants.add(path);
    variants.add(JSON.stringify(path).slice(1, -1));
  }
  const needles = [...variants].sort((a, b) => b.length - a.length);
  let changed = 0;
  for (const name of filesWithBuildPaths(distDir)) {
    const file = join(outDir, name);
    if (!existsSync(file)) continue;
    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const needle of needles) after = after.split(needle).join(NEUTRAL_APP_PATH);
    if (after !== before) {
      writeFileSync(file, after);
      changed += 1;
    }
  }
  return changed;
}

const SECRET_KEYS = ['LLM_API_KEY', 'LLM_JUDGE_API_KEY', 'LLM_BASE_URL', 'LLM_JUDGE_BASE_URL'];

/**
 * LLM_* values the build could have seen: the environment, and the app's own env files.
 * @param {string} appDir
 * @param {Record<string, string | undefined>} [env]
 */
export function collectBuildSecrets(appDir, env = process.env) {
  const secrets = {};
  for (const key of SECRET_KEYS) if (env[key]) secrets[key] = env[key];
  for (const fileName of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const file = join(appDir, fileName);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !SECRET_KEYS.includes(match[1])) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
      if (value) secrets[`${match[1]} (from ${fileName})`] = value;
    }
  }
  return secrets;
}

/** Finds the folder that holds server.js: the standalone root, or a few levels down when the tracer nested it. */
export function findStandaloneRoot(standaloneDir) {
  const queue = [{ dir: standaloneDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (existsSync(join(dir, 'server.js'))) return dir;
    if (depth >= 4) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return null;
}

function copyFiltered(from, to, isExcluded = () => false) {
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const rel = relative(from, source);
      return rel === '' || !isExcluded(rel);
    },
  });
}

/**
 * The environment of the build: standalone output on, into the named folder, no telemetry, and no
 * model settings. Inherited LLM_* names are dropped, and the app's names are set to "": Next.js never
 * replaces a name that is already set, even to "", so .env.local's values stay out of the build
 * (the source-code launcher's build does the same, scripts/demo/demo-lib.mjs).
 * @param {string} distDir
 * @param {Record<string, string | undefined>} [base]
 * @returns {Record<string, string | undefined>}
 */
export function buildEnv(distDir, base = process.env) {
  /** @type {Record<string, string | undefined>} */
  const env = {};
  for (const [name, value] of Object.entries(base)) if (!name.startsWith('LLM_')) env[name] = value;
  for (const name of APP_LLM_NAMES) env[name] = '';
  return { ...env, BUNDLE_BUILD: '1', NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' };
}

function runBuild({ appDir, distDir, log }) {
  const require = createRequire(join(appDir, 'package.json'));
  const nextBin = require.resolve('next/dist/bin/next');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd: appDir,
      env: buildEnv(distDir),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`next build failed (exit ${code}). Last output:\n${tail}`));
    });
    log(`building the app (distDir ${distDir}) ...`);
  });
}

function refuseUnsafeTarget(outDir, appDir, repoRoot) {
  const out = resolve(outDir);
  const protectedFolders = [resolve(appDir), resolve(repoRoot)];
  for (const folder of protectedFolders) {
    if (out === folder || folder.startsWith(out + sep)) {
      throw new Error(`refusing to use ${out} as the payload folder: it is, or contains, the repository`);
    }
  }
  if (!existsSync(out)) return;
  const entries = readdirSync(out);
  if (entries.length === 0) return;
  if (!(entries.includes('server.js') && entries.includes('package.json'))) {
    throw new Error(`refusing to replace ${out}: it is not empty and does not look like an earlier payload`);
  }
}

/**
 * Builds the app and assembles the payload folder.
 *
 * @param {object} options
 * @param {string} options.appDir    outputs/05_demo/app
 * @param {string} options.repoRoot  the repository root (agent specs live in <repoRoot>/outputs/04_agents)
 * @param {string} options.outDir    the payload folder to create (an earlier payload there is replaced)
 * @param {string} [options.distDir] build folder name, ".next" or ".next-<label>" (default ".next-bundle")
 * @param {(message: string) => void} [options.log]
 * @param {(args: object) => Promise<void>} [options.build] replaces the real build (tests)
 * @returns {Promise<{ outDir: string, distDir: string, files: number, bytes: number, specCount: number, removedPlatformPackages: string[] }>}
 */
export async function assemblePayload({ appDir, repoRoot, outDir, distDir = DEFAULT_DIST_DIR, log = console.log, build = runBuild }) {
  if (!/^\.next(-[A-Za-z0-9_-]+)?$/.test(distDir)) throw new Error(`distDir must be ".next" or ".next-<label>"; got "${distDir}"`);
  const app = resolve(appDir);
  const out = resolve(outDir);
  refuseUnsafeTarget(out, app, repoRoot);

  const specsSource = join(resolve(repoRoot), 'outputs', '04_agents');
  if (!existsSync(specsSource) || listAgentSpecFiles(specsSource).length === 0) {
    throw new Error(`no agent specs found in ${specsSource}`);
  }
  const packSource = join(app, PRACTICE_PACK_PATH);
  if (!existsSync(join(packSource, 'pack.yaml'))) throw new Error(`the practice case is missing: ${join(PRACTICE_PACK_PATH, 'pack.yaml')}`);
  if (!existsSync(join(app, 'public', 'avatars'))) throw new Error('public/avatars is missing');

  await build({ appDir: app, distDir, log });

  const standaloneDir = join(app, distDir, 'standalone');
  if (!existsSync(standaloneDir)) throw new Error(`no standalone output at ${standaloneDir}: was the build run with BUNDLE_BUILD=1?`);
  const serverRoot = findStandaloneRoot(standaloneDir);
  if (serverRoot === null) throw new Error(`no server.js under ${standaloneDir}`);
  const staticSource = join(app, distDir, 'static');
  if (!existsSync(staticSource)) throw new Error(`no browser files at ${staticSource}`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  log('copying the server ...');
  copyFiltered(serverRoot, out, isExcludedFromStandalone);
  if (!existsSync(join(out, distDir))) throw new Error(`the standalone output has no ${distDir} folder`);

  log('copying browser files, avatars, the practice case and the agent specs ...');
  copyFiltered(staticSource, join(out, distDir, 'static'), (rel) => rel.split(/[\\/]/).some((part) => part === '.DS_Store' || part.endsWith('.map')));
  copyFiltered(join(app, 'public'), join(out, 'public'), (rel) => basename(rel) === '.DS_Store');

  const packTarget = join(out, PRACTICE_PACK_PATH);
  copyFiltered(packSource, packTarget, (rel) => basename(rel) === '.DS_Store');
  writeFileSync(join(packTarget, 'pack.yaml'), stripAnswerKey(readFileSync(join(packSource, 'pack.yaml'), 'utf8')));

  const specNames = listAgentSpecFiles(specsSource);
  mkdirSync(join(out, 'agents'), { recursive: true });
  for (const name of specNames) cpSync(join(specsSource, name), join(out, 'agents', name));

  // The build wrote this machine's folders into server.js and the server-files manifest; the server never reads them.
  scrubBuildPaths(out, distDir, [app, realpathSync(app), resolve(repoRoot), realpathSync(resolve(repoRoot))]);

  // The copy filter already left platform packages out; list what the standalone tree had, so the report is honest.
  const removedPlatformPackages = listPlatformPackages(join(serverRoot, 'node_modules'));
  // A payload that fails a check is deleted before the error, so no later step (--skip-build) can ship it.
  const native = findNativeBinaries(out);
  if (native.length > 0) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`the payload still holds native binaries, so it is not platform-neutral: ${native.slice(0, 5).join(', ')}`);
  }

  const secretHits = findSecretsInTree(out, collectBuildSecrets(app));
  if (secretHits.length > 0) {
    rmSync(out, { recursive: true, force: true });
    const where = secretHits.slice(0, 5).map((hit) => `${hit.label} in ${hit.file}`).join('; ');
    throw new Error(`a setting from the build machine ended up inside the payload (${where}); do not ship it`);
  }

  const { files, bytes } = measureTree(out);
  log(`payload ready: ${files} files, ${(bytes / (1024 * 1024)).toFixed(1)} MB, ${specNames.length} agent specs`);
  return { outDir: out, distDir, files, bytes, specCount: specNames.length, removedPlatformPackages };
}

function listPlatformPackages(nodeModulesDir) {
  const found = [];
  if (!existsSync(nodeModulesDir)) return found;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      for (const inner of readdirSync(join(nodeModulesDir, entry.name), { withFileTypes: true })) {
        if (inner.isDirectory() && isPlatformPackage(`${entry.name}/${inner.name}`)) found.push(`${entry.name}/${inner.name}`);
      }
    } else if (isPlatformPackage(entry.name)) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

// Run directly: node scripts/bundle/assemble-payload.mjs <outDir> [--dist-dir=.next-bundle]
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('usage: node scripts/bundle/assemble-payload.mjs <outDir> [--dist-dir=.next-bundle]');
    process.exit(2);
  }
  const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const repoRoot = resolve(appDir, '..', '..', '..');
  const distArg = process.argv.find((arg) => arg.startsWith('--dist-dir='));
  assemblePayload({ appDir, repoRoot, outDir, distDir: distArg ? distArg.slice('--dist-dir='.length) : DEFAULT_DIST_DIR }).catch((error) => {
    console.error(String(/** @type {{ message?: unknown }} */ (error)?.message ?? error));
    process.exit(1);
  });
}
