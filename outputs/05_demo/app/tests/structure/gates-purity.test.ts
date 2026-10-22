import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structure guard: a gate decision is a person's. The facts and the recommended call are built by code, no model is called
// anywhere on that path, the page that reads the gates only reads, and no agent, prompt or specification can reach a gate
// writer. An approval that a model could fill in, or that an agent could reach, would be a decision nobody made.
// Pinned by reading the code, not by trusting the next author.

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENTS_DIR = join(APP_ROOT, '..', '..', '04_agents');
const read = (path: string) => readFileSync(join(APP_ROOT, path), 'utf8');

/** The code, without comments and strings, so a sentence that mentions a word never counts. */
const codeOf = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

const importsOf = (source: string) => [...source.matchAll(/^import .*? from '([^']+)';$/gm)].map((match) => match[1]);
const MODEL_OR_AGENT = /server\/llm|chat\/run-agent|server\/prompts|chat\/turn-runner|chat\/one-to-one|chat\/team/;
const WRITERS = /\.(decideGate|recordGateDissent|proposeFindings|decideFinding|tagFinding|setChecklistState|createDataRoom|addDocument|withdrawDocument)\b/;

/** Everything that builds or shows the gates, and so must call no model. */
const GATE_FILES = [
  'src/shared/gates.ts',
  'src/app/api/_lib/gates.ts',
  'src/app/api/gates/route.ts',
  'src/app/api/gates/[gate]/decision/route.ts',
  'src/app/api/gates/[gate]/dissent/route.ts',
  'src/components/GatesProvider.tsx',
  'src/components/GatesPanel.tsx',
  'src/components/GatesSummary.tsx',
];

/** The part that only reads: the rules, the page and the card. The two posts of the handler are the person's writers. */
const READ_ONLY_FILES = ['src/shared/gates.ts', 'src/app/api/gates/route.ts', 'src/components/GatesSummary.tsx'];

describe('the gates are built by code, and decided by a person', () => {
  it.each(GATE_FILES)('%s imports no model client, no agent runner, no prompt builder and no executor', (path) => {
    for (const imported of importsOf(read(path))) {
      expect(imported, `${path} imports ${imported}`).not.toMatch(MODEL_OR_AGENT);
    }
  });

  it.each(GATE_FILES)('%s calls no model', (path) => {
    expect(codeOf(path)).not.toMatch(/\b(runAgent|createLlmClient|complete|stream)\s*\(/);
  });

  it.each(READ_ONLY_FILES)('%s only reads: it calls no writer of the store', (path) => {
    expect(codeOf(path)).not.toMatch(WRITERS);
  });

  it('has a gates route that only reads: GET, and nothing that changes anything', () => {
    const route = codeOf('src/app/api/gates/route.ts');

    expect(route).toMatch(/export function GET\b/);
    expect(route).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
  });

  it.each(['src/app/api/gates/[gate]/decision/route.ts', 'src/app/api/gates/[gate]/dissent/route.ts'])('%s is a post and nothing else', (path) => {
    const route = codeOf(path);

    expect(route).toMatch(/export async function POST\b/);
    expect(route).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)\b/);
  });

  it('puts the same-origin guard in front of both writes', () => {
    const handler = codeOf('src/app/api/_lib/gates.ts');

    expect(handler).toMatch(/checkSameOriginJson\(request\)/);
    expect(handler.indexOf('checkSameOriginJson')).toBeLessThan(handler.indexOf('readJsonBody'));
    expect(handler.indexOf('readJsonBody')).toBeLessThan(handler.indexOf('write(deps'));
  });

  it('keeps the rules pure: no clock, no random, no network, no files', () => {
    expect(codeOf('src/shared/gates.ts')).not.toMatch(/\b(Date\.now|new Date|Math\.random|fetch|readFileSync|process\.env)\b/);
  });

  it('takes the recommended call and the facts from the server, never from the request', () => {
    const rules = codeOf('src/shared/gates.ts');
    const store = codeOf('src/server/chat/store.ts');

    // The check compares the request with the gate as the server built it; the request type has no field for either.
    expect(rules).toMatch(/body\.option !== gate\.recommended/);
    expect(rules).not.toMatch(/body\.recommended|body\.facts\b/);
    expect(store).toMatch(/readGates\(workspaceId, team\)\.find/);
  });
});

describe('no agent, prompt or specification can reach a gate writer', () => {
  const GATE_WORDS = /decideGate|recordGateDissent|\/api\/gates|submitGateDecision|submitGateDissent/;
  const executors = ['src/server/chat/run-agent.ts', 'src/server/chat/turn-runner.ts', 'src/server/chat/one-to-one.ts', 'src/server/chat/team.ts', 'src/server/chat/team-router.ts'];
  const promptFiles = readdirSync(join(APP_ROOT, 'src/server/prompts')).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const specs = readdirSync(AGENTS_DIR).filter((name) => name.endsWith('.md'));

  it('finds the real files, so a clean result means something', () => {
    expect(specs.length).toBeGreaterThanOrEqual(25);
    expect(promptFiles.length).toBeGreaterThan(3);
    for (const path of executors) expect(read(path).length, path).toBeGreaterThan(100);
  });

  it.each(executors)('%s (an executor of agents) never names a gate writer or a gate address', (path) => {
    expect(codeOf(path)).not.toMatch(GATE_WORDS);
    expect(read(path)).not.toMatch(GATE_WORDS);
  });

  it('no prompt file names a gate writer or a gate address', () => {
    for (const name of promptFiles) expect(read(`src/server/prompts/${name}`), name).not.toMatch(GATE_WORDS);
  });

  it('no agent specification names a gate writer or a gate address', () => {
    for (const name of specs) expect(readFileSync(join(AGENTS_DIR, name), 'utf8'), name).not.toMatch(GATE_WORDS);
  });

  it('would notice a gate writer in a prompt: the scan flags a fixture that has one', () => {
    expect(GATE_WORDS.test('Call store.decideGate(workspaceId, gate, request, team) when the lead agrees.')).toBe(true);
    expect(GATE_WORDS.test('POST to /api/gates/scope/decision to approve.')).toBe(true);
    expect(GATE_WORDS.test('The lead decides at each gate.')).toBe(false);
  });

  it('would notice a model call and a writer in the read-only files: the scans flag fixtures that have them', () => {
    expect(/\b(runAgent|createLlmClient|complete|stream)\s*\(/.test("const r = runAgent('a', {}, {});")).toBe(true);
    expect(WRITERS.test('store.decideGate(workspaceId, gate, body, team);')).toBe(true);
    expect(WRITERS.test('store.listGates(workspaceId, team);')).toBe(false);
    expect(importsOf("import { runAgent } from '@/server/chat/run-agent';\n").some((module) => MODEL_OR_AGENT.test(module))).toBe(true);
  });
});
