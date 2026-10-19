import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { fixtureSpecs, makeLayout, writeSpecs, type TempLayout } from '@/server/agents/test-fixtures';
import { DONE_EVENT, TEST_HOST, chunkEvent, createFakeFetch, sseResponse, type RecordedCall } from '@/server/llm/test-support/fake-gateway';
import { FINDINGS_REQUEST_TEXT } from '@/shared/findings';
import type { GitState } from '../evals/lib/run';
import { runProposeCli, trialReason } from './eval-propose';
import type { ProposeRunRecord } from '../evals/lib/propose';

const AGENTS_MODEL = 'anthropic.claude-propose-test';
const CLEAN: GitState = { commit: 'abc1234def0000000000000000000000000000ff', dirty: false };
const DOC = '# Overview\n\nFictional practice document.\n\nThe licensor says the pivotal study met its endpoint.\n';
const PROPOSAL = `One finding.\n\n\`\`\`json\n${JSON.stringify({
  findings: [{ claim: 'The licensor says the study met its endpoint.', documentId: 'DR-01', quote: 'the pivotal study met its endpoint', confidence: 'high', confidenceReason: 'Explicit.', assumptions: [] }],
  unsupported: [],
})}\n\`\`\``;

let keyCount = 0;
/** Fake settings with fresh keys, because the model client remembers a refused key for the whole process. */
function settings(patch: Record<string, string> = {}): Record<string, string> {
  keyCount += 1;
  return { LLM_BASE_URL: `https://${TEST_HOST}/v1`, LLM_API_KEY: `propose-key-${keyCount}-zz9`, LLM_MODEL: AGENTS_MODEL, ...patch };
}

const lastUserText = (call: RecordedCall): string => {
  const messages = call.body.messages as Array<{ role: string; content: string }>;
  return messages[messages.length - 1].content;
};

type Answer = (call: RecordedCall) => Response | Promise<Response>;

/** The first answer, then (when the request ends the history) a proposal. */
const healthy: Answer = (call) => {
  const model = String(call.body.model);
  const text = lastUserText(call) === FINDINGS_REQUEST_TEXT ? PROPOSAL : 'DR-01 says the licensor states it. To verify.';
  return sseResponse([chunkEvent(text, { model, role: true }), chunkEvent(null, { model, finishReason: 'stop' }), DONE_EVENT], { signal: call.signal });
};
const blank: Answer = (call) => {
  const model = String(call.body.model);
  return sseResponse([chunkEvent('', { model, role: true }), chunkEvent(null, { model, finishReason: 'stop' }), DONE_EVENT], { signal: call.signal });
};

interface Harness {
  layout: TempLayout;
  casesDir: string;
  packsDir: string;
  outDir: string;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const target of harnesses.splice(0)) {
    target.layout.cleanup();
    rmSync(target.casesDir, { recursive: true, force: true });
    rmSync(target.packsDir, { recursive: true, force: true });
  }
});

function packCase(id: string, agent: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    version: 1,
    agent,
    category: 'grounded',
    risk: 'factual',
    as_of: '2026-10-08',
    pack: 'practice-01',
    documents: ['DR-01'],
    issues: ['PI-01'],
    turns: [{ role: 'user', content: `Question for case ${id}?` }],
    expected: { required_phrases: ['DR-01'] },
    rubric: ['Cites DR-01.'],
    ...patch,
  };
}

function harness(cases = [packCase('lead-claims', 'lead')]): Harness {
  const layout = makeLayout();
  writeSpecs(layout, fixtureSpecs());
  const casesDir = mkdtempSync(path.join(tmpdir(), 'propose-cli-cases-'));
  writeFileSync(path.join(casesDir, 'lead.yaml'), stringify({ cases }));
  const packsDir = mkdtempSync(path.join(tmpdir(), 'propose-cli-packs-'));
  const dir = path.join(packsDir, 'practice-01');
  mkdirSync(dir);
  writeFileSync(
    path.join(dir, 'pack.yaml'),
    stringify({
      id: 'practice-01',
      title: 'Practice case 01',
      as_of: '2026-10-08',
      documents: [
        { id: 'DR-01', title: 'Overview', file: 'dr-01.md', dated: '2026-07-01', source: 'company-disclosure' },
        { id: 'DR-02', title: 'Paediatric plan', provided: false },
      ],
      issues: [
        { id: 'PI-01', kind: 'claim-vs-record', severity: 'high', planted_in: ['DR-01'], right_response: 'Shows the claim.', wrong_response: 'States it as fact.', failure_mode: 'Treats a claim as the record.' },
      ],
    }),
  );
  writeFileSync(path.join(dir, 'dr-01.md'), DOC);
  const created = { layout, casesDir, packsDir, outDir: path.join(layout.appDir, '.eval-runs') };
  harnesses.push(created);
  return created;
}

