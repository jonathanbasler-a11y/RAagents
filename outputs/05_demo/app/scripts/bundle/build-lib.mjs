// The bundle builder's decisions (scripts/bundle/build-bundles.mjs). Pure where it can be; the few
// functions that touch files or run the system tools take their inputs as arguments so a test can
// point them at a temp folder. Nothing here prints a key, a settings value or a matched text.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** The one top folder of each ZIP. Short on purpose: Windows path limits. */
export const TOP_FOLDER = 'HybridDemo';

/**
 * The two ZIPs. `platform` is the Node.js platform name whose runtimes the ZIP carries.
 * @type {Readonly<Record<'mac' | 'windows', { zipName: string, platform: 'darwin' | 'win32' }>>}
 */
export const TARGETS = {
  mac: { zipName: 'HybridTeamDemo-mac.zip', platform: 'darwin' },
  windows: { zipName: 'HybridTeamDemo-windows.zip', platform: 'win32' },
};

/**
 * The launcher files, as [source relative to the app folder, destination inside HybridDemo/]. Same
 * layout as scripts/ in the repo, so the relative imports between them work in the repo and in the ZIP.
 */
export const LAUNCHER_FILES = [
  ['scripts/bundle/launcher.mjs', 'launcher/bundle/launcher.mjs'],
  ['scripts/bundle/launcher-lib.mjs', 'launcher/bundle/launcher-lib.mjs'],
  ['scripts/demo/demo-lib.mjs', 'launcher/demo/demo-lib.mjs'],
  ['scripts/fake-llm.mjs', 'launcher/fake-llm.mjs'],
];

/** The three double-click starters of each ZIP. */
export const STARTER_NAMES = {
  mac: ['Start practice demo.command', 'Start live demo.command', 'Stop demo.command'],
  windows: ['Start practice demo.cmd', 'Start live demo.cmd', 'Stop demo.cmd'],
};

/** A whole download may take this long. Each archive is about 40 MB; this allows a very slow line. */
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** The preset may set these lines of the settings file and no others. */
export const PRESET_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY_HEADER', 'LLM_MODEL', 'LLM_MAX_TOKENS'];
/** These stay empty in every ZIP: each person types their own key. */
export const SECRET_KEYS = ['LLM_API_KEY', 'LLM_JUDGE_API_KEY'];

/**
 * A key-like value assigned to a key name: 20 or more key characters, at least one digit, no dot.
 * (A dot or no digit means code such as `process.env.NAME` or a placeholder, not a key.)
 */
