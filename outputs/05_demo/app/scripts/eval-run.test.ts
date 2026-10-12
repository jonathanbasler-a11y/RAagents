import { describe, expect, it } from 'vitest';
import { fixtureSpecs } from '@/server/agents/test-fixtures';
import { runAgent } from '@/server/chat/run-agent';
import { LlmError } from '@/server/llm';
import type { LlmClient, LlmRequest } from '@/shared/contracts';
import { JUDGE_SYSTEM_PROMPT, judgePromptHash } from '../evals/lib/judge';
import { EvalAbortedError, EvalSetupError, judgeFamilyProblem, runEval, type EvalRunDeps, type GitState } from '../evals/lib/run';
import {
  AGENTS_MODEL,
  JUDGE_MODEL,
  fakeJudge,
  fakeRunAgent,
  idleAgentsClient,
  judgeReply,
  lookup,
  testCase,
  type FakeAnswer,
  type FakeJudgeStep,
} from '../evals/lib/test-support';

const getAgent = lookup(fixtureSpecs());
const CLEAN: GitState = { commit: 'c0ffee0000000000000000000000000000000000', dirty: false };

function setup(options: { answers?: FakeAnswer[]; judge?: FakeJudgeStep[]; judgeModel?: string; agentsModel?: string; git?: GitState } = {}) {
  const order: string[] = [];
  const agent = fakeRunAgent(options.answers ?? [{}], order);
  const judge = fakeJudge(options.judge ?? [judgeReply()], options.judgeModel ?? JUDGE_MODEL, order);
  const lines: string[] = [];
  let tick = 0;
  const deps: EvalRunDeps = {
    runAgent: agent.run,
    getAgent,
    agentsLlm: idleAgentsClient(options.agentsModel ?? AGENTS_MODEL),
    judgeLlm: judge.client,
    git: () => {
      order.push('git');
      return options.git ?? CLEAN;
    },
    clock: () => new Date(Date.UTC(2026, 9, 8, 9, 0, tick++)),
    elapsed: () => (tick += 1) * 100,
    print: (line) => lines.push(line),
    nodeVersion: 'v24.0.0-test',
  };
  return { deps, agent, judge, order, lines };
}

async function abortReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EvalAbortedError) return error.message;
    throw error;
  }
  throw new Error('expected the run to abort');
}

