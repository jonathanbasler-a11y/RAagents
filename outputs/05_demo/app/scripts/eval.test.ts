import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { fixtureSpecs, makeLayout, writeSpecs, type TempLayout } from '@/server/agents/test-fixtures';
import {
  DONE_EVENT,
  TEST_HOST,
  chunkEvent,
  completionResponse,
  createFakeFetch,
  sseResponse,
  textResponse,
  type RecordedCall,
} from '@/server/llm/test-support/fake-gateway';
import type { GitState } from '../evals/lib/run';
import { judgeReply } from '../evals/lib/test-support';
import { parseEvalArgs, readGitState, redactingLog, runEvalCli } from './eval';

const AGENTS_MODEL = 'anthropic.claude-eval-test';
const JUDGE_MODEL = 'gpt-5.6-sol-eval-test';
const CLEAN: GitState = { commit: 'abc1234def0000000000000000000000000000ff', dirty: false };
const TOOL_CLAIM = "I(?: have|'ve)? (?:checked|searched)";

let keyCount = 0;
/** Fake settings with fresh keys, because the model client remembers a refused key for the whole process. */
function settings(patch: Record<string, string> = {}): Record<string, string> {
  keyCount += 1;
  return {
    LLM_BASE_URL: `https://${TEST_HOST}/v1`,
    LLM_API_KEY: `eval-agents-key-${keyCount}-zz9`,
    LLM_MODEL: AGENTS_MODEL,
    LLM_JUDGE_MODEL: JUDGE_MODEL,
    LLM_JUDGE_API_KEY: `eval-judge-key-${keyCount}-yy8`,
    ...patch,
  };
}

function evalCase(id: string, agent: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    version: 1,
    agent,
    category: 'normal',
    risk: 'standard',
    as_of: '2026-10-08',
    turns: [{ role: 'user', content: `Question for case ${id}?` }],
    expected: { required_phrases: ['to verify'], forbidden_patterns: [TOOL_CLAIM] },
    rubric: ['Marks asset points "to verify".'],
    ...patch,
  };
}

type Answer = (call: RecordedCall) => Response | Promise<Response>;

/** Agents stream a usable answer as the requested model; the judge answers with scores. */
const healthy: Answer = (call) => {
  const model = String(call.body.model);
  if (call.body.stream === true) {
    return sseResponse([chunkEvent('Each point is to verify.', { model, role: true }), chunkEvent(null, { model, finishReason: 'stop' }), DONE_EVENT], {
      signal: call.signal,
    });
  }
  return completionResponse(judgeReply(), { model });
};

interface Harness {
  layout: TempLayout;
  casesDir: string;
  outDir: string;
  /** The folder of case packs, when a test gives the run one. */
  packsDir?: string;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.layout.cleanup();
    rmSync(harness.casesDir, { recursive: true, force: true });
    if (harness.packsDir !== undefined) rmSync(harness.packsDir, { recursive: true, force: true });
  }
});