export const KEY_ASSIGNMENT = /LLM_(?:JUDGE_)?API_KEY(?![A-Za-z0-9_])["']?\s*[=:]\s*["']?(?=[A-Za-z0-9_\-+/=]*\d)[A-Za-z0-9_\-+/=]{20,}/;

export const HELP = `Builds the two demo ZIPs for colleagues, on this Mac.

Usage: npm run bundle -- [options]

Options
  --out <dir>         Where the ZIPs go. Must be outside the repository.
                      Default: ~/RAagents-bundles/out
  --cache <dir>       Where the downloaded Node.js archives are kept. Default: ~/RAagents-bundles/cache
                      A missing archive is downloaded from nodejs.org and checked against the
                      pinned hash in scripts/bundle/node-runtimes.json; a wrong hash stops the build.
                      With a full cache nothing is downloaded (works offline).
  --preset <file>     A private file that prefills the settings file with the NON-secret lines
                      (LLM_BASE_URL, LLM_API_KEY_HEADER, LLM_MODEL, LLM_MAX_TOKENS) and adds its
                      comment lines as notes. Refused if it holds an API key. Never commit it.
  --only <mac|windows>  Build one ZIP only.
  --skip-build        Reuse the app already assembled by an earlier run (in <out>/.payload)
                      instead of building it again.
  --deny-list <file>  Words that must not appear anywhere in the ZIPs, one per line (case does not
                      matter). Default: ~/.config/raagents/bundle-deny.txt if that file exists.
  --help, -h          Show this text.

Before zipping, every file is scanned for secrets, database files, key files, git files, links, and
paths: this Mac's own home, repository and output folders anywhere (packages included), and any other
home path in our own files (packages keep example paths in comments, so they are left out of that one
rule). The scan names the file and the rule, never the matched text. A hit stops the build and nothing
in the output folder is changed. Each finished ZIP is then checked once more (layout, the starters
and Mac runtimes executable) before it is put in place.

Output: HybridTeamDemo-mac.zip, HybridTeamDemo-windows.zip and SHA256SUMS.txt in the output folder.`;

/** @param {string} path @param {string} home */
export function expandHome(path, home) {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

/**
 * @param {string[]} argv
 * @param {{ home?: string, cwd?: string }} [context]
 * @returns {{ help: boolean, out: string, cache: string, preset: string | null, only: 'mac' | 'windows' | null, skipBuild: boolean, denyList: string | null }}
 */
export function parseArgs(argv, context = {}) {
  const home = context.home ?? homedir();
  const cwd = context.cwd ?? process.cwd();
  const toPath = (/** @type {string} */ value) => resolve(cwd, expandHome(value, home));
  const result = {
    help: false,
    out: join(home, 'RAagents-bundles', 'out'),
    cache: join(home, 'RAagents-bundles', 'cache'),
    preset: /** @type {string | null} */ (null),
    only: /** @type {'mac' | 'windows' | null} */ (null),
    skipBuild: false,
    denyList: /** @type {string | null} */ (null),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : null;
    const value = () => {
      const got = inline ?? argv[++i];
      if (got === undefined || got === '' || (inline === null && got.startsWith('--'))) {
        throw new Error(`${name} needs a value. Run with --help to see the options.`);
      }
      return got;
    };
    switch (name) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--out':
        result.out = toPath(value());
        break;
      case '--cache':
        result.cache = toPath(value());
        break;
      case '--preset':
        result.preset = toPath(value());
        break;
      case '--deny-list':
        result.denyList = toPath(value());
        break;
      case '--only': {
        const got = value();
        if (got !== 'mac' && got !== 'windows') throw new Error(`--only takes "mac" or "windows"; got "${got}".`);
        result.only = got;
        break;
      }
      case '--skip-build':
        if (inline !== null) throw new Error('--skip-build takes no value.');
        result.skipBuild = true;
        break;
      default:
        throw new Error(`unknown option "${arg}". Run with --help to see the options.`);
    }
  }
  return result;
}

/** @param {string} parent @param {string} child */
export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

/** @param {'mac' | 'windows' | null | undefined} only @returns {('mac' | 'windows')[]} */
export function targetsFor(only) {
  if (only === 'mac' || only === 'windows') return [only];
  return ['mac', 'windows'];
}

// ---- Node.js runtimes -------------------------------------------------------------------------

/** @typedef {{ platform: 'darwin' | 'win32', arch: 'arm64' | 'x64', file: string, sha256: string }} RuntimeFile */
/** @typedef {{ version: string, files: RuntimeFile[] }} RuntimeManifest */

/**
 * Checks the shape of node-runtimes.json, so a typo cannot turn into a wrong download or path.
 * @param {unknown} raw @returns {RuntimeManifest}
 */
export function parseRuntimes(raw) {
  const manifest = /** @type {{ version?: unknown, files?: unknown }} */ (raw);
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('node-runtimes.json: "version" must look like v24.21.0');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('node-runtimes.json: "files" must list at least one archive');
  }
  const seen = new Set();
  const files = manifest.files.map((/** @type {Record<string, unknown>} */ entry, /** @type {number} */ index) => {
    const where = `node-runtimes.json: files[${index}]`;
    const { platform, arch, file, sha256 } = entry ?? {};
    if (platform !== 'darwin' && platform !== 'win32') throw new Error(`${where}: platform must be darwin or win32`);
    if (arch !== 'arm64' && arch !== 'x64') throw new Error(`${where}: arch must be arm64 or x64`);
    const expectedFile = platform === 'win32' ? `node-${version}-win-${arch}.zip` : `node-${version}-darwin-${arch}.tar.gz`;
    if (file !== expectedFile) throw new Error(`${where}: file must be ${expectedFile}`);
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`${where}: sha256 must be 64 lowercase hex characters`);
    }
    if (seen.has(`${platform}-${arch}`)) throw new Error(`${where}: ${platform}-${arch} is listed twice`);
    seen.add(`${platform}-${arch}`);
    return { platform, arch, file, sha256 };
  });
  return { version, files };
}

