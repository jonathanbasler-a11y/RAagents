import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

// Structure guard: agent messages are written by the executors and nowhere else.
//
// The store's write function is the `appendAgentMessage` method. A reply (or a canned
// stand-in) that reached the chat any other way would skip the grants, gates and grounding
// every route into an agent goes through. This test reads the code with the TypeScript
// compiler API, so a comment, a string or a longer name that merely contains the word never
// counts, and an import, a call, a destructuring or a quoted property access always does.

const WRITER = 'appendAgentMessage';

/** Modules that may use the writer: the turn runner, and the one-to-one and team executors. */
const ALLOWED_WRITERS = [
  'src/server/chat/turn-runner.ts',
  'src/server/chat/one-to-one.ts',
  'src/server/chat/team.ts',
] as const;

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['src', 'scripts'];
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|mts)$/;
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.data']);

type UseKind = 'import' | 'export' | 'property access' | 'quoted access' | 'destructuring' | 'object member' | 'type reference';

interface Use {
  kind: UseKind;
  line: number;
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  return /\.(?:js|mjs|cjs)$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

/**
 * Every place the source uses the writer, as the compiler sees it. Declaring the method
 * (store.ts, the Store type in contracts.ts) is not a use; everything else is.
 */
function findWriterUses(sourceText: string, fileName: string): Use[] {
  const file = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const uses: Use[] = [];
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const add = (kind: UseKind, node: ts.Node) => uses.push({ kind, line: lineOf(node) });
  const isWriter = (name: ts.Node | undefined) =>
    name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === WRITER;

  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (isWriter(node.name) || isWriter(node.propertyName))) add('import', node);
    else if (ts.isExportSpecifier(node) && (isWriter(node.name) || isWriter(node.propertyName))) add('export', node);
    else if (ts.isPropertyAccessExpression(node) && isWriter(node.name)) add('property access', node);
    else if (ts.isElementAccessExpression(node) && isWriter(node.argumentExpression)) add('quoted access', node);
    else if (ts.isBindingElement(node) && (isWriter(node.name) || isWriter(node.propertyName))) add('destructuring', node);
    else if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      isWriter(node.name)
    ) {
      add('object member', node);
    } else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) && node.literal.text === WRITER) {
      add('type reference', node); // Pick<Store, 'appendAgentMessage'> and the like
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return uses;
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(join(dir, entry.name), found);
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const posix = (path: string) => path.split(sep).join('/');

/** Files outside the allowlist (and not test files) that use the writer, as "path:line (kind)". */
function writerViolations(root: string, dirs: readonly string[], allowed: readonly string[]): string[] {
  const violations: string[] = [];
  for (const dir of dirs) {
    for (const path of walk(join(root, dir))) {
      const name = posix(relative(root, path));
      if (TEST_FILE.test(name) || allowed.includes(name)) continue;
      for (const use of findWriterUses(readFileSync(path, 'utf8'), name)) violations.push(`${name}:${use.line} (${use.kind})`);
    }
  }
  return violations.sort();
}

describe('only the executors write agent messages', () => {
  it('has no importer, caller or re-exporter of the writer outside the allowlist and the tests', () => {
    expect(writerViolations(APP_ROOT, SCAN_DIRS, ALLOWED_WRITERS)).toEqual([]);
  });

  it('keeps the allowlist honest: every allowed module exists', () => {
    for (const path of ALLOWED_WRITERS) {
      expect(() => readFileSync(join(APP_ROOT, path), 'utf8'), path).not.toThrow();
    }
  });

  it('still finds the real writers, so an empty violation list means something', () => {
    const real = ALLOWED_WRITERS.filter((path) => findWriterUses(readFileSync(join(APP_ROOT, path), 'utf8'), path).length > 0);

    expect(real).toEqual(expect.arrayContaining(['src/server/chat/one-to-one.ts', 'src/server/chat/team.ts']));
  });
});

describe('findWriterUses: the detector sees every way in, and only those', () => {
  const kinds = (source: string, fileName = 'rogue.ts') => findWriterUses(source, fileName).map((use) => use.kind);

  it.each<[string, string, UseKind]>([
    ['a named import', `import { ${WRITER} } from '@/server/chat/store';`, 'import'],
    ['a renamed import', `import { ${WRITER} as write } from './store';`, 'import'],
    ['a call on the store', `store.${WRITER}(reply);`, 'property access'],
    ['an optional call', `deps.store?.${WRITER}(reply);`, 'property access'],
    ['a quoted access', `store['${WRITER}'](reply);`, 'quoted access'],
    ['a destructuring', `const { ${WRITER}: write } = store;`, 'destructuring'],
    ['a shorthand destructuring', `const { ${WRITER} } = store;`, 'destructuring'],
    ['a re-export', `export { ${WRITER} } from './store';`, 'export'],
    ['a forwarding wrapper', `export const forward = { ${WRITER}: store.${WRITER} };`, 'object member'],
    ['a type that picks it', `type Writer = Pick<Store, '${WRITER}'>;`, 'type reference'],
  ])('flags %s', (_label, source, kind) => {
    expect(kinds(source)).toContain(kind);
  });

  it('flags a TSX file too', () => {
    expect(kinds(`export const A = () => <b onClick={() => store.${WRITER}(x)} />;`, 'rogue.tsx')).toEqual(['property access']);
  });

  it('reports the line of the use', () => {
    expect(findWriterUses(`const a = 1;\n\nstore.${WRITER}(x);\n`, 'rogue.ts')).toEqual([{ kind: 'property access', line: 3 }]);
  });

  it('does not flag a comment, a string, a template, a longer name or a declaration', () => {
    const quiet = [
      `// store.${WRITER}(reply) is called by the executors`,
      `/* import { ${WRITER} } from './store' */`,
      `const text = "call ${WRITER} later";`,
      'const message = `use ${WRITER}`;',
      `const other = store.${WRITER}Draft(x);`,
      `const another = { before${WRITER}: 1 };`,
      `interface Store { ${WRITER}(input: Input): Result }`,
      `const impl = { ${WRITER}(input) { return input; } };`,
      `class Store { ${WRITER}(input: Input) { return input; } }`,
    ].join('\n');

    expect(kinds(quiet)).toEqual([]);
  });
});

describe('writerViolations: positive control (a fixture importer the guard must flag)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixtureApp(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'writer-allowlist-'));
    roots.push(root);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    return root;
  }

  const ALLOWED = ['src/server/chat/team.ts'];
  const call = `export function reply(store: { ${WRITER}(m: unknown): void }, m: unknown) { store.${WRITER}(m); }\n`;

  it('flags a rogue importer and names its file, line and kind', () => {
    const root = fixtureApp({
      'src/server/chat/team.ts': call,
      'src/server/api/rogue.ts': `import { ${WRITER} } from '@/server/chat/store';\nexport const x = ${WRITER};\n`,
    });

    expect(writerViolations(root, ['src'], ALLOWED)).toEqual(['src/server/api/rogue.ts:1 (import)']);
  });

  it('flags a rogue caller in a script and in a client component', () => {
    const root = fixtureApp({
      'scripts/seed.mjs': `store.${WRITER}({ text: 'canned' });\n`,
      'src/components/Rogue.tsx': `export const R = () => <i>{store.${WRITER}(1)}</i>;\n`,
    });

    expect(writerViolations(root, ['src', 'scripts'], ALLOWED)).toEqual([
      'scripts/seed.mjs:1 (property access)',
      'src/components/Rogue.tsx:1 (property access)',
    ]);
  });

  it('lets the allowlisted module and test files use it', () => {
    const root = fixtureApp({
      'src/server/chat/team.ts': call,
      'src/server/chat/team.test.ts': call,
      'src/components/Panel.test.tsx': `const t = <p>{store.${WRITER}(1)}</p>;\n`,
      'src/server/chat/store.ts': `export const store = { ${WRITER}(m: unknown) { return m; } };\n`,
    });

    expect(writerViolations(root, ['src'], ALLOWED)).toEqual([]);
  });

  it('is not fooled by a path that only looks like an allowed one', () => {
    const root = fixtureApp({ 'src/server/other/team.ts': call, 'src/server/chat/team.tsx': call });

    expect(writerViolations(root, ['src'], ALLOWED)).toEqual([
      'src/server/chat/team.tsx:1 (property access)',
      'src/server/other/team.ts:1 (property access)',
    ]);
  });
});