function harness(files: Record<string, unknown> = { 'lead.yaml': { cases: [evalCase('lead-one', 'lead')] }, 'cmc.yaml': { cases: [evalCase('cmc-one', 'cmc')] } }): Harness {
  const layout = makeLayout();
  writeSpecs(layout, fixtureSpecs());
  const casesDir = mkdtempSync(path.join(tmpdir(), 'eval-cli-cases-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(casesDir, name), typeof content === 'string' ? content : stringify(content));
  const created = { layout, casesDir, outDir: path.join(layout.appDir, '.eval-runs') };
  harnesses.push(created);
  return created;
}

async function cli(
  target: Harness,
  argv: string[] = [],
  options: { env?: Record<string, string>; answer?: Answer; git?: GitState; hostedPrompts?: boolean } = {},
) {
  const { fetch, calls } = createFakeFetch(Array.from({ length: 60 }, () => options.answer ?? healthy));
  const lines: string[] = [];
  let tick = 0;
  const code = await runEvalCli({
    argv,
    env: options.env ?? settings(),
    fetch,
    appDir: target.layout.appDir,
    specsDir: target.layout.specsDir,
    publicDir: target.layout.publicDir,
    casesDir: target.casesDir,
    ...(target.packsDir === undefined ? {} : { packsDir: target.packsDir }),
    outDir: target.outDir,
    git: () => options.git ?? CLEAN,
    print: (line) => lines.push(line),
    clock: () => new Date(Date.UTC(2026, 9, 8, 9, 0, tick++)),
    nodeVersion: 'v24.0.0-test',
    log: { error: () => {}, warn: () => {} },
    ...(options.hostedPrompts === undefined ? {} : { hostedPrompts: options.hostedPrompts }),
  });
  return { code, calls, output: lines.join('\n') };
}

const savedRuns = (target: Harness): string[] => {
  try {
    return readdirSync(target.outDir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
};

describe('npm run eval: a full run', () => {
  it('runs every case 3 times through the agents route and the judge route, saves the run and exits 0 on PASS', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = harness();

    const { code, calls, output } = await cli(target);

    expect(code).toBe(0);
    const agentCalls = calls.filter((call) => call.body.stream === true);
    const judgeCalls = calls.filter((call) => call.body.stream !== true);
    expect(agentCalls).toHaveLength(6);
    expect(judgeCalls).toHaveLength(6);
    expect(agentCalls.every((call) => call.body.model === AGENTS_MODEL)).toBe(true);
    expect(judgeCalls.every((call) => call.body.model === JUDGE_MODEL)).toBe(true);
    // Roster order: Rosa (lead) before Carlos (cmc), whatever the file names.
    const firstSystem = (agentCalls[0].body.messages as Array<{ content: string }>)[0].content;
    expect(firstSystem).toContain('You are Rosa.');

    const [file] = savedRuns(target);
    expect(file).toBe('2026-10-08T09-00-00-000Z-abc1234.json');
    const record = JSON.parse(readFileSync(path.join(target.outDir, file), 'utf8'));
    expect(record).toMatchObject({
      schema: 'dhht-eval-run/1',
      fingerprint: { commit: CLEAN.commit, dirty: false, reps: 3, judgeModel: { configured: JUDGE_MODEL, family: 'openai' } },
      verdict: { verdict: 'PASS', reasons: [] },
    });
    expect(record.results).toHaveLength(6);
    expect(output).toMatch(/Cases: 2 for 2 agents \(Rosa 1, Carlos 1\)/);
    expect(output).toMatch(/Run verdict: PASS/);
    expect(output).toMatch(/Saved: \.eval-runs\/2026-10-08T09-00-00-000Z-abc1234\.json/);
  });

  it('exits 1 for a completed run that is not a valid measurement, and still saves it', async () => {
    const target = harness();

    const { code, output } = await cli(target, ['--reps', '1']);

    expect(code).toBe(1);
    expect(output).toMatch(/Run verdict: INVALID \(fewer than 3 repetitions/);
    expect(savedRuns(target)).toHaveLength(1);
  });

  it('exits 1 for a run on uncommitted code (UNVERIFIABLE)', async () => {
    const { code, output } = await cli(harness(), [], { git: { commit: CLEAN.commit, dirty: true } });

    expect(code).toBe(1);
    expect(output).toMatch(/Run verdict: UNVERIFIABLE/);
  });

  it('never prints a key or the gateway host', async () => {
    const env = settings();

    const { output } = await cli(harness(), [], { env });

    for (const secret of [env.LLM_API_KEY, env.LLM_JUDGE_API_KEY, TEST_HOST]) expect(output).not.toContain(secret);
  });
});

describe('npm run eval: filters and options', () => {
  it('runs only the agents or cases asked for', async () => {
    const target = harness({ 'lead.yaml': { cases: [evalCase('lead-one', 'lead'), evalCase('lead-two', 'lead')] }, 'cmc.yaml': { cases: [evalCase('cmc-one', 'cmc')] } });

    const byAgent = await cli(target, ['--agent', 'cmc', '--reps=1']);
    const byCase = await cli(target, ['--case=lead-two,cmc-one', '--reps', '1']);

    expect(byAgent.calls.filter((call) => call.body.stream === true)).toHaveLength(1);
    expect(byAgent.output).toMatch(/Cases: 1 for 1 agent \(Carlos 1\)/);
    expect(byCase.calls.filter((call) => call.body.stream === true)).toHaveLength(2);
  });

  it('parses its options and refuses anything else', () => {
    expect(parseEvalArgs(['--agent', 'a,b', '--agent=c', '--case', 'x', '--reps=2', '--baseline', 'old.json'])).toEqual({
      ok: true,
      args: { agents: ['a', 'b', 'c'], cases: ['x'], reps: 2, baseline: 'old.json', check: false, help: false, hostedWording: false },
    });
    expect(parseEvalArgs(['--check'])).toMatchObject({ ok: true, args: { check: true } });
    expect(parseEvalArgs(['--hosted-wording'])).toMatchObject({ ok: true, args: { hostedWording: true } });
    expect(parseEvalArgs(['--fast'])).toEqual({ ok: false, message: 'unknown option "--fast"' });
    expect(parseEvalArgs(['--reps', 'three'])).toEqual({ ok: false, message: '--reps needs a whole number from 1 to 10' });
    expect(parseEvalArgs(['--agent'])).toEqual({ ok: false, message: '--agent needs a value' });
  });

  it('refuses prompts built with the hosted wording unless asked to measure it, before calling anything', async () => {
    const unasked = await cli(harness(), [], { hostedPrompts: true });
    expect(unasked.code).toBe(2);
    expect(unasked.output).toMatch(/prompts carry the hosted copy's wording/);
    expect(unasked.calls).toHaveLength(0);
  });

  it('refuses --hosted-wording when the prompts were built without it, as with a notice only in .env.local', async () => {
    const late = await cli(harness(), ['--hosted-wording'], { env: { ...settings(), RAAGENTS_HOSTED_NOTICE: 'Hosted practice copy' }, hostedPrompts: false });
    expect(late.code).toBe(2);
    expect(late.output).toMatch(/--hosted-wording needs RAAGENTS_HOSTED_NOTICE set in the shell/);
    expect(late.calls).toHaveLength(0);
  });

  it('measures the default wording, and says why, when a notice reaches only the env files', async () => {
    const { code, output } = await cli(harness(), ['--check'], { env: { ...settings(), RAAGENTS_HOSTED_NOTICE: 'Hosted practice copy' }, hostedPrompts: false });
    expect(code).toBe(0);
    expect(output).toMatch(/this run measures the default wording/);
  });

  it('says so in the output when it measures the hosted wording', async () => {
    const { code, output } = await cli(harness(), ['--hosted-wording', '--check'], { hostedPrompts: true });
    expect(code).toBe(0);
    expect(output).toMatch(/Hosted wording: on/);
  });

  it('prints help and exits 0 for --help, without calling anything', async () => {
    const { code, calls, output } = await cli(harness(), ['--help']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/Usage: npm run eval --/);
  });

  it('--check validates the cases against the roster and shows the settings, without any model call', async () => {
    const { code, calls, output } = await cli(harness(), ['--check'], { env: {} });

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/Cases: 2 for 2 agents/);
    expect(output).toMatch(/agents route: not configured/);
    expect(output).toMatch(/Cases OK\. No model was called\./);
  });
});

describe('npm run eval: setup problems exit 2 before any model call', () => {
  it('names the missing settings', async () => {
    const { code, calls, output } = await cli(harness(), [], { env: {} });

    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/LLM_BASE_URL/);
    expect(output).toMatch(/LLM_JUDGE_MODEL/);
  });

  it('refuses a judge of the agents’ model family', async () => {
    const { code, calls, output } = await cli(harness(), [], { env: settings({ LLM_JUDGE_MODEL: 'anthropic.claude-judge-test' }) });

    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/same model family/);
  });

  it('lists every problem in the case files', async () => {
    const target = harness({ 'lead.yaml': { cases: [evalCase('lead-one', 'lead', { expected: undefined }), evalCase('lead-one', 'lead')] } });

    const { code, calls, output } = await cli(target);

    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/asserts nothing/);
  });

  it('refuses a case for an agent that is not in the roster', async () => {
    const { code, output } = await cli(harness({ 'x.yaml': { cases: [evalCase('ghost-one', 'ghost')] } }));

    expect(code).toBe(2);
    expect(output).toMatch(/ghost-one: agent "ghost" is not an active agent/);
  });

  it('refuses unknown options, agents and cases in the filters', async () => {
    const target = harness();

    expect((await cli(target, ['--fast'])).code).toBe(2);
    expect((await cli(target, ['--agent', 'nobody'])).output).toMatch(/no cases for agent "nobody"/);
    expect((await cli(target, ['--case', 'no-such-case'])).output).toMatch(/no case with id "no-such-case"/);
  });

  it('refuses a baseline file it cannot read as a run record', async () => {
    const target = harness();
    mkdirSync(target.outDir, { recursive: true });
    const bad = path.join(target.outDir, 'bad.json');
    writeFileSync(bad, '{"schema": "something-else"}');

    const missing = await cli(target, ['--baseline', path.join(target.outDir, 'missing.json')]);
    const wrong = await cli(target, ['--baseline', bad]);

    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);
    expect(wrong.code).toBe(2);
    expect(wrong.output).toMatch(/not an eval run record/);
  });
});

