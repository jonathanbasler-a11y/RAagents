import { describe, expect, it } from 'vitest';
import { fixtureSpecs } from '@/server/agents/test-fixtures';
import { PROPOSE_FINDINGS_INSTRUCTIONS } from '@/server/prompts/findings';
import { FINDINGS_REQUEST_TEXT, PROPOSAL_MAX_TOKENS } from '@/shared/findings';
import type { RunAgentContext, RunAgentResult } from '@/server/chat/run-agent';
import type { CasePack } from '../evals/lib/packs';
import {
  PROPOSE_RECORD_SCHEMA,
  coverageOf,
  formatProposeReport,
  proposalCases,
  runProposeEval,
  summarise,
  type ProposeRunDeps,
} from '../evals/lib/propose';
import { EVAL_FENCE_MARKER, EvalAbortedError, EvalSetupError, type GitState } from '../evals/lib/run';
import { AGENTS_MODEL, fakeRunAgent, idleAgentsClient, lookup, testCase, type FakeAnswer } from '../evals/lib/test-support';

const getAgent = lookup(fixtureSpecs());
const CLEAN: GitState = { commit: 'c0ffee0000000000000000000000000000000000', dirty: false };

const OVERVIEW = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';
const MINUTES = 'The agency noted that one study may be sufficient only if supported by confirmatory evidence of effectiveness.';

const PACK: CasePack = {
  id: 'practice-01',
  title: 'Practice case 01',
  asOf: '2026-10-08',
  documents: [
    { id: 'DR-01', title: 'Overview', provided: true, source: 'company-disclosure', dated: '2026-07-01', text: `# Overview\n\nFictional practice document.\n\n${OVERVIEW}` },
    { id: 'DR-02', title: 'Agency minutes', provided: true, source: 'agency-record', dated: '2026-03-20', text: `# Minutes\n\nFictional practice document.\n\n${MINUTES}` },
    { id: 'DR-09', title: 'Paediatric plan', provided: false, source: 'company-disclosure' },
  ],
  issues: [
    { id: 'PI-01', kind: 'claim-vs-record', severity: 'high', plantedIn: ['DR-01', 'DR-02'], rightResponse: 'r', wrongResponse: 'w', failureMode: 'f' },
    { id: 'PI-02', kind: 'withheld-document', severity: 'high', plantedIn: ['DR-09'], rightResponse: 'r', wrongResponse: 'w', failureMode: 'f' },
    { id: 'PI-03', kind: 'referral', severity: 'high', plantedIn: [], rightResponse: 'r', wrongResponse: 'w', failureMode: 'f' },
    { id: 'PI-04', kind: 'agent-error', severity: 'high', plantedIn: [], rightResponse: 'r', wrongResponse: 'w', failureMode: 'f' },
  ],
  hash: 'p'.repeat(64),
  source: 'practice-01',
};
const PACKS = new Map([[PACK.id, PACK]]);

const packCase = (patch: Parameters<typeof testCase>[0] = {}) =>
  testCase({ id: 'lead-single-study', pack: 'practice-01', documents: ['DR-01', 'DR-02'], issues: ['PI-01'], ...patch });