/** @param {RuntimeManifest} manifest @param {'darwin' | 'win32'} platform */
export function runtimesFor(manifest, platform) {
  return manifest.files.filter((entry) => entry.platform === platform);
}

/** @param {string} path @returns {Promise<string>} */
export async function sha256OfFile(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Throws unless the file exists and has exactly the pinned hash.
 * @param {string} path @param {string} expectedSha256
 */
export async function verifyArchive(path, expectedSha256) {
  const name = basename(path);
  if (!existsSync(path)) throw new Error(`${name} is not there.`);
  const actual = await sha256OfFile(path);
  if (actual !== expectedSha256) {
    throw new Error(`${name} does not match the pinned hash in node-runtimes.json. Refusing to use it.`);
  }
}

/** Where an archive comes from. Built from the pinned version and file name only. */
export function downloadUrl(/** @type {string} */ version, /** @type {string} */ file) {
  return `https://nodejs.org/dist/${version}/${file}`;
}

/**
 * A short code for an error ("ENOTFOUND", "TimeoutError"). The message is left out on purpose: a proxy
 * can put an internal host name in it.
 * @param {unknown} error
 */
function errorCode(error) {
  const e = /** @type {{ cause?: { code?: unknown }, code?: unknown, name?: unknown } | null | undefined} */ (error);
  const code = e?.cause?.code ?? e?.code ?? e?.name;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'error';
}

/**
 * The verified path of one archive: the cached file if its hash is right, else a fresh download
 * that is checked before it is moved into place. A wrong hash is a refusal, never a fallback.
 * A cached file with a wrong hash is also a refusal (it is not silently replaced).
 * @param {{ entry: RuntimeFile, version: string, cacheDir: string, fetchImpl?: typeof fetch, log?: (line: string) => void }} args
 */
export async function ensureArchive({ entry, version, cacheDir, fetchImpl = fetch, log = () => {} }) {
  const target = join(cacheDir, entry.file);
  if (existsSync(target)) {
    await verifyArchive(target, entry.sha256);
    return target;
  }
  log(`Downloading ${entry.file} from nodejs.org ...`);
  mkdirSync(cacheDir, { recursive: true });
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(downloadUrl(version, entry.file), { signal });
  } catch (error) {
    throw new Error(`could not reach nodejs.org to download ${entry.file} (${errorCode(error)}). Check the network or VPN, or put the file in the cache folder: ${cacheDir}`);
  }
  if (!response.ok || response.body === null) {
    throw new Error(`could not download ${entry.file} (HTTP ${response.status}). Check the network, or put the file in the cache folder: ${cacheDir}`);
  }
  const part = `${target}.part`;
  try {
    try {
      await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), createWriteStream(part));
    } catch (error) {
      throw new Error(`the download of ${entry.file} was interrupted (${errorCode(error)}). Try again, or put the file in the cache folder: ${cacheDir}`);
    }
    await verifyArchive(part, entry.sha256);
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
  renameSync(part, target);
  return target;
}

/** The files kept from an archive, as [path inside the archive, path inside HybridDemo/]. @param {RuntimeFile} entry */
export function runtimeMembers(entry) {
  const base = entry.file.replace(/\.(tar\.gz|zip)$/, '');
  const dest = `runtime/${entry.platform}-${entry.arch}`;
  if (entry.platform === 'win32') {
    return [
      [`${base}/node.exe`, `${dest}/node.exe`],
      [`${base}/LICENSE`, `${dest}/LICENSE`],
    ];
  }
  return [
    [`${base}/bin/node`, `${dest}/bin/node`],
    [`${base}/LICENSE`, `${dest}/LICENSE`],
  ];
}