describe('npm run eval: aborted runs exit 3 and save nothing', () => {
  it('aborts after 3 unusable answers in a row: a reply with no choices counts as unusable', async () => {
    const noChoices: Answer = (call) =>
      call.body.stream === true
        ? sseResponse([`data: ${JSON.stringify({ id: 'x', model: AGENTS_MODEL, choices: [] })}\n\n`, DONE_EVENT], { signal: call.signal })
        : healthy(call);
    const target = harness();

    const { code, output } = await cli(target, [], { answer: noChoices });

    expect(code).toBe(3);
    expect(output).toMatch(/ABORTED: 3 unusable answers in a row/);
    expect(output).toMatch(/Nothing was saved/);
    expect(savedRuns(target)).toEqual([]);
  });

  it('aborts when a refused key makes every answer fail', async () => {
    const refused: Answer = (call) => (call.body.stream === true ? textResponse('{"error":"invalid key"}', 401) : healthy(call));
    const target = harness();

    const { code } = await cli(target, [], { answer: refused });

    expect(code).toBe(3);
    expect(savedRuns(target)).toEqual([]);
  });

  it('aborts when the judge route answers with a model of the agents’ family', async () => {
    const sameFamily: Answer = (call) => (call.body.stream === true ? healthy(call) : completionResponse(judgeReply(), { model: 'anthropic.claude-sneaky' }));
    const target = harness();

    const { code, output } = await cli(target, [], { answer: sameFamily });

    expect(code).toBe(3);
    expect(output).toMatch(/same model family/);
    expect(savedRuns(target)).toEqual([]);
  });
});

