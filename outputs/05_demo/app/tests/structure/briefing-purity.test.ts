import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structure guard: the briefing is built by code only. No model is called anywhere on its path, the route only reads, and
// nothing writes to the register from it. A briefing that a model could change would be a document leaders quote with
// nothing behind it, so this is pinned by reading the code, not by trusting the next author.

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(APP_ROOT, path), 'utf8');

/** The code, without comments and strings, so a sentence that mentions a word never counts. */
const codeOf = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

const BRIEFING_FILES = ['src/shared/briefing.ts', 'src/app/api/_lib/briefing.ts', 'src/app/api/briefing/route.ts', 'src/components/BriefingPanel.tsx', 'src/components/BriefingCard.tsx', 'src/shared/gates.ts'];

describe('the briefing is built by code only', () => {
  it.each(BRIEFING_FILES)('%s imports no model client, no agent runner, no prompt builder and no store writer', (path) => {
    const imports = [...read(path).matchAll(/^import .*? from '([^']+)';$/gm)].map((match) => match[1]);

    for (const imported of imports) {
      expect(imported, `${path} imports ${imported}`).not.toMatch(/server\/llm|chat\/run-agent|server\/prompts|chat\/turn-runner|chat\/one-to-one|chat\/team/);
    }
  });

  it.each(BRIEFING_FILES)('%s calls no model and writes nothing to the register', (path) => {
    const code = codeOf(path);

    expect(code).not.toMatch(/\b(runAgent|createLlmClient|complete|stream)\s*\(/);
    expect(code).not.toMatch(/\.(proposeFindings|decideFinding|tagFinding|setChecklistState|decideGate|recordGateDissent|createDataRoom|addDocument|withdrawDocument)\b/);
  });

  it('has a route that only reads: GET, and nothing that changes anything', () => {
    const route = codeOf('src/app/api/briefing/route.ts');

    expect(route).toMatch(/export function GET\b/);
    expect(route).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
  });

  it('keeps the builder pure: no clock, no random, no network, no files', () => {
    const code = codeOf('src/shared/briefing.ts');

    expect(code).not.toMatch(/\b(Date\.now|new Date|Math\.random|fetch|readFileSync|process\.env)\b/);
  });

  it('finds the real files, so a clean result means something', () => {
    for (const path of BRIEFING_FILES) expect(read(path).length, path).toBeGreaterThan(100);
    expect(codeOf('src/app/api/_lib/briefing.ts')).toMatch(/buildBriefing\(/);
  });

  it('would notice a model call: the scan flags a fixture that has one', () => {
    const fixture = "import { runAgent } from '@/server/chat/run-agent';\nexport const x = () => runAgent('a', {}, {});\n";
    const imports = [...fixture.matchAll(/^import .*? from '([^']+)';$/gm)].map((match) => match[1]);

    expect(imports.some((module) => /chat\/run-agent/.test(module))).toBe(true);
    expect(/\b(runAgent)\s*\(/.test(fixture)).toBe(true);
  });
});