/**
 * Extracts only the runtime binary and its LICENSE from a VERIFIED archive into `topDir`.
 * The archive is unpacked into its own new empty folder first.
 * @param {{ entry: RuntimeFile, archivePath: string, topDir: string, scratchRoot: string }} args
 */
export function extractRuntime({ entry, archivePath, topDir, scratchRoot }) {
  const members = runtimeMembers(entry);
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, 'node-'));
  const names = members.map(([from]) => from);
  const result =
    entry.platform === 'win32'
      ? spawnSync('unzip', ['-q', '-o', archivePath, ...names, '-d', scratch], { encoding: 'utf8' })
      : spawnSync('tar', ['-xzf', archivePath, '-C', scratch, ...names], { encoding: 'utf8' });
  try {
    if (result.error || result.status !== 0) {
      throw new Error(`could not unpack ${entry.file}: ${(result.error?.message ?? result.stderr ?? '').trim().split('\n')[0]}`);
    }
    for (const [from, to] of members) {
      const source = join(scratch, from);
      if (!existsSync(source)) throw new Error(`${entry.file} does not contain ${from}.`);
      const target = join(topDir, to);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---- Settings file and preset -----------------------------------------------------------------

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** @param {string} value */
function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.endsWith(text[0])) return text.slice(1, -1);
  return text;
}

/** @param {string} text */
const splitLines = (text) => text.replace(/\r\n?/g, '\n').split('\n');

/**
 * Throws if a secret key has a value in this settings text.
 * @param {string} text
 */
export function assertKeysEmpty(text) {
  for (const line of splitLines(text)) {
    const match = ENV_LINE.exec(line);
    if (match && SECRET_KEYS.includes(match[1]) && unquote(match[2]) !== '') {
      throw new Error(`${match[1]} must stay empty in the ZIP: every person types their own key.`);
    }
  }
}

/**
 * Prefills the non-secret lines of the settings template from a private preset file.
 * Throws when the preset holds an API key (a line, or a note that looks like one).
 * Returns the text and key NAMES only.
 * @param {string} templateText @param {string} presetText
 * @returns {{ text: string, applied: string[], ignored: string[] }}
 */
export function applyPreset(templateText, presetText) {
  /** @type {Map<string, string>} */
  const values = new Map();
  /** @type {string[]} */
  const comments = [];
  splitLines(presetText).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      if (KEY_ASSIGNMENT.test(trimmed)) {
        throw new Error(`the preset has a note on line ${index + 1} that looks like it holds an API key. Remove it.`);
      }
      comments.push(trimmed);
      return;
    }
    const match = ENV_LINE.exec(line);
    if (match) values.set(match[1], unquote(match[2]));
  });
  for (const key of SECRET_KEYS) {
    if ((values.get(key) ?? '') !== '') {
      throw new Error(`the preset has a value for ${key}. A preset may only prefill non-secret lines; every person types their own key.`);
    }
  }

  const applied = PRESET_KEYS.filter((key) => (values.get(key) ?? '') !== '');
  const ignored = [...values.keys()].filter((key) => !applied.includes(key)).sort();
  let lines = splitLines(templateText);
  for (const key of applied) {
    const value = /** @type {string} */ (values.get(key));
    const index = lines.findIndex((line) => ENV_LINE.exec(line)?.[1] === key);
    if (index < 0) throw new Error(`the settings template has no ${key} line to fill in.`);
    lines[index] = `${key}=${value}`;
  }

  if (comments.length > 0) {
    let headerEnd = 0;
    while (headerEnd < lines.length && lines[headerEnd].trimStart().startsWith('#')) headerEnd += 1;
    const rest = lines.slice(headerEnd);
    const block = ['', '# Notes from the person who prepared this', ...comments];
    if (rest.length > 0 && rest[0].trim() !== '') block.push('');
    lines = [...lines.slice(0, headerEnd), ...block, ...rest];
  }
  const text = lines.join('\n');
  assertKeysEmpty(text);
  return { text, applied, ignored };
}

// ---- Modes and line endings -------------------------------------------------------------------