describe('npm run eval -- --baseline', () => {
  it('compares a run with a saved baseline, case by case', async () => {
    const target = harness();
    await cli(target);
    const [baseline] = savedRuns(target);

    const { code, output } = await cli(target, ['--baseline', path.join(target.outDir, baseline)]);

    expect(code).toBe(0);
    expect(output).toMatch(/Comparison with the baseline run started 2026-10-08T09:00:00\.000Z \(commit abc1234\)/);
    expect(output).toMatch(/- All agents: \+0\.00 ±0\.00 over 2 cases: too few cases/);
  });
});

describe('readGitState', () => {
  it('reads HEAD and whether the app or the specs folder has uncommitted changes', () => {
    const commands: string[][] = [];
    const exec = (args: string[]) => {
      commands.push(args);
      return args[0] === 'rev-parse' ? 'abc123\n' : ' M src/x.ts\n';
    };

    expect(readGitState('/home/someone/repo/outputs/05_demo/app', '/home/someone/repo/outputs/04_agents', exec)).toEqual({ commit: 'abc123', dirty: true });
    expect(commands).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain', '--', '.', '../../04_agents'],
    ]);
  });

  it('says clean when git status prints nothing, and unknown when git fails', () => {
    expect(readGitState('/home/someone/app', '/home/someone/specs', (args) => (args[0] === 'rev-parse' ? 'abc\n' : ''))).toEqual({ commit: 'abc', dirty: false });
    expect(
      readGitState('/home/someone/app', '/home/someone/specs', () => {
        throw new Error('not a git repository');
      }),
    ).toEqual({ commit: null, dirty: null });
    expect(
      readGitState('/home/someone/app', '/home/someone/specs', (args) => {
        if (args[0] === 'rev-parse') return 'abc\n';
        throw new Error('pathspec outside repository');
      }),
    ).toEqual({ commit: 'abc', dirty: null });
  });
});

describe('redactingLog', () => {
  it('removes the configured keys and hosts from every line', () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const env = settings();

    redactingLog(env).error(`failed with ${env.LLM_API_KEY} at https://${TEST_HOST}/v1 and ${env.LLM_JUDGE_API_KEY}`);

    expect(errors.join('\n')).not.toContain(env.LLM_API_KEY);
    expect(errors.join('\n')).not.toContain(env.LLM_JUDGE_API_KEY);
    expect(errors.join('\n')).not.toContain(TEST_HOST);
  });
});

