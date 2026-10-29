import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SCAN_DIRS, findWriterUses as scanUses, writerViolations as scanViolations, type UseKind } from './writer-scan';

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

const findWriterUses = (source: string, fileName: string) => scanUses(source, fileName, WRITER);
const writerViolations = (root: string, dirs: readonly string[], allowed: readonly string[]) => scanViolations(root, dirs, allowed, WRITER);

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

// The findings register has two writers, each with exactly one door:
//   decideFinding   the only code that sets a finding's status: a person's accept or reject, through the API handler;
//   proposeFindings the only code that puts agent-drafted findings in the register: the one-to-one executor.
//   tagFinding      the only code that sets a tag after the fact: the findings handler (accepting sets it through decideFinding);
//   setChecklistState the only code that moves a checklist item: the checklist handler. Both are a person's action.
//   decideGate and recordGateDissent: the only code that records a gate decision or a dissent: the gates handler. Both are a person's action.
// Anything else calling them would create a finding, or decide one, without the checks or without a person.
const REGISTER_WRITERS = [
  { writer: 'decideFinding', allowed: ['src/app/api/_lib/findings.ts'] },
  { writer: 'proposeFindings', allowed: ['src/server/chat/one-to-one.ts'] },
  { writer: 'tagFinding', allowed: ['src/app/api/_lib/findings.ts'] },
  { writer: 'setChecklistState', allowed: ['src/app/api/_lib/checklist.ts'] },
  { writer: 'decideGate', allowed: ['src/app/api/_lib/gates.ts'] },
  { writer: 'recordGateDissent', allowed: ['src/app/api/_lib/gates.ts'] },
  // Accounts of a hosted copy, each writer with one door: the People page's handler creates, resets, disables and enables
  // people; the password handler changes a person's own password; the sign-in handler opens and closes sessions; the
  // server's start hook writes the admin from the server settings and the heartbeat. The account test harness creates
  // people and the admin the way those doors do, for the handler tests.
  { writer: 'createPersonAccount', allowed: ['src/app/api/_lib/admin-people.ts', 'src/app/api/_lib/account-test-support.ts'] },
  { writer: 'resetPersonPassword', allowed: ['src/app/api/_lib/admin-people.ts'] },
  { writer: 'setPersonDisabled', allowed: ['src/app/api/_lib/admin-people.ts'] },
  { writer: 'changeOwnPassword', allowed: ['src/app/api/_lib/account-password.ts'] },
  { writer: 'openSession', allowed: ['src/app/api/_lib/sign-in.ts'] },
  { writer: 'closeSession', allowed: ['src/app/api/_lib/sign-in.ts'] },
  { writer: 'bootstrapServerAdmin', allowed: ['src/server/accounts/runtime.ts', 'src/app/api/_lib/account-test-support.ts'] },
  { writer: 'touchHeartbeat', allowed: ['src/server/accounts/runtime.ts'] },
] as const;

describe.each(REGISTER_WRITERS)('only one module uses $writer', ({ writer, allowed }) => {
  it('has no importer, caller or re-exporter outside the allowlist and the tests', () => {
    expect(scanViolations(APP_ROOT, SCAN_DIRS, allowed, writer)).toEqual([]);
  });

  it('keeps the allowlist honest: the allowed module exists and really uses it', () => {
    for (const path of allowed) {
      expect(scanUses(readFileSync(join(APP_ROOT, path), 'utf8'), path, writer).length, path).toBeGreaterThan(0);
    }
  });

  it('flags a rogue caller in a fixture app, so an empty list means something', () => {
    const root = mkdtempSync(join(tmpdir(), 'register-writer-'));
    try {
      mkdirSync(join(root, 'src/app/api/rogue'), { recursive: true });
      writeFileSync(join(root, 'src/app/api/rogue/route.ts'), `export const POST = (store: any) => store.${writer}('demo', {});\n`);
      mkdirSync(join(root, 'src/server/chat'), { recursive: true });
      writeFileSync(join(root, 'src/server/chat/store.ts'), `export const store = { ${writer}() { return 1; } };\n`);

      expect(scanViolations(root, ['src'], allowed, writer)).toEqual(['src/app/api/rogue/route.ts:1 (property access)']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