/** @param {string} text */
export const toLf = (text) => text.replace(/\r\n?/g, '\n');
/** @param {string} text */
export const toCrlf = (text) => toLf(text).replace(/\n/g, '\r\n');

/** @param {string} text @param {'lf' | 'crlf'} style */
export function fixLineEndings(text, style) {
  return style === 'crlf' ? toCrlf(text) : toLf(text);
}

/** @param {string} relPath */
const normalise = (relPath) => relPath.split(sep).join('/').replace(/^\.\//, '');

/**
 * Which line endings a file of the ZIP must have, or null to leave it alone (the app and the
 * runtimes are not ours to rewrite). `relPath` is relative to HybridDemo/.
 * @param {string} relPath @param {'darwin' | 'win32'} platform @returns {'lf' | 'crlf' | null}
 */
export function lineEndingStyleFor(relPath, platform) {
  const path = normalise(relPath);
  if (path.startsWith('app/') || path.startsWith('runtime/') || path.startsWith('data/')) return null;
  if (path.endsWith('.cmd')) return 'crlf';
  if (path.endsWith('.command')) return 'lf';
  if (path.startsWith('launcher/') && path.endsWith('.mjs')) return 'lf';
  if (path === 'READ ME FIRST.txt' || path === 'my-settings.env') return platform === 'win32' ? 'crlf' : 'lf';
  return null;
}

/** 755 for the double-click starters and the runtime binaries, 644 for every other file. @param {string} relPath */
export function modeFor(relPath) {
  const path = normalise(relPath);
  if (!path.includes('/') && path.endsWith('.command')) return 0o755;
  if (/^runtime\/[^/]+\/bin\/node$/.test(path)) return 0o755;
  return 0o644;
}

/**
 * Every file under `root` (relative paths, "/" separators), directories first-class so symlinks
 * and empty folders are seen. Sorted for a stable order.
 * @param {string} root @returns {{ rel: string, abs: string, kind: 'file' | 'dir' | 'symlink' | 'other' }[]}
 */
export function walk(root) {
  /** @type {{ rel: string, abs: string, kind: 'file' | 'dir' | 'symlink' | 'other' }[]} */
  const out = [];
  /** @param {string} dir @param {string} prefix */
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = join(dir, entry.name);
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) out.push({ rel, abs, kind: 'symlink' });
      else if (entry.isDirectory()) {
        out.push({ rel, abs, kind: 'dir' });
        visit(abs, rel);
      } else if (entry.isFile()) out.push({ rel, abs, kind: 'file' });
      else out.push({ rel, abs, kind: 'other' });
    }
  };
  visit(root, '');
  return out;
}

/**
 * Sets line endings and modes across a staged HybridDemo/ folder. Returns what it changed (counts).
 * @param {string} root @param {'darwin' | 'win32'} platform
 */
export function normalizeTree(root, platform) {
  let rewritten = 0;
  for (const item of walk(root)) {
    if (item.kind === 'dir') {
      chmodSync(item.abs, 0o755);
      continue;
    }
    if (item.kind !== 'file') continue;
    const style = lineEndingStyleFor(item.rel, platform);
    if (style) {
      const before = readFileSync(item.abs, 'utf8');
      const after = fixLineEndings(before, style);
      if (after !== before) {
        writeFileSync(item.abs, after);
        rewritten += 1;
      }
    }
    chmodSync(item.abs, modeFor(item.rel));
  }
  return { rewritten };
}

// ---- Scan of the staged tree ------------------------------------------------------------------

/** Rule names the scan reports. Each has a fixture in build-lib.test.ts. */
export const SCAN_RULES = [
  'env-file',
  'database-file',
  'key-file',
  'git-file',
  'symlink',
  'unusual-file',
  'home-path',
  'build-path',
  'api-key-value',
  'non-ascii-cmd',
  'deny-list',
];

const HOME_PATH = /(?:\/Users\/|[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))[A-Za-z0-9._-]/;