describe('npm run eval: case packs', () => {
  const DOC = '# Overview\n\nFictional practice document.\n\nThe licensor says the pivotal study met its endpoint.\n';

  /** Gives the harness a packs folder holding one pack (documents DR-01 and a withheld DR-02, one issue). */
  function withPack(target: Harness, patch: Record<string, unknown> = {}) {
    const root = mkdtempSync(path.join(tmpdir(), 'eval-cli-packs-'));
    const dir = path.join(root, 'practice-01');
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, 'pack.yaml'),
      stringify({
        id: 'practice-01',
        title: 'Practice case 01',
        as_of: '2026-10-08',
        documents: [
          { id: 'DR-01', title: 'Overview', file: 'dr-01.md', dated: '2026-07-01' },
          { id: 'DR-02', title: 'Paediatric plan', provided: false },
        ],
        issues: [
          {
            id: 'PI-01',
            kind: 'claim-vs-record',
            severity: 'high',
            planted_in: ['DR-01'],
            right_response: 'Shows the claim and says what is missing.',
            wrong_response: 'States the claim as fact.',
            failure_mode: 'Treats a company statement as the record.',
          },
        ],
        ...patch,
      }),
    );
    writeFileSync(path.join(dir, 'dr-01.md'), DOC);
    target.packsDir = root;
  }

  const packCase = (patch: Record<string, unknown> = {}) =>
    evalCase('lead-claims', 'lead', { category: 'grounded', risk: 'factual', pack: 'practice-01', documents: ['DR-01'], issues: ['PI-01'], ...patch });

  it('--check names the packs the cases use, with their document and issue counts, and calls no model', async () => {
    const target = harness({ 'lead.yaml': { cases: [packCase()] } });
    withPack(target);

    const { code, calls, output } = await cli(target, ['--check'], { env: {} });

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/Packs: practice-01 \(1 document shown, 1 issue in the key, 1 case\)/);
  });

  it('runs a case with its documents: the agent is sent the document text, and the run is saved', async () => {
    const target = harness({ 'lead.yaml': { cases: [packCase()] } });
    withPack(target);

    const { code, calls } = await cli(target, ['--reps', '1']);

    expect(code).toBe(1); // one repetition is a trial, never PASS; the point is that it ran and saved
    const sent = JSON.stringify(calls.find((call) => call.body.stream === true)?.body.messages);
    expect(sent).toContain('The licensor says the pivotal study met its endpoint.');
    expect(sent).toContain('Data room document DR-01');
    expect(savedRuns(target)).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(target.outDir, savedRuns(target)[0]), 'utf8')).fingerprint.packSetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exits 2 before any model call when a case names a pack that is not there, or shows a withheld document', async () => {
    const unknown = harness({ 'lead.yaml': { cases: [packCase({ pack: 'nope' })] } });
    withPack(unknown);
    const first = await cli(unknown);
    expect(first.code).toBe(2);
    expect(first.calls).toHaveLength(0);
    expect(first.output).toMatch(/unknown pack "nope"/);

    const withheld = harness({ 'lead.yaml': { cases: [packCase({ documents: ['DR-01', 'DR-02'] })] } });
    withPack(withheld);
    const second = await cli(withheld);
    expect(second.code).toBe(2);
    expect(second.calls).toHaveLength(0);
    expect(second.output).toMatch(/DR-02.*not provided/);
  });

  it('exits 2 before any model call when a pack holds a document dated after its as-of date', async () => {
    const target = harness({ 'lead.yaml': { cases: [packCase()] } });
    withPack(target, {
      documents: [
        { id: 'DR-01', title: 'Overview', file: 'dr-01.md', dated: '2026-10-09' },
        { id: 'DR-02', title: 'Paediatric plan', provided: false },
      ],
    });

    const { code, calls, output } = await cli(target);

    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/after the pack's as-of date/);
  });

  it('exits 2 when an issue of the pack is probed by no case, so the answer key cannot go untested', async () => {
    const target = harness({ 'lead.yaml': { cases: [packCase({ issues: undefined })] } });
    withPack(target);

    const { code, output } = await cli(target, ['--check'], { env: {} });

    expect(code).toBe(2);
    expect(output).toMatch(/PI-01 is probed by no case/);
  });
});