async function cli(target: Harness, argv: string[] = [], options: { env?: Record<string, string>; answer?: Answer; git?: GitState } = {}) {
  const { fetch, calls } = createFakeFetch(Array.from({ length: 60 }, () => options.answer ?? healthy));
  const lines: string[] = [];
  let tick = 0;
  const code = await runProposeCli({
    argv,
    env: options.env ?? settings(),
    fetch,
    appDir: target.layout.appDir,
    specsDir: target.layout.specsDir,
    publicDir: target.layout.publicDir,
    casesDir: target.casesDir,
    packsDir: target.packsDir,
    outDir: target.outDir,
    git: () => options.git ?? CLEAN,
    print: (line) => lines.push(line),
    clock: () => new Date(Date.UTC(2026, 9, 8, 9, 0, tick++)),
    nodeVersion: 'v24.0.0-test',
    log: { error: () => {}, warn: () => {} },
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

describe('npm run eval:propose: a full run', () => {
  it('asks two questions per repetition on the agents route only, saves the run and exits 0', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = harness();

    const { code, calls, output } = await cli(target);

    expect(code).toBe(0);
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.body.model === AGENTS_MODEL && call.body.stream === true)).toBe(true);
    expect(calls.filter((call) => lastUserText(call) === FINDINGS_REQUEST_TEXT)).toHaveLength(3);
    const [file] = savedRuns(target);
    expect(file).toBe('propose-2026-10-08T09-00-00-000Z-abc1234.json');
    const record = JSON.parse(readFileSync(path.join(target.outDir, file), 'utf8')) as ProposeRunRecord;
    expect(record.schema).toBe('dhht-eval-propose/1');
    expect(record.results).toHaveLength(3);
    expect(record.results[0].proposal?.accepted[0]).toMatchObject({ documentId: 'DR-01', basis: 'attributed' });
    expect(output).toMatch(/lead-claims \(Rosa\): 3\/3 readable, 3 drafts of 3 proposed \(100% passed\)/);
    expect(output).toMatch(/Verdict: a valid run\./);
    expect(output).toMatch(/Saved: \.eval-runs\/propose-2026-10-08T09-00-00-000Z-abc1234\.json/);
    expect(output).not.toContain('the pivotal study met its endpoint');
  });

  it('exits 1 and says TRIAL for fewer than 3 repetitions, and still saves it', async () => {
    const target = harness();

    const { code, output } = await cli(target, ['--reps', '1']);

    expect(code).toBe(1);
    expect(output).toMatch(/Verdict: a TRIAL, not a measurement: 1 repetition, fewer than 3/);
    expect(savedRuns(target)).toHaveLength(1);
  });

  it('exits 1 for a run on uncommitted code', async () => {
    const { code, output } = await cli(harness(), [], { git: { commit: CLEAN.commit, dirty: true } });

    expect(code).toBe(1);
    expect(output).toMatch(/TRIAL.*uncommitted changes/);
  });

  it('never prints a key or the gateway host', async () => {
    const env = settings();

    const { output } = await cli(harness(), [], { env });

    for (const secret of [env.LLM_API_KEY, TEST_HOST]) expect(output).not.toContain(secret);
  });

  it('stops after three unusable answers in a row (exit 3) and saves nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = harness();

    const { code, output } = await cli(target, [], { answer: blank });

    expect(code).toBe(3);
    expect(output).toMatch(/ABORTED: 3 unusable answers in a row/);
    expect(output).toMatch(/Nothing was saved/);
    expect(savedRuns(target)).toEqual([]);
  });
});

describe('npm run eval:propose: options and setup', () => {
  it('lists the cases and the model with --check, and calls no model', async () => {
    const { code, calls, output } = await cli(harness(), ['--check']);

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(output).toMatch(/Proposal cases: 1 \(lead-claims\)/);
    expect(output).toContain(`agents route: model ${AGENTS_MODEL}`);
    expect(output).toMatch(/No model was called/);
  });

  it('leaves out a case with more than one turn, or with no pack', async () => {
    const target = harness([
      packCase('lead-claims', 'lead'),
      packCase('lead-multi', 'lead', { turns: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }),
    ]);

    const { output } = await cli(target, ['--check']);

    expect(output).toMatch(/Proposal cases: 1 \(lead-claims\)/);
  });

  it('refuses --baseline, an unknown option, an unknown case and an unset model, before any call', async () => {
    const target = harness();

    const baseline = await cli(target, ['--baseline', 'x.json']);
    const unknown = await cli(target, ['--nope']);
    const missingCase = await cli(target, ['--case', 'nothing-here']);
    const unconfigured = await cli(target, [], { env: {} });

    expect([baseline.code, unknown.code, missingCase.code, unconfigured.code]).toEqual([2, 2, 2, 2]);
    expect(baseline.output).toMatch(/--baseline is not supported/);
    expect(missingCase.output).toMatch(/no proposal case with id "nothing-here"/);
    expect(unconfigured.output).toMatch(/agents route is not configured/);
    for (const run of [baseline, unknown, missingCase, unconfigured]) expect(run.calls).toHaveLength(0);
  });

  it('shows its usage with --help', async () => {
    const { code, output } = await cli(harness(), ['--help']);

    expect(code).toBe(0);
    expect(output).toMatch(/Usage: npm run eval:propose/);
  });
});

describe('trialReason', () => {
  const record = (patch: Partial<ProposeRunRecord['fingerprint']>) => ({ fingerprint: { reps: 3, commit: 'abc', dirty: false, ...patch } }) as ProposeRunRecord;

  it('is null only for 3 or more repetitions on a clean, known commit', () => {
    expect(trialReason(record({}))).toBeNull();
    expect(trialReason(record({ reps: 2 }))).toMatch(/fewer than 3/);
    expect(trialReason(record({ commit: null }))).toMatch(/could not be read/);
    expect(trialReason(record({ dirty: null }))).toMatch(/could not be read/);
    expect(trialReason(record({ dirty: true }))).toMatch(/uncommitted/);
  });
});