/**
 * Third-party code: the traced packages and the compiled build output. Published packages keep example
 * paths such as "/Users/foo/APP" in comments (stock Next.js does, in files that ship), so the general
 * home-path pattern is not applied there. The paths of THIS machine are still refused there (build-path).
 */
const THIRD_PARTY_CODE = /^app\/(?:node_modules\/|\.next(?:-[A-Za-z0-9_-]+)?\/)/;

/** A build path shorter than this ("/", "/usr") would match ordinary text, so it is ignored. */
const MIN_BUILD_PATH_LENGTH = 8;

/** One term per line; blank lines and lines starting with # are ignored. @param {string} text */
export function parseDenyList(text) {
  return splitLines(text)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.toLowerCase());
}

/**
 * Name rules for one path segment. @param {string} name @returns {string | null}
 */
function nameRule(name) {
  const lower = name.toLowerCase();
  if (lower.startsWith('.env')) return 'env-file';
  if (/\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/.test(lower)) return 'database-file';
  if (lower.endsWith('.pem') || lower.endsWith('.key')) return 'key-file';
  if (lower.startsWith('.git')) return 'git-file';
  return null;
}

/** A zero byte in the first 8 KB means a binary. Reads only that much, so a 100 MB runtime is not loaded. @param {string} path */
function looksBinary(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(8192);
    const count = readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, count).includes(0);
  } finally {
    closeSync(fd);
  }
}

/**
 * Looks at every file of a staged tree and returns the problems as file name plus rule name. It
 * never returns or prints matched text. Text files only for the content rules (a file with a zero
 * byte near the start is a binary and is skipped there).
 *
 * `buildPaths` are folders of the machine doing the build (home folder, repository, output folder): their
 * text must appear nowhere in the tree, third-party code included (rule build-path).
 * @param {string} root @param {{ denyTerms?: string[], buildPaths?: string[] }} [options]
 * @returns {{ file: string, rule: string }[]}
 */
export function scanStagedTree(root, options = {}) {
  const denyTerms = options.denyTerms ?? [];
  const buildPaths = (options.buildPaths ?? []).filter((path) => path.length >= MIN_BUILD_PATH_LENGTH).map((path) => path.toLowerCase());
  /** @type {{ file: string, rule: string }[]} */
  const findings = [];
  const add = (/** @type {string} */ file, /** @type {string} */ rule) => {
    if (!findings.some((f) => f.file === file && f.rule === rule)) findings.push({ file, rule });
  };
  for (const item of walk(root)) {
    const byName = nameRule(basename(item.rel));
    if (byName) add(item.rel, byName);
    if (denyTerms.length > 0) {
      const lowerPath = item.rel.toLowerCase();
      if (denyTerms.some((term) => lowerPath.includes(term))) add(item.rel, 'deny-list');
    }
    if (item.kind === 'symlink') add(item.rel, 'symlink');
    else if (item.kind === 'other') add(item.rel, 'unusual-file');
    if (item.kind !== 'file') continue;

    if (looksBinary(item.abs)) continue;
    const text = readFileSync(item.abs, 'utf8');
    if (!THIRD_PARTY_CODE.test(item.rel) && HOME_PATH.test(text)) add(item.rel, 'home-path');
    if (KEY_ASSIGNMENT.test(text)) add(item.rel, 'api-key-value');
    if (item.rel.endsWith('.cmd') && /[^\x00-\x7f]/.test(text)) add(item.rel, 'non-ascii-cmd');
    if (denyTerms.length > 0 || buildPaths.length > 0) {
      const lower = text.toLowerCase();
      if (buildPaths.some((path) => lower.includes(path))) add(item.rel, 'build-path');
      if (denyTerms.some((term) => lower.includes(term))) add(item.rel, 'deny-list');
    }
  }
  return findings;
}

/** @param {{ file: string, rule: string }[]} findings */
export function formatFindings(findings) {
  return findings.map((f) => `  ${f.file}  (${f.rule})`).join('\n');
}

// ---- Output -----------------------------------------------------------------------------------

/** @param {'mac' | 'windows'} target */
export function zipNameFor(target) {
  return TARGETS[target].zipName;
}

