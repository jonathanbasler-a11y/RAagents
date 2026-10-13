// Protected names: real people's names must never reach this public repo
// (docs/BUILD-LEARNINGS.md Part 10, "Real data in a public repo").
//
// The list is a git-ignored file at the repo root, .protected-names.sha256: one SHA-256
// hex digest per line, each of a lower-cased name ("first" or "first last"). Names are
// never stored in clear, here or in that file, and a failure never prints a name: it
// shows the file, the line and the first 12 characters of the matching digest.
//
// Scope: the app's src, tests and scripts (and evals, when present), the app's own Markdown
// docs (README.md, LIVE-DEMO.md, ...), the repo's docs/ folder and the agent specs in
// outputs/04_agents.
// Every word and every two-word sequence counts, in any letter case, across line breaks
// and punctuation. Possessives, hyphens, accents, camelCase and snake_case are handled.
//
// Without the file, the repo check is skipped with a message saying how to create it.
// PROTECTED_NAMES_FILE=<path> points the check at another file, which must then exist.
// The self-tests run every time, on synthetic text, so the guard is proven to fire.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Not `new URL('..', import.meta.url)`: Vite rewrites that pattern into a dev-server URL.
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '..', '..', '..');
const LIST_FILE_NAME = '.protected-names.sha256';
const APP = 'outputs/05_demo/app';

/**
 * The JavaScript the instructions hand to `node -e` to turn one name into one list line.
 * It folds accents, lower-cases and collapses spaces: the normal form the scan matches.
 * A self-test runs it, so the instructions cannot drift away from the scan.
 */
const HASH_SNIPPET =
  'const n=process.argv[1].normalize("NFD").replace(/\\p{M}/gu,"").toLowerCase().trim().split(/\\s+/).join(" ");' +
  'console.log(require("node:crypto").createHash("sha256").update(n).digest("hex"))';

interface Hit {
  line: number;
  digest: string;
}

interface Violation extends Hit {
  /** Repo-relative, with forward slashes. */
  file: string;
}

type ListState =
  | { kind: 'absent' }
  | { kind: 'missing'; source: string }
  | { kind: 'empty'; source: string }
  | { kind: 'invalid'; source: string; lines: number[] }
  | { kind: 'ok'; source: string; digests: Set<string> };

type Plan = { action: 'skip'; note: string } | { action: 'fail'; message: string } | { action: 'scan'; digests: Set<string> };

// ---------------------------------------------------------------------------------------
// The guard