describe('runEval: one execution path', () => {
  it('runs every case 3 times through runAgent, in order, in the agent’s 1:1 room on the frozen as-of date', async () => {
    const first = testCase({ id: 'lead-one' });
    const second = testCase({ id: 'cmc-one', agent: 'cmc', asOf: '2026-09-30' });
    const { deps, agent } = setup();

    await runEval({ cases: [first, second] }, deps);

    expect(agent.calls.map((call) => call.agentId)).toEqual(['lead', 'lead', 'lead', 'cmc', 'cmc', 'cmc']);
    const [call] = agent.calls;
    expect(call.context).toMatchObject({ room: 'one-to-one', role: 'solo', timeZone: 'UTC', history: first.turns });
    expect(call.context.signal).toBeInstanceOf(AbortSignal);
    expect(call.context.emit).toBeUndefined();
    expect(call.now?.toISOString()).toBe('2026-10-08T12:00:00.000Z');
    expect(agent.calls[3].now?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(call.deps.llm).toBe(deps.agentsLlm);
    expect(call.deps.getAgent).toBe(getAgent);
  });

  it('agrees with the real runAgent on the prompt it sends, and shows the judge that exact prompt', async () => {
    const seen: LlmRequest[] = [];
    const agentsLlm: LlmClient = {
      route: 'agents',
      model: AGENTS_MODEL,
      complete: () => Promise.reject(new Error('runAgent streams')),
      async *stream(request) {
        seen.push(request);
        yield { type: 'delta', text: 'Start with the designations; each point is to verify.' };
        yield { type: 'end', result: { text: '', finishReason: 'stop', truncated: false, partial: false, model: `${AGENTS_MODEL}-20261001` } };
      },
    };
    const judge = fakeJudge();
    const record = await runEval(
      { cases: [testCase()], reps: 1 },
      { runAgent, getAgent, agentsLlm, judgeLlm: judge.client, git: () => CLEAN, print: () => {}, nodeVersion: 'v24' },
    );

    const system = seen[0].messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('You are Rosa. Your capability: Regulatory lead.');
    expect(system.content).toContain('Thursday 8 October 2026, 12:00');
    expect(seen[0].messages.slice(1)).toEqual([{ role: 'user', content: 'What would you check first for an oral small molecule?' }]);
    // The judge saw the agent's own instructions inside a fence (the shared rules' fence lines are defused there).
    expect(judge.requests[0].messages[1].content).toContain('You are Rosa. Your capability: Regulatory lead.');
    expect(judge.requests[0].messages[1].content).toContain('Thursday 8 October 2026, 12:00');
    expect(record.results[0]).toMatchObject({ answer: { model: `${AGENTS_MODEL}-20261001`, unusable: null }, judge: { ok: true } });
  });
});

describe('runEval: grading', () => {
  it('runs the deterministic checks and asks the judge once per usable answer, recording scores, critique and model', async () => {
    const { deps, judge } = setup({
      answers: [{ text: 'I searched the register. It is to verify.' }],
      judge: [judgeReply({ task_success: 2, critique: 'Claims a search it cannot make.' })],
    });

    const record = await runEval({ cases: [testCase()], reps: 1 }, deps);

    expect(judge.requests).toHaveLength(1);
    expect(judge.requests[0].messages[0]).toEqual({ role: 'system', content: JUDGE_SYSTEM_PROMPT });
    expect(judge.requests[0].messages[1].content).toContain('I searched the register. It is to verify.');
    expect(record.results[0].checks.map((check) => [check.kind, check.passed, check.critical])).toEqual([
      ['required_phrase', true, false],
      ['forbidden_pattern', false, true],
    ]);
    expect(record.results[0].judge).toEqual({
      ok: true,
      model: JUDGE_MODEL,
      scores: { task_success: 2, usefulness: 4, grounding: 4, role_fit: 4, clarity: 4 },
      overall: 3.6,
      critique: 'Claims a search it cannot make.',
      truncated: false,
      latencyMs: expect.any(Number),
    });
  });

  it('grades an answer cut off at the output cap, and tells the judge it was cut off', async () => {
    const { deps, judge } = setup({ answers: [{ truncated: true, text: 'A long answer that stops' }] });

    const record = await runEval({ cases: [testCase()], reps: 1 }, deps);

    expect(record.results[0].answer).toMatchObject({ truncated: true, unusable: null });
    expect(judge.requests[0].messages[1].content).toMatch(/was cut off at the output limit/);
  });

  it('records a judge reply it cannot read, or a failed judge call, as unscored without stopping the run', async () => {
    const { deps } = setup({
      judge: ['I liked it.', new LlmError({ kind: 'outage', message: 'the model endpoint failed (HTTP 503)', permanent: false }, { correlationId: 'corr-1' }), judgeReply()],
    });

    const record = await runEval({ cases: [testCase()] }, deps);

    expect(record.results.map((result) => result.judge?.ok)).toEqual([false, false, true]);
    expect(record.results[0].judge).toMatchObject({ ok: false, model: JUDGE_MODEL, problem: expect.stringMatching(/no JSON object/) });
    expect(record.results[1].judge).toMatchObject({ ok: false, model: null, problem: expect.stringMatching(/judge call failed: outage .*corr-1/) });
  });

  it('prints one progress line per answer, with counts and scores but never the answer text', async () => {
    const { deps, lines } = setup({ answers: [{ text: 'SECRET-LOOKING ANSWER TEXT to verify' }] });

    await runEval({ cases: [testCase()], reps: 2 }, deps);

    expect(lines).toEqual([
      expect.stringMatching(/^\[1\/2\] lead-normal #1: answered \(\d+ chars\), checks 2\/2, judge 4\.0$/),
      expect.stringMatching(/^\[2\/2\] lead-normal #2: /),
    ]);
    expect(lines.join('\n')).not.toContain('SECRET-LOOKING');
  });
});

describe('runEval: fail fast (BUILD-LEARNINGS 9.6)', () => {
  it('aborts after 3 unusable answers in a row (error, broken off, blank), without judging them', async () => {
    const { deps, agent, judge } = setup({
      answers: [
        { status: 'error', text: '', errorCode: 'llm_outage', state: 'failed', model: null },
        { status: 'partial', text: 'Half an', errorCode: 'llm_network', state: 'failed' },
        { status: 'complete', text: '   ' },
        {},
      ],
    });

    const reason = await abortReason(runEval({ cases: [testCase({ id: 'a' }), testCase({ id: 'b' })] }, deps));

    expect(reason).toMatch(/3 unusable answers in a row/);
    expect(reason).toMatch(/a #1: llm_outage/);
    expect(reason).toMatch(/a #2: broke off \(llm_network\)/);
    expect(reason).toMatch(/a #3: blank/);
    expect(agent.calls).toHaveLength(3);
    expect(judge.requests).toHaveLength(0);
  });

  it('counts only answers in a row: a usable answer resets the count', async () => {
    const unusable = { status: 'error' as const, text: '', errorCode: 'llm_outage' as const, state: 'failed' as const, model: null };
    const { deps, judge } = setup({ answers: [unusable, unusable, {}, unusable, unusable, {}] });

    const record = await runEval({ cases: [testCase({ id: 'a' }), testCase({ id: 'b' })] }, deps);

    expect(record.results.map((result) => result.answer.unusable)).toEqual(['llm_outage', 'llm_outage', null, 'llm_outage', 'llm_outage', null]);
    expect(record.results.map((result) => result.judge === null)).toEqual([true, true, false, true, true, false]);
    expect(judge.requests).toHaveLength(2);
  });

  it('aborts after 3 answers in a row the judge could not score', async () => {
    const { deps, agent } = setup({ judge: ['no json', '{"task_success": 9}', ''] });

    const reason = await abortReason(runEval({ cases: [testCase({ id: 'a' }), testCase({ id: 'b' })] }, deps));

    expect(reason).toMatch(/3 answers in a row the judge could not score/);
    expect(agent.calls).toHaveLength(3);
  });

  it('aborts when runAgent itself throws: a harness or setup problem, not an answer', async () => {
    const { deps } = setup({ answers: [new TypeError('history message 1 is empty')] });

    expect(await abortReason(runEval({ cases: [testCase()] }, deps))).toMatch(/lead-normal #1: runAgent failed.*not an answer.*history message 1 is empty/);
  });

  it('aborts when the prompt runAgent sent differs from the one the judge would see', async () => {
    const { deps, judge } = setup({ answers: [{ promptHash: 'b'.repeat(64) }] });

    expect(await abortReason(runEval({ cases: [testCase()] }, deps))).toMatch(/prompt .* differs/);
    expect(judge.requests).toHaveLength(0);
  });
});

describe('runEval: the judge is a different model family (BUILD-LEARNINGS 9.4)', () => {
  it('refuses to start when the configured judge is the agents’ family, or a family it cannot tell', async () => {
    for (const judgeModel of ['anthropic.claude-test-judge', 'judge-model-x']) {
      const { deps, agent, order } = setup({ judgeModel });
      await expect(runEval({ cases: [testCase()] }, deps)).rejects.toThrow(EvalSetupError);
      expect(agent.calls).toHaveLength(0);
      expect(order).toEqual([]);
    }
  });

  it('aborts when the judge route reports a model of the agents’ family (route names can point at the same model)', async () => {
    const { deps } = setup({ judge: [{ text: judgeReply(), model: 'anthropic.claude-test-agents' }] });

    expect(await abortReason(runEval({ cases: [testCase()] }, deps))).toMatch(/same model family/);
  });

  it('aborts when the agents route reports a model whose family it cannot tell', async () => {
    const { deps } = setup({ answers: [{ model: 'mystery-model-7' }] });

    expect(await abortReason(runEval({ cases: [testCase()] }, deps))).toMatch(/cannot tell the model family of "mystery-model-7"/);
  });

  it('judgeFamilyProblem compares families, not names', () => {
    expect(judgeFamilyProblem('anthropic.claude-opus-test', 'gpt-5.6-sol-test')).toBeNull();
    expect(judgeFamilyProblem('anthropic.claude-opus-test', 'claude-other-test')).toMatch(/same model family \(anthropic\)/);
    expect(judgeFamilyProblem('fake-model', 'gpt-5.6-test')).toMatch(/cannot tell the model family of "fake-model"/);
  });
});

describe('runEval: setup checks', () => {
  it('refuses a case whose agent is not in the roster, before any call', async () => {
    const { deps, agent } = setup();

    await expect(runEval({ cases: [testCase({ agent: 'nobody' })] }, deps)).rejects.toThrow(/agent "nobody" is not an active agent/);
    expect(agent.calls).toHaveLength(0);
  });

  it('refuses no cases and a repetition count outside 1 to 10', async () => {
    const { deps } = setup();

    await expect(runEval({ cases: [] }, deps)).rejects.toThrow(EvalSetupError);
    await expect(runEval({ cases: [testCase()], reps: 0 }, deps)).rejects.toThrow(/repetitions/);
    await expect(runEval({ cases: [testCase()], reps: 11 }, deps)).rejects.toThrow(/repetitions/);
  });
});

describe('runEval: the fingerprint (BUILD-LEARNINGS 9.6)', () => {
  it('records the commit and dirty flag read at the start, before any model call', async () => {
    const { deps, order } = setup({ git: { commit: 'abc1230000000000000000000000000000000000', dirty: true } });

    const record = await runEval({ cases: [testCase()], reps: 1 }, deps);

    expect(order[0]).toBe('git');
    expect(order.filter((step) => step === 'git')).toHaveLength(1);
    expect(record.fingerprint).toMatchObject({ commit: 'abc1230000000000000000000000000000000000', dirty: true });
  });

  it('records the hashes, models, repetitions, filters and clock that make the run comparable', async () => {
    const evalCase = testCase();
    const { deps } = setup();

    const record = await runEval({ cases: [evalCase], filters: { agents: ['lead'], cases: null } }, deps);
    const { fingerprint } = record;

    expect(fingerprint).toEqual({
      startedAt: '2026-10-08T09:00:00.000Z',
      finishedAt: expect.stringMatching(/^2026-10-08T09:00:\d\d\.000Z$/),
      commit: CLEAN.commit,
      dirty: false,
      reps: 3,
      caseSetHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      promptSetHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      judgePromptHash: judgePromptHash(),
      agentsModel: { configured: AGENTS_MODEL, family: 'anthropic', resolved: [AGENTS_MODEL] },
      judgeModel: { configured: JUDGE_MODEL, family: 'openai', resolved: [JUDGE_MODEL] },
      toolGrants: 'none',
      timeZone: 'UTC',
      specVersions: { lead: '0.1.0' },
      filters: { agents: ['lead'], cases: null },
      node: 'v24.0.0-test',
    });
    expect(record.cases).toEqual([
      { id: evalCase.id, version: 1, agent: 'lead', category: 'normal', risk: 'standard', hash: evalCase.hash, source: 'lead.yaml' },
    ]);
    expect(record.results.every((result) => result.answer.promptHash === record.results[0].answer.promptHash)).toBe(true);
  });

  it('changes the case set hash when a case changes, and the prompt set hash when the prompt changes', async () => {
    const run = async (patch: Parameters<typeof testCase>[0]) => (await runEval({ cases: [testCase(patch)], reps: 1 }, setup().deps)).fingerprint;
    const base = await run({ hash: '1'.repeat(64) });

    expect((await run({ hash: '2'.repeat(64) })).caseSetHash).not.toBe(base.caseSetHash);
    expect((await run({ hash: '1'.repeat(64), asOf: '2026-10-09' })).promptSetHash).not.toBe(base.promptSetHash);
    expect((await run({ hash: '1'.repeat(64) })).promptSetHash).toBe(base.promptSetHash);
  });
});