const reply = (body: unknown) => `Two findings.\n\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;
const finding = (documentId: string, quote: string, claim = `Claim about ${documentId}`) => ({
  claim,
  documentId,
  quote,
  confidence: 'medium',
  confidenceReason: 'Explicit.',
  assumptions: [],
});
const BOTH = reply({
  findings: [finding('DR-01', 'agreed one adequate and well-controlled pivotal study'), finding('DR-02', 'only if supported by confirmatory evidence of effectiveness')],
  unsupported: [{ claim: 'The paediatric plan is agreed.', reason: 'DR-09 is not in the data room.' }],
});

/** The first answer, then the proposal reply: the fake tells them apart by the request that ends the history. */
function answers(proposal: string | Partial<RunAgentResult>): FakeAnswer {
  return (_agentId: string, context: RunAgentContext) => {
    const last = context.history[context.history.length - 1];
    if (last?.content !== FINDINGS_REQUEST_TEXT) return { text: 'DR-01 says the licensor states it; DR-02 is the agency record. To verify.' };
    return typeof proposal === 'string' ? { text: proposal } : proposal;
  };
}

function setup(options: { answer?: FakeAnswer[]; git?: GitState } = {}) {
  const agent = fakeRunAgent(options.answer ?? [answers(BOTH)]);
  const lines: string[] = [];
  let tick = 0;
  const deps: ProposeRunDeps = {
    runAgent: agent.run,
    getAgent,
    agentsLlm: idleAgentsClient(AGENTS_MODEL),
    git: () => options.git ?? CLEAN,
    clock: () => new Date(Date.UTC(2026, 9, 8, 9, 0, tick++)),
    elapsed: () => (tick += 1) * 100,
    print: (line) => lines.push(line),
    nodeVersion: 'v24.0.0-test',
  };
  return { deps, agent, lines };
}

describe('proposalCases', () => {
  it('keeps single-question pack cases and drops the rest', () => {
    const keep = packCase();
    const noPack = testCase({ id: 'lead-plain' });
    const multi = packCase({ id: 'lead-multi', turns: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
    const referral = packCase({ id: 'lead-referral', issues: ['PI-03'] });
    const mistake = packCase({ id: 'lead-mistake', issues: ['PI-04'] });
    const withheld = packCase({ id: 'lead-withheld', issues: ['PI-02'] });

    expect(proposalCases([keep, noPack, multi, referral, mistake, withheld], PACKS).map((entry) => entry.id)).toEqual(['lead-single-study', 'lead-withheld']);
  });
});

describe('coverageOf', () => {
  it('is full when every shown document where the issue is planted has a draft, partial when some do, none when none do', () => {
    const evalCase = packCase();

    expect(coverageOf(evalCase, PACK, [{ documentId: 'DR-01' }, { documentId: 'DR-02' }])).toEqual([
      { issueId: 'PI-01', kind: 'claim-vs-record', documents: ['DR-01', 'DR-02'], covered: ['DR-01', 'DR-02'], coverage: 'full' },
    ]);
    expect(coverageOf(evalCase, PACK, [{ documentId: 'DR-01' }])[0]).toMatchObject({ covered: ['DR-01'], coverage: 'partial' });
    expect(coverageOf(evalCase, PACK, [{ documentId: 'DR-05' }])[0]).toMatchObject({ covered: [], coverage: 'none' });
  });

  it('counts only the documents the case shows, and only the kinds a draft can stand for', () => {
    const onlyOverview = packCase({ documents: ['DR-01'] });

    expect(coverageOf(onlyOverview, PACK, [{ documentId: 'DR-01' }])[0]).toMatchObject({ documents: ['DR-01'], coverage: 'full' });
    expect(coverageOf(packCase({ issues: ['PI-02', 'PI-03', 'PI-04'] }), PACK, [{ documentId: 'DR-01' }])).toEqual([]);
  });
});

describe('runProposeEval', () => {
  it('asks the first question, then the proposal, with the fixed request, the data room and the findings instructions', async () => {
    const { deps, agent } = setup();

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1 }, deps);

    expect(agent.calls).toHaveLength(2);
    const [first, second] = agent.calls;
    expect(first.context.history).toEqual([{ role: 'user', content: 'What would you check first for an oral small molecule?' }]);
    expect(second.context.history.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.context.history[2].content).toBe(FINDINGS_REQUEST_TEXT);
    expect(second.context.history[1].content).toContain('DR-02 is the agency record');
    for (const line of PROPOSE_FINDINGS_INSTRUCTIONS) expect(second.context.instructions).toContain(line);
    expect(second.context.roomContext?.length).toBeGreaterThan(0);
    expect(second.context.room).toBe('one-to-one');
    expect(second.context.maxTokens).toBe(PROPOSAL_MAX_TOKENS);
    expect(first.context.maxTokens).toBeUndefined();
    expect(record.schema).toBe(PROPOSE_RECORD_SCHEMA);
  });

  it('uses a fixed fence marker, so the same proposal has the same prompt hash on every repetition', async () => {
    const { deps, agent } = setup();

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 2 }, deps);

    expect(agent.calls[1].context.fenceRandom?.()).toBe(EVAL_FENCE_MARKER);
    const hashes = record.results.map((result) => result.proposal?.promptHash);
    expect(hashes[0]).toBeDefined();
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('keeps the drafts that pass the checks, the refusals and the claims the agent listed as unsupported', async () => {
    const reply1 = reply({
      findings: [finding('DR-01', 'agreed one adequate and well-controlled pivotal study'), finding('DR-02', 'the agency approved it in March, with no conditions at all')],
      unsupported: [{ claim: 'The paediatric plan is agreed.', reason: 'DR-09 is not in the data room.' }],
    });
    const { deps } = setup({ answer: [answers(reply1)] });

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1 }, deps);

    const proposal = record.results[0].proposal;
    expect(proposal?.accepted.map((entry) => entry.documentId)).toEqual(['DR-01']);
    expect(proposal?.refused.map((entry) => entry.code)).toEqual(['quote_not_in_document', 'declared_unsupported']);
    expect(record.results[0].coverage[0]).toMatchObject({ issueId: 'PI-01', coverage: 'partial' });
  });

  it('records an unreadable reply as a proposal with no claims, and does not count it as a pass', async () => {
    const { deps } = setup({ answer: [answers('I could not find anything to propose.')] });

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1 }, deps);

    expect(record.results[0].proposal?.parseError).not.toBeNull();
    expect(record.results[0].proposal?.accepted).toEqual([]);
    expect(summarise(record).totals).toMatchObject({ reps: 1, proposals: 0, noProposal: 1, drafts: 0 });
  });

  it('makes no proposal call when the first answer is unusable', async () => {
    const { deps, agent } = setup({ answer: [{ status: 'error', errorCode: 'internal', text: '' }] });

    await expect(runProposeEval({ cases: [packCase()], packs: PACKS, reps: 3 }, deps)).rejects.toBeInstanceOf(EvalAbortedError);

    expect(agent.calls).toHaveLength(3);
  });

  it('records a proposal reply that was cut off as no proposal', async () => {
    const { deps } = setup({ answer: [answers({ text: BOTH, truncated: true })] });

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1 }, deps);

    expect(record.results[0].proposal).toBeNull();
    expect(record.results[0].unusable).toBe('the proposal reply was cut off');
  });

  it('stops after three unusable answers in a row, and a usable one in between resets the count', async () => {
    const bad = answers({ status: 'error', errorCode: 'internal', text: '' });
    const { deps } = setup({ answer: [answers(BOTH), answers(BOTH), bad, bad, answers(BOTH)] });

    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 3 }, deps);

    expect(record.results).toHaveLength(3);
    expect(record.results.map((result) => result.proposal !== null)).toEqual([true, false, true]);
  });

  it('refuses before any call: no cases, a case with no pack, a bad repetition count', async () => {
    const { deps, agent } = setup();

    await expect(runProposeEval({ cases: [], packs: PACKS }, deps)).rejects.toBeInstanceOf(EvalSetupError);
    await expect(runProposeEval({ cases: [testCase()], packs: PACKS }, deps)).rejects.toThrow(/no loaded pack/);
    await expect(runProposeEval({ cases: [packCase()], packs: PACKS, reps: 0 }, deps)).rejects.toThrow(/repetitions/);
    expect(agent.calls).toHaveLength(0);
  });

  it('records the commit, the case, pack and instruction hashes and the models', async () => {
    const { deps } = setup();

    const { fingerprint } = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1, filters: { agents: ['lead'], cases: null } }, deps);

    expect(fingerprint).toMatchObject({ commit: CLEAN.commit, dirty: false, reps: 1, node: 'v24.0.0-test', filters: { agents: ['lead'], cases: null } });
    expect(fingerprint.caseSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.packSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.proposalInstructionsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.agentsModel).toEqual({ configured: AGENTS_MODEL, resolved: [AGENTS_MODEL] });
  });
});

describe('the report', () => {
  it('gives counts and rates per case and in total, and never prints a claim or a quote', async () => {
    const { deps } = setup({ answer: [answers(BOTH)] });
    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 2 }, deps);

    const lines = formatProposeReport(record);
    const text = lines.join('\n');

    expect(text).toContain('lead-single-study (Rosa): 2/2 readable, 4 drafts of 4 proposed (100% passed), 2 unsupported');
    expect(text).toContain('issue coverage full 2, partial 0, none 0');
    expect(lines[lines.length - 1]).toMatch(/^Total: 2\/2 readable proposals, 4 drafts of 4 proposed \(100% passed\), 2 unsupported/);
    expect(text).not.toContain('agreed one adequate');
    expect(text).not.toContain('Claim about');
  });

  it('shows the pass rate falling when the quotes are not in the documents, and which check refused them', async () => {
    const invented = reply({ findings: [finding('DR-01', 'the agency has confirmed the study is sufficient for approval')], unsupported: [] });
    const { deps } = setup({ answer: [answers(invented)] });
    const record = await runProposeEval({ cases: [packCase()], packs: PACKS, reps: 1 }, deps);

    const text = formatProposeReport(record).join('\n');

    expect(text).toContain('0 drafts of 1 proposed (0% passed)');
    expect(text).toContain('refused: quote_not_in_document 1');
    expect(text).toContain('issue coverage full 0, partial 0, none 1');
  });
});