/** The SHA256SUMS.txt text: "<hash>  <name>" per ZIP, sorted by name. @param {{ name: string, sha256: string }[]} entries */
export function sha256SumsText(entries) {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((entry) => `${entry.sha256}  ${entry.name}\n`)
    .join('');
}

/** @param {number} bytes */
export function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/**
 * Zips `<stageRoot>/HybridDemo` into `zipPath` with the system zip (modes are kept, no extra attributes).
 * @param {{ stageRoot: string, zipPath: string }} args
 */
export function makeZip({ stageRoot, zipPath }) {
  rmSync(zipPath, { force: true });
  const result = spawnSync('zip', ['-X', '-r', '-q', zipPath, TOP_FOLDER], { cwd: stageRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`zip failed: ${(result.error?.message ?? result.stderr ?? '').trim().split('\n')[0]}`);
  }
  if (!statSync(zipPath).isFile()) throw new Error(`zip did not produce ${basename(zipPath)}.`);
}

/**
 * What must be inside the ZIP of one target, as paths inside HybridDemo/. Only what the builder itself
 * puts there, plus the server the payload step must have produced.
 * @param {'mac' | 'windows'} target @param {RuntimeFile[]} runtimeEntries
 */
export function requiredMembers(target, runtimeEntries) {
  return [
    'READ ME FIRST.txt',
    'my-settings.env',
    ...STARTER_NAMES[target],
    ...LAUNCHER_FILES.map(([, destination]) => destination),
    'app/server.js',
    ...runtimeEntries.map((entry) => runtimeMembers(entry)[0][1]),
  ];
}

/** `unzip -Z` of a finished ZIP: one line per entry with its Unix permissions. @param {string} zipPath */
export function listZip(zipPath) {
  const result = spawnSync('unzip', ['-Z', zipPath], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`could not read ${basename(zipPath)} to check it: ${(result.error?.message ?? result.stderr ?? '').trim().split('\n')[0]}`);
  }
  return result.stdout;
}

// "-rwxr-xr-x  3.0 unx   1234 b- defN 26-Oct-21 11:00 HybridDemo/Start live demo.command"
const LISTING_ROW = /^([-dl][-rwxsStT]{9})\s+(?:\S+\s+){7}(.+)$/;
const MAX_PROBLEMS_SHOWN = 10;

/**
 * Checks the listing of a finished ZIP against the contract: one top folder, every required member
 * there, and the Mac starters and runtimes executable (a double-click on a file that lost its
 * executable bit does nothing, and the person cannot tell why). Returns plain sentences.
 * @param {string} listing @param {{ target: 'mac' | 'windows', runtimeEntries: RuntimeFile[] }} args
 * @returns {string[]}
 */
export function zipProblems(listing, { target, runtimeEntries }) {
  /** Inside HybridDemo/: relative path to permissions. @type {Map<string, string>} */
  const entries = new Map();
  /** @type {string[]} */
  const problems = [];
  for (const line of splitLines(listing)) {
    const match = LISTING_ROW.exec(line);
    if (!match) continue;
    const name = match[2];
    if (name.startsWith(`${TOP_FOLDER}/`)) entries.set(name.slice(TOP_FOLDER.length + 1), match[1]);
    else problems.push(`${name} is outside the ${TOP_FOLDER} folder.`);
  }
  if (entries.size === 0 && problems.length === 0) return ['the ZIP holds no files or could not be read.'];
  for (const required of requiredMembers(target, runtimeEntries)) {
    if (!entries.has(required)) problems.push(`${required} is missing from the ZIP.`);
  }
  for (const [name, permissions] of entries) {
    if (modeFor(name) === 0o755 && permissions[3] !== 'x') problems.push(`${name} is not executable in the ZIP.`);
  }
  if (problems.length <= MAX_PROBLEMS_SHOWN) return problems;
  return [...problems.slice(0, MAX_PROBLEMS_SHOWN), `and ${problems.length - MAX_PROBLEMS_SHOWN} more.`];
}

/** True if the path is a real directory (not a link). @param {string} path */
export function isRealDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