/** Scanned recursively, relative to the repo root. Each must exist. */
const SCOPE_DIRS = [`${APP}/src`, `${APP}/tests`, `${APP}/scripts`, 'docs', 'outputs/04_agents'];
/** Scanned recursively when present: eval cases are where a gold set with real names slipped in before. */
const OPTIONAL_SCOPE_DIRS = [`${APP}/evals`];
/** The app's own docs: the Markdown files directly in the app folder. */
const SCOPE_DOCS_DIR = APP;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const CURLY_APOSTROPHES = /[\u2018\u2019\u02BC]/g;
const UNICODE_HYPHENS = /[\u2010\u2011]/g;
const COMBINING_MARKS = /\p{M}/gu;
/** Words split at anything that is not a letter: "Name's" gives "name" and "s". */
const PLAIN_WORD = /[\p{L}\p{M}]+/gu;
/** Words kept whole across inner apostrophes and hyphens: "o'name", "first-second". */
const JOINED_WORD = /[\p{L}\p{M}]+(?:['-][\p{L}\p{M}]+)*/gu;
/** Between a lower-case and an upper-case letter: "firstSecond" gives "first" and "Second". */
const CAMEL_BOUNDARY = /(?<=\p{Ll})(?=\p{Lu})/u;

const TOKENIZERS: ReadonlyArray<readonly [pattern: RegExp, splitCamelCase: boolean]> = [
  [PLAIN_WORD, false],
  [PLAIN_WORD, true],
  [JOINED_WORD, false],
];

/** Lower-cased words of `text` with the line each starts on. */
function words(text: string, pattern: RegExp, splitCamelCase: boolean): Array<{ word: string; line: number }> {
  const found: Array<{ word: string; line: number }> = [];
  let line = 1;
  let counted = 0;
  for (const match of text.matchAll(pattern)) {
    for (let at = text.indexOf('\n', counted); at !== -1 && at < match.index; at = text.indexOf('\n', at + 1)) line += 1;
    counted = match.index;
    for (const part of splitCamelCase ? match[0].split(CAMEL_BOUNDARY) : [match[0]]) {
      found.push({ word: part.toLowerCase(), line });
    }
  }
  return found;
}

/** Every word and two-word sequence in `text`, in the normal form the list uses, with its lines. */
function candidates(text: string): Map<string, Set<number>> {
  const normal = text.normalize('NFC').replace(CURLY_APOSTROPHES, "'").replace(UNICODE_HYPHENS, '-');
  const accentFree = normal.normalize('NFD').replace(COMBINING_MARKS, '');
  const found = new Map<string, Set<number>>();
  const add = (candidate: string, line: number) => {
    const lines = found.get(candidate) ?? new Set<number>();
    lines.add(line);
    found.set(candidate, lines);
  };
  for (const source of [normal, accentFree]) {
    for (const [pattern, splitCamelCase] of TOKENIZERS) {
      const stream = words(source, pattern, splitCamelCase);
      stream.forEach((current, index) => {
        add(current.word, current.line);
        const next = stream[index + 1];
        if (next !== undefined) add(`${current.word} ${next.word}`, current.line);
      });
    }
  }
  return found;
}

/** Where `text` holds a word or two-word sequence whose digest is listed, by line. */
function scanText(text: string, digests: ReadonlySet<string>): Hit[] {
  const hits: Hit[] = [];
  for (const [candidate, lines] of candidates(text)) {
    const digest = sha256(candidate);
    if (!digests.has(digest)) continue;
    for (const line of lines) hits.push({ line, digest });
  }
  return hits.sort((a, b) => a.line - b.line || a.digest.localeCompare(b.digest));
}

/** "<64 hex>", or what `shasum -a 256` prints for standard input: "<64 hex>  -". */
const DIGEST_LINE = /^([0-9a-f]{64})(?:\s+-)?$/i;

/** Reads the list. `explicit`: the path came from PROTECTED_NAMES_FILE, so it must exist. */
function readList(file: string, explicit: boolean): ListState {
  const source = explicit ? 'PROTECTED_NAMES_FILE' : LIST_FILE_NAME;
  if (!existsSync(file)) return explicit ? { kind: 'missing', source } : { kind: 'absent' };
  const digests = new Set<string>();
  const invalid: number[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trim();
      if (line === '') return;
      const match = DIGEST_LINE.exec(line);
      if (match === null) invalid.push(index + 1);
      else digests.add(match[1].toLowerCase());
    });
  if (invalid.length > 0) return { kind: 'invalid', source, lines: invalid };
  if (digests.size === 0) return { kind: 'empty', source };
  return { kind: 'ok', source, digests };
}

/** Skip only when the default list is absent; anything else that is not a usable list fails. */
function planRepoCheck(state: ListState): Plan {
  switch (state.kind) {
    case 'absent':
      return {
        action: 'skip',
        note: [
          `protected names: check skipped, because there is no ${LIST_FILE_NAME} at the repo root.`,
          'To turn it on, create that git-ignored file with one SHA-256 digest per line, never a name.',
          'From the repo root, run this once per name (a full name, and a first name on its own):',
          `  node -e '${HASH_SNIPPET}' 'First Last' >> ${LIST_FILE_NAME}`,
          'Details: ORIENTATION.md, "Protected names".',
        ].join('\n'),
      };
    case 'missing':
      return {
        action: 'fail',
        message: 'PROTECTED_NAMES_FILE is set, but there is no file at that path. Point it at the list, or unset it.',
      };
    case 'empty':
      return {
        action: 'fail',
        message: `${state.source} holds no digests, so nothing would be checked. Add digests (see ORIENTATION.md, "Protected names") or delete the file.`,
      };
    case 'invalid':
      return {
        action: 'fail',
        message:
          `${state.source}: ${state.lines.length === 1 ? 'line' : 'lines'} ${state.lines.join(', ')} ` +
          `${state.lines.length === 1 ? 'is not a SHA-256 digest' : 'are not SHA-256 digests'}. ` +
          'The file holds digests only: never a name, and no comments.',
      };
    case 'ok':
      return { action: 'scan', digests: state.digests };
  }
}

/**
 * True when the repo's .gitignore lists `fileName` on a line of its own ("name" or "/name").
 * The digests are not secret: a first name is found again from its digest by guessing, so
 * the list must never be committed.
 */
function gitignoreCovers(repoRoot: string, fileName: string): boolean {
  const gitignore = path.join(repoRoot, '.gitignore');
  if (!existsSync(gitignore)) return false;
  return readFileSync(gitignore, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === fileName || line === `/${fileName}`);
}

/** Every file in scope: the scope folders (recursively) and the app's Markdown docs. */
function scopeFiles(repoRoot: string): string[] {
  const missing = SCOPE_DIRS.filter((folder) => !existsSync(path.join(repoRoot, folder)));
  if (missing.length > 0) {
    throw new Error(`protected names: scope folder not found: ${missing.join(', ')}. Update SCOPE_DIRS in this test.`);
  }
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      // Dot folders (caches, build output) and installed packages are not ours; dot files are.
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  for (const folder of SCOPE_DIRS) walk(path.join(repoRoot, folder));
  for (const folder of OPTIONAL_SCOPE_DIRS) {
    if (existsSync(path.join(repoRoot, folder))) walk(path.join(repoRoot, folder));
  }
  for (const entry of readdirSync(path.join(repoRoot, SCOPE_DOCS_DIR), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path.join(repoRoot, SCOPE_DOCS_DIR, entry.name));
  }
  return files;
}

/** Every listed name in scope, sorted by file and line. Binary files are skipped. */
function scanTree(repoRoot: string, digests: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  for (const file of scopeFiles(repoRoot)) {
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const hit of scanText(bytes.toString('utf8'), digests)) violations.push({ file: relative, ...hit });
  }
  return violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

// ---------------------------------------------------------------------------------------
// The repo check

describe('protected names in this repo', () => {
  it('no protected name appears in the app, its docs, the repo docs or the agent specs', (context) => {
    const override = process.env.PROTECTED_NAMES_FILE;
    const state =
      override === undefined || override === ''
        ? readList(path.join(REPO_ROOT, LIST_FILE_NAME), false)
        : readList(path.resolve(override), true);
    const plan = planRepoCheck(state);
    if (plan.action === 'skip') {
      // Visible with Vitest's default reporter (a terminal, CI). Under an AI agent Vitest
      // picks its minimal reporter, which hides this: add --reporter=default to see it.
      console.warn(plan.note);
      context.skip(plan.note);
      return;
    }
    if (plan.action === 'fail') throw new Error(plan.message);
    if (state.kind === 'ok' && state.source === LIST_FILE_NAME && !gitignoreCovers(REPO_ROOT, LIST_FILE_NAME)) {
      throw new Error(
        `${LIST_FILE_NAME} is at the repo root, but .gitignore does not list it. Add the line ` +
          `"${LIST_FILE_NAME}" to .gitignore first: the digests must never be committed.`,
      );
    }
    const found = scanTree(REPO_ROOT, plan.digests).map(
      (violation) => `${violation.file}:${violation.line} (digest ${violation.digest.slice(0, 12)}...)`,
    );
    expect(found, 'protected names found; the names themselves are not printed').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// Self-tests on synthetic text. "Fixturename" and "Fixturesurname" are stand-ins, not names.

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const FIRST = 'fixturename';
const LAST = 'fixturesurname';
const FULL = `${FIRST} ${LAST}`;

describe('scanText', () => {
  it('flags a listed word in any letter case, on every line it appears', () => {
    const hits = scanText('Intro line\nAsk FIXTURENAME first.\nThen Fixturename again.', new Set([sha(FIRST)]));

    expect(hits).toEqual([
      { line: 2, digest: sha(FIRST) },
      { line: 3, digest: sha(FIRST) },
    ]);
  });

  it('flags a listed two-word name across punctuation and a line break', () => {
    const hits = scanText('Notes from Fixturename,\nFixturesurname said so.', new Set([sha(FULL)]));

    expect(hits).toEqual([{ line: 1, digest: sha(FULL) }]);
  });

  it.each([
    ['a possessive with a curly apostrophe', 'Fixturename’s notes', FIRST],
    ['an accented spelling, against the accent-free entry', 'Fïxturename wrote', FIRST],
    ['a camelCase identifier', 'const fixturenameFixturesurnameId = 1;', FULL],
    ['a snake_case identifier', 'FIXTURENAME_FIXTURESURNAME = 1', FULL],
    ['a hyphenated name, as one word', 'Fixturename-Fixturesurname', `${FIRST}-${LAST}`],
    ['a name with a curly apostrophe inside', 'O’Fixturename', `o'${FIRST}`],
  ])('flags %s', (_label, text, listed) => {
    expect(scanText(text, new Set([sha(listed)]))).toEqual([{ line: 1, digest: sha(listed) }]);
  });

  it('does not flag words that only contain a listed name', () => {
    expect(scanText('Fixturenames, prefixturename and fixturenamely', new Set([sha(FIRST)]))).toEqual([]);
  });

  it('finds nothing when no listed digest matches', () => {
    expect(scanText('Rosa and Carlos discuss the new site.', new Set([sha(FIRST), sha(FULL)]))).toEqual([]);
  });
});

describe('readList', () => {
  let dir: string;
  const listIn = (folder: string) => path.join(folder, LIST_FILE_NAME);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'protected-names-list-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a missing default file as absent', () => {
    expect(readList(listIn(dir), false)).toEqual({ kind: 'absent' });
  });

  it('reports a missing file named by PROTECTED_NAMES_FILE as missing, not absent', () => {
    expect(readList(path.join(dir, 'elsewhere.sha256'), true)).toEqual({ kind: 'missing', source: 'PROTECTED_NAMES_FILE' });
  });

  it('reads plain, upper-case and shasum-style digest lines, skipping blank lines and CRLF', () => {
    writeFileSync(listIn(dir), `${sha(FIRST)}\r\n\r\n${sha(LAST).toUpperCase()}\n  ${sha(FULL)}  -\n`);

    const state = readList(listIn(dir), false);

    expect(state).toEqual({ kind: 'ok', source: LIST_FILE_NAME, digests: new Set([sha(FIRST), sha(LAST), sha(FULL)]) });
  });

  it('refuses lines that are not digests and keeps only their numbers, never their text', () => {
    writeFileSync(listIn(dir), `${sha(FIRST)}\nFixturename Fixturesurname\n# a comment\n`);

    expect(readList(listIn(dir), false)).toEqual({ kind: 'invalid', source: LIST_FILE_NAME, lines: [2, 3] });
  });

  it('reports a file without digests as empty', () => {
    writeFileSync(listIn(dir), '\n  \n');

    expect(readList(listIn(dir), false)).toEqual({ kind: 'empty', source: LIST_FILE_NAME });
  });
});

describe('planRepoCheck', () => {
  it('skips only when the default list is absent, with a note that says how to create it', () => {
    const plan = planRepoCheck({ kind: 'absent' });

    expect(plan.action).toBe('skip');
    expect(plan.action === 'skip' ? plan.note : '').toContain(`node -e '${HASH_SNIPPET}' 'First Last' >> ${LIST_FILE_NAME}`);
  });

  it.each<ListState>([
    { kind: 'missing', source: 'PROTECTED_NAMES_FILE' },
    { kind: 'empty', source: LIST_FILE_NAME },
    { kind: 'invalid', source: LIST_FILE_NAME, lines: [2, 3] },
  ])('fails, never skips, when the list is $kind', (state) => {
    const plan = planRepoCheck(state);

    expect(plan.action).toBe('fail');
    expect(plan.action === 'fail' ? plan.message : '').toContain(state.kind === 'missing' ? 'PROTECTED_NAMES_FILE' : LIST_FILE_NAME);
  });

  it('names the refused line numbers of an invalid list', () => {
    const plan = planRepoCheck({ kind: 'invalid', source: LIST_FILE_NAME, lines: [2, 3] });

    expect(plan.action === 'fail' ? plan.message : '').toContain('2, 3');
  });

  it('scans with the listed digests when the list is readable', () => {
    const digests = new Set([sha(FIRST)]);

    expect(planRepoCheck({ kind: 'ok', source: LIST_FILE_NAME, digests })).toEqual({ action: 'scan', digests });
  });
});

describe('gitignoreCovers', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'protected-names-ignore-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['the exact line', `node_modules/\n${LIST_FILE_NAME}\n`],
    ['the root-anchored line, with CRLF and spaces', `node_modules/\r\n  /${LIST_FILE_NAME}  \r\n`],
  ])('accepts %s', (_label, content) => {
    writeFileSync(path.join(dir, '.gitignore'), content);

    expect(gitignoreCovers(dir, LIST_FILE_NAME)).toBe(true);
  });

  it.each([
    ['no such line', 'node_modules/\n.env\n'],
    ['the line commented out', `# ${LIST_FILE_NAME}\n`],
    ['a negated line', `!${LIST_FILE_NAME}\n`],
  ])('refuses %s', (_label, content) => {
    writeFileSync(path.join(dir, '.gitignore'), content);

    expect(gitignoreCovers(dir, LIST_FILE_NAME)).toBe(false);
  });

  it('refuses when there is no .gitignore', () => {
    expect(gitignoreCovers(dir, LIST_FILE_NAME)).toBe(false);
  });
});

describe('the instructions in the skip note', () => {
  it('make a digest the scan matches, from a name typed with capitals, an accent and extra spaces', () => {
    const listLine = execFileSync(process.execPath, ['-e', HASH_SNIPPET, '  Fïxturename   Fixturesurname '], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    expect(listLine).toMatch(/^[0-9a-f]{64}$/);
    expect(scanText('Fixturename Fixturesurname', new Set([listLine]))).toEqual([{ line: 1, digest: listLine }]);
  });
});

describe('scanTree', () => {
  let root: string;
  const digests = new Set([sha(FIRST)]);
  const write = (relative: string, content: string | Buffer) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'protected-names-tree-'));
    for (const folder of [`${APP}/src`, `${APP}/tests`, `${APP}/scripts`, 'docs', 'outputs/04_agents']) {
      mkdirSync(path.join(root, folder), { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a listed name in every scanned place, by repo-relative file and line', () => {
    write(`${APP}/src/a.ts`, "// one\nconst who = 'Fixturename';\n");
    write(`${APP}/src/deep/er/b.tsx`, 'Fixturename\n');
    write(`${APP}/tests/c.test.ts`, 'Fixturename\n');
    write(`${APP}/tests/.fixture.json`, '{"name": "Fixturename"}\n');
    write(`${APP}/scripts/d.mjs`, 'x\ny\nFixturename\n');
    write(`${APP}/evals/cases/e.yaml`, '- question: Ask Fixturename\n');
    write(`${APP}/README.md`, 'Fixturename\n');
    write(`${APP}/LIVE-DEMO.md`, '\nFixturename\n');
    write('docs/notes.md', 'Fixturename\n');
    write('outputs/04_agents/x.md', 'Fixturename\n');

    expect(scanTree(root, digests).map((violation) => `${violation.file}:${violation.line}`)).toEqual([
      'docs/notes.md:1',
      'outputs/04_agents/x.md:1',
      `${APP}/LIVE-DEMO.md:2`,
      `${APP}/README.md:1`,
      `${APP}/evals/cases/e.yaml:1`,
      `${APP}/scripts/d.mjs:3`,
      `${APP}/src/a.ts:2`,
      `${APP}/src/deep/er/b.tsx:1`,
      `${APP}/tests/.fixture.json:1`,
      `${APP}/tests/c.test.ts:1`,
    ]);
  });

  it('leaves out everything outside the scope', () => {
    write('README.md', 'Fixturename\n');
    write('inputs/transcript.md', 'Fixturename\n');
    write('outputs/05_demo/ux-mockup/index.html', 'Fixturename\n');
    write(`${APP}/env.example`, 'Fixturename\n');
    write(`${APP}/public/avatars/CREDITS.md`, 'Fixturename\n');
    write(`${APP}/node_modules/pkg/README.md`, 'Fixturename\n');
    write(`${APP}/src/node_modules/pkg/index.js`, 'Fixturename\n');
    write(`${APP}/src/.cache/notes.txt`, 'Fixturename\n');

    expect(scanTree(root, digests)).toEqual([]);
  });

  it('skips binary files', () => {
    write(`${APP}/src/picture.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), Buffer.from('Fixturename')]));

    expect(scanTree(root, digests)).toEqual([]);
  });

  it('refuses to scan when a scope folder is missing, so a moved folder is never skipped silently', () => {
    rmSync(path.join(root, 'docs'), { recursive: true });

    expect(() => scanTree(root, digests)).toThrow('scope folder not found: docs.');
  });
});
