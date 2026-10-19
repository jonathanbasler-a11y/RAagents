import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

// The scan behind the structure guards that say "this store method is used by these modules and no others".
// It reads the code with the TypeScript compiler API, so a comment, a string or a longer name that merely contains the
// word never counts, and an import, a call, a destructuring or a quoted property access always does.

export const SCAN_DIRS = ['src', 'scripts'];
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.(?:ts|tsx|mts)$/;
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.data']);

export type UseKind = 'import' | 'export' | 'property access' | 'quoted access' | 'destructuring' | 'object member' | 'type reference';

export interface Use {
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
export function findWriterUses(sourceText: string, fileName: string, writer: string): Use[] {
  const file = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const uses: Use[] = [];
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const add = (kind: UseKind, node: ts.Node) => uses.push({ kind, line: lineOf(node) });
  const isWriter = (name: ts.Node | undefined) =>
    name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === writer;

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
    } else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) && node.literal.text === writer) {
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
export function writerViolations(root: string, dirs: readonly string[], allowed: readonly string[], writer: string): string[] {
  const violations: string[] = [];
  for (const dir of dirs) {
    for (const path of walk(join(root, dir))) {
      const name = posix(relative(root, path));
      if (TEST_FILE.test(name) || allowed.includes(name)) continue;
      for (const use of findWriterUses(readFileSync(path, 'utf8'), name, writer)) violations.push(`${name}:${use.line} (${use.kind})`);
    }
  }
  return violations.sort();
}

