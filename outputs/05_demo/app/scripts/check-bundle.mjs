#!/usr/bin/env node
// Bundle check: the agents' prompt text must never reach the browser.
//
//   npm run check:bundle -- [<dist folder>]      (else NEXT_DIST_DIR, else ".next")
//
// PROMPT_MARKER (src/server/prompts/rules.ts) sits inside the shared rules every agent
// prompt carries, so it travels wherever the prompt text is bundled. This script looks for
// that string in a finished build:
//
// - Under <dist>/static (what the browser downloads) it must NOT appear: exit 1 if it does.
// - Under <dist>/server it MUST appear: exit 1 if it does not. That is the positive control.
//   Without it, a build that stopped carrying the marker at all (a renamed constant, a
//   dropped import, a different bundler layout) would pass the first check for the wrong reason.
//
// Exit codes: 0 pass, 1 the bundle failed a check (or could not be checked), 2 setup problem
// (the marker could not be read from the source).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL('../src/server/prompts/', import.meta.url));
const DEFAULT_DIST_DIR = '.next';
/** A marker shorter than this is too likely to occur by chance in minified code. */
const MIN_MARKER_LENGTH = 12;

const posix = (/** @type {string} */ path) => path.split(sep).join('/');

const isDirectory = (/** @type {string} */ path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The value of `export const PROMPT_MARKER = '...'` in the prompts folder (test files are
 * ignored). Throws when there is none, when two files disagree, or when it is too short.
 * @param {string} [promptsDir]
 * @returns {string}
 */
export function readPromptMarker(promptsDir = DEFAULT_PROMPTS_DIR) {
  let names;
  try {
    names = readdirSync(promptsDir).filter((name) => /\.(?:ts|tsx|mts)$/.test(name) && !/\.test\./.test(name));
  } catch (error) {
    throw new Error(`cannot read the prompts folder ${promptsDir}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? String(error)}`);
  }
  const definition = /\bexport\s+const\s+PROMPT_MARKER\s*(?::\s*string\s*)?=\s*(['"])([^'"\\\n]*)\1/;
  const values = new Set();
  for (const name of names.sort()) {
    const match = definition.exec(readFileSync(join(promptsDir, name), 'utf8'));
    if (match) values.add(match[2]);
  }
  if (values.size === 0) throw new Error(`no "export const PROMPT_MARKER = '...'" found in ${promptsDir}`);
  if (values.size > 1) throw new Error(`more than one different PROMPT_MARKER found in ${promptsDir}`);
  const [marker] = values;
  if (marker.length < MIN_MARKER_LENGTH) {
    throw new Error(`PROMPT_MARKER "${marker}" is too short to be a reliable marker (need at least ${MIN_MARKER_LENGTH} characters)`);
  }
  return marker;
}

/**
 * Every file under `dir` (all types, source maps included) whose bytes contain `marker`.
 * Paths are relative to `dir`, with "/" separators, sorted. Anything that is not a plain
 * file or folder (a symlink, say) or cannot be read goes to `couldNotCheck`: it is never
 * skipped quietly.
 * @param {string} dir
 * @param {string} marker
 * @returns {{ hits: string[], scanned: number, couldNotCheck: string[] }}
 */
export function scanForMarker(dir, marker) {
  if (marker === '') throw new Error('the marker is empty: it would match every file');
  const needle = Buffer.from(marker);
  /** @type {string[]} */ const hits = [];
  /** @type {string[]} */ const couldNotCheck = [];
  let scanned = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = /** @type {string} */ (pending.pop());
    /** @type {import('node:fs').Dirent[]} */
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      couldNotCheck.push(`${posix(relative(dir, current)) || '.'}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? String(error)}`);
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      const name = posix(relative(dir, path));
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        try {
          scanned += 1;
          if (readFileSync(path).includes(needle)) hits.push(name);
        } catch (error) {
          couldNotCheck.push(`${name}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? String(error)}`);
        }
      } else {
        couldNotCheck.push(`${name}: not a plain file or folder`);
      }
    }
  }
  return { hits: hits.sort(), scanned, couldNotCheck: couldNotCheck.sort() };
}

/**
 * Checks one finished build.
 * @param {{ distDir: string, marker: string }} input
 * @returns {{ ok: boolean, problems: string[], leaks: string[], serverHits: string[], scanned: { static: number, server: number } }}
 */
export function checkBundle({ distDir, marker }) {
  /** @type {string[]} */ const problems = [];
  /** @type {string[]} */ let leaks = [];
  /** @type {string[]} */ let serverHits = [];
  const scanned = { static: 0, server: 0 };

  if (!isDirectory(distDir)) {
    problems.push(`dist folder not found: ${distDir} (build first, with NEXT_DIST_DIR set if you built elsewhere)`);
    return { ok: false, problems, leaks, serverHits, scanned };
  }

  const staticDir = join(distDir, 'static');
  const serverDir = join(distDir, 'server');

  if (!isDirectory(staticDir)) {
    problems.push(`static folder not found: ${staticDir} (the client bundle was not checked)`);
  } else {
    const result = scanForMarker(staticDir, marker);
    scanned.static = result.scanned;
    leaks = result.hits.map((name) => `static/${name}`);
    for (const file of leaks) problems.push(`the prompt marker is in the client bundle: ${file}`);
    for (const note of result.couldNotCheck) problems.push(`could not check static/${note}`);
    if (result.scanned === 0) problems.push(`static folder has no files: ${staticDir} (nothing was checked)`);
  }

  if (!isDirectory(serverDir)) {
    problems.push(`server folder not found: ${serverDir} (the positive control could not run)`);
  } else {
    const result = scanForMarker(serverDir, marker);
    scanned.server = result.scanned;
    serverHits = result.hits.map((name) => `server/${name}`);
    for (const note of result.couldNotCheck) problems.push(`could not check server/${note}`);
    if (serverHits.length === 0) {
      problems.push(
        `the prompt marker was not found under server (${serverDir}): the check cannot tell a clean client bundle from a build that no longer carries the marker`,
      );
    }
  }

  return { ok: problems.length === 0, problems, leaks, serverHits, scanned };
}

/**
 * The command. Returns the exit code.
 * @param {string[]} argv arguments after the script name
 * @param {Record<string, string | undefined>} env
 * @param {{ cwd?: string, promptsDir?: string, log?: (line: string) => void, error?: (line: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, env, io = {}) {
  const { cwd = process.cwd(), promptsDir, log = console.log, error = console.error } = io;

  let marker;
  try {
    marker = readPromptMarker(promptsDir);
  } catch (problem) {
    error(`check-bundle: ${/** @type {Error} */ (problem).message}`);
    return 2;
  }

  const requested = argv[0] || env.NEXT_DIST_DIR || DEFAULT_DIST_DIR;
  const distDir = resolve(cwd, requested);
  const result = checkBundle({ distDir, marker });

  if (!result.ok) {
    error(`check-bundle: FAILED for ${requested}`);
    for (const problem of result.problems) error(`  - ${problem}`);
    return 1;
  }
  log(
    `check-bundle: ok for ${requested}. Prompt marker absent from ${result.scanned.static} client files; ` +
      `present in ${result.serverHits.length} of ${result.scanned.server} server files (positive control).`,
  );
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) process.exitCode = main(process.argv.slice(2), process.env);
