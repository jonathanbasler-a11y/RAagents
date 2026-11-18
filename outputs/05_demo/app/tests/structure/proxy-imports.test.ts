import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

// Structure guard: the proxy (src/proxy.ts) runs before every request, so what it loads must stay small and must never
// write. It reaches exactly the host and sign-in gates, the shared account rules, the read-only session lookup and the
// database opener; never the chat store or runtime, whose first use would migrate and reconcile turns from inside the
// proxy. And the session lookup holds no SQL that writes. Both read the code with the TypeScript compiler API.

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PROXY_MODULES = [
  'src/proxy.ts',
  'src/server/access-gate.ts',
  'src/server/accounts/session-lookup.ts',
  'src/server/db/paths.ts',
  'src/server/db/sqlite.ts',
  'src/server/request-gate.ts',
  'src/shared/accounts.ts',
];

const posix = (path: string) => path.split(sep).join('/');

/** The module specifiers a file imports or re-exports, type-only ones included. */
function specifiersOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A local module's file, or null for a package or a Node built-in. */
function resolveLocal(root: string, from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(root, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith(sep) && /\.tsx?$/.test(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

/** Every local file reachable from the entry, as app-relative paths. */
export function reachableFrom(root: string, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [join(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(file)) {
      const target = resolveLocal(root, file, specifier);
      if (target !== null) queue.push(target);
    }
  }
  return [...seen].map((file) => posix(relative(root, file))).sort();
}

const WRITE_SQL = /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|ATTACH)\b/i;

/** String and template literals in a file that look like SQL that writes. */
export function writingSql(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && WRITE_SQL.test(node.text)) found.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'proxy-imports-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('what the proxy loads', () => {
  it('reaches exactly the gates, the account rules, the session lookup and the database opener', () => {
    expect(reachableFrom(APP_ROOT, 'src/proxy.ts')).toEqual(PROXY_MODULES);
  });

  it('flags a proxy that reaches the chat store through another module, so an exact list means something', () => {
    const root = fixtureApp({
      'src/proxy.ts': `import { lookup } from '@/server/accounts/session-lookup';\nexport const proxy = lookup;\n`,
      'src/server/accounts/session-lookup.ts': `import type { Store } from '../chat/store';\nexport const lookup = (s: Store) => s;\n`,
      'src/server/chat/store.ts': `export interface Store { x: number }\n`,
    });
    expect(reachableFrom(root, 'src/proxy.ts')).toContain('src/server/chat/store.ts');
  });
});

describe('the session lookup', () => {
  it('holds no SQL that writes', () => {
    expect(writingSql(join(APP_ROOT, 'src/server/accounts/session-lookup.ts'))).toEqual([]);
  });

  it('flags SQL that writes, so an empty list means something', () => {
    const root = fixtureApp({ 'lookup.ts': "const touch = `UPDATE account_sessions SET seen = 1`;\nconst read = 'SELECT 1';\n" });
    expect(writingSql(join(root, 'lookup.ts'))).toEqual(['UPDATE account_sessions SET seen = 1']);
  });
});
