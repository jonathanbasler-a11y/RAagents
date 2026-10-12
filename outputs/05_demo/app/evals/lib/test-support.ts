// Test-only helpers for the eval tests: a valid case, a fixture roster lookup, a fake
// runAgent and a fake judge client. Not imported by the eval runner or the app.
import type { RunAgentContext, RunAgentDeps, RunAgentResult } from '@/server/chat/run-agent';
import { buildAgentPrompt } from '@/server/prompts';
import type { AgentSpec, LlmClient, LlmRequest, LlmResult } from '@/shared/contracts';
import type { EvalCase } from './cases';
import type { CheckResult } from './checks';
import { JUDGE_DIMENSIONS, type JudgeScores } from './judge';
import { RUN_RECORD_SCHEMA, type EvalCaseRecord, type EvalFingerprint, type EvalResult, type EvalRunRecord } from './run';

export const AGENTS_MODEL = 'anthropic.claude-test-agents';
export const JUDGE_MODEL = 'gpt-5.6-sol-test-judge';
export const TOOL_CLAIM = "I(?: have|'ve)? (?:checked|searched)";

let caseCount = 0;

/** A valid case for the fixture agent `lead` (Rosa). Each call gets a distinct hash unless one is given. */
export function testCase(patch: Partial<EvalCase> = {}): EvalCase {
  caseCount += 1;
  return {
    id: 'lead-normal',
    version: 1,
    agent: 'lead',
    category: 'normal',
    risk: 'standard',
    asOf: '2026-10-08',
    humanReservedDecision: false,
    turns: [{ role: 'user', content: 'What would you check first for an oral small molecule?' }],
    expected: { requiredPhrases: ['to verify'], requiredPatterns: [], forbiddenClaims: [], forbiddenPatterns: [TOOL_CLAIM] },
    rubricOnly: false,
    rubric: ['Leads with what to check first.'],
    source: 'lead.yaml',
    hash: `${String(caseCount).padStart(4, '0')}${'a'.repeat(60)}`,
    ...patch,
  };
}

/** A registry lookup over the given specs (active ones only), like the real registry. */
export function lookup(specs: readonly AgentSpec[]): (id: string) => AgentSpec | undefined {
  const byId = new Map(specs.filter((spec) => spec.active).map((spec) => [spec.id, spec]));
  return (id) => byId.get(id);
}

/**
 * The prompt hash runAgent reports for this call: the same buildAgentPrompt inputs runAgent
 * uses. The integration test proves the eval runner agrees with the real runAgent.
 */
export function promptHashFor(agentId: string, context: RunAgentContext, deps: RunAgentDeps): string {
  const agent = deps.getAgent(agentId);
  if (agent === undefined) throw new Error(`fake runAgent: unknown agent ${agentId}`);
  const teammates = agent.handoffs
    .map((id) => deps.getAgent(id))
    .filter((mate): mate is AgentSpec => mate !== undefined && mate.active && mate.id !== agent.id);
  return buildAgentPrompt({
    agent,
    teammates,
    room: context.room,
    role: context.role,
    now: (deps.now ?? (() => new Date()))(),
    timeZone: context.timeZone,
    history: context.history,
  }).promptHash;
}

export type FakeAnswer = Partial<RunAgentResult> | Error | ((agentId: string, context: RunAgentContext) => Partial<RunAgentResult>);

export interface RunAgentCall {
  agentId: string;
  context: RunAgentContext;
  deps: RunAgentDeps;
  /** deps.now() as runAgent would read it. */
  now: Date | undefined;
}

/**
 * A fake runAgent: answers from `answers` in order (the last one repeats), records every
 * call, and reports the prompt hash the real one would. An Error in the list is thrown.
 */
export function fakeRunAgent(answers: FakeAnswer[], order: string[] = []) {
  const calls: RunAgentCall[] = [];
  let index = 0;
  const run = async (agentId: string, context: RunAgentContext, deps: RunAgentDeps): Promise<RunAgentResult> => {
    order.push('runAgent');
    calls.push({ agentId, context, deps, now: deps.now?.() });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    const patch = typeof answer === 'function' ? answer(agentId, context) : answer;
    const agent = deps.getAgent(agentId);
    return {
      messageId: `msg-${calls.length}`,
      agentId,
      agentName: agent?.name ?? agentId,
      agentVersion: agent?.version ?? '0.0.0',
      role: context.role,
      text: 'Each point about the asset is to verify. Ask the DD decision owner.',
      status: 'complete',
      truncated: false,
      model: AGENTS_MODEL,
      promptHash: promptHashFor(agentId, context, deps),
      errorCode: null,
      correlationId: null,
      state: 'answered',
      durationMs: 0,
      ...patch,
    };
  };
  return { run, calls };
}

/** A judge reply with these scores (default: all 4). */
export function judgeReply(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ task_success: 4, usefulness: 4, grounding: 4, role_fit: 4, clarity: 4, critique: 'Solid; could be shorter.', ...patch });
}

export type FakeJudgeStep = string | Error | Partial<LlmResult>;

/** A fake judge route: complete() answers from `steps` in order (the last one repeats) and records every request. */
export function fakeJudge(steps: FakeJudgeStep[] = [judgeReply()], model: string = JUDGE_MODEL, order: string[] = []) {
  const requests: LlmRequest[] = [];
  let index = 0;
  const client: LlmClient = {
    route: 'judge',
    model,
    async complete(request) {
      order.push('judge');
      requests.push(request);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step instanceof Error) throw step;
      const base: LlmResult = { text: '', finishReason: 'stop', truncated: false, partial: false, model };
      return typeof step === 'string' ? { ...base, text: step } : { ...base, ...step };
    },
    stream() {
      throw new Error('the judge never streams');
    },
  };
  return { client, requests };
}

/** An agents route client that must not be called directly (the fake runAgent stands in for it). */
export function idleAgentsClient(model: string = AGENTS_MODEL): LlmClient {
  return {
    route: 'agents',
    model,
    complete: () => Promise.reject(new Error('the eval calls agents only through runAgent')),
    stream: () => {
      throw new Error('the eval calls agents only through runAgent');
    },
  };
}

// ---------------------------------------------------------------------------
// Run records for the report tests
// ---------------------------------------------------------------------------

export const PASSED_CHECK: CheckResult = { kind: 'required_phrase', check: 'to verify', passed: true, critical: false };
export const MISSING_CHECK: CheckResult = { kind: 'required_phrase', check: 'to verify', passed: false, critical: false };
export const CRITICAL_CHECK: CheckResult = {
  kind: 'forbidden_claim',
  check: 'I recommend buying',
  passed: false,
  critical: true,
  matched: 'I recommend buying',
};

export interface ResultSpec {
  caseId: string;
  agentId?: string;
  agentName?: string;
  rep?: number;
  /** The judge's overall score (every dimension gets it); null: the judge could not score it. */
  overall?: number | null;
  scores?: Partial<JudgeScores>;
  /** Set: an unusable answer (no checks, no judge). */
  unusable?: string;
  checks?: CheckResult[];
  truncated?: boolean;
  judgeModel?: string;
}

/** One result, shaped as runEval records it. */
export function makeResult(spec: ResultSpec): EvalResult {
  const agentId = spec.agentId ?? 'lead';
  const usable = spec.unusable === undefined;
  const answer = {
    text: usable ? 'An answer; each point is to verify.' : '',
    status: usable ? ('complete' as const) : ('error' as const),
    truncated: spec.truncated ?? false,
    model: usable ? AGENTS_MODEL : null,
    errorCode: usable ? null : ('llm_outage' as const),
    correlationId: null,
    promptHash: `prompt-${spec.caseId}`,
    latencyMs: 1000,
    unusable: spec.unusable ?? null,
  };
  const base = { caseId: spec.caseId, agentId, agentName: spec.agentName ?? (agentId === 'lead' ? 'Rosa' : agentId), rep: spec.rep ?? 1, answer };
  if (!usable) return { ...base, checks: [], judge: null };
  const overall = spec.overall === undefined ? 4 : spec.overall;
  if (overall === null) {
    return {
      ...base,
      checks: spec.checks ?? [PASSED_CHECK],
      judge: { ok: false, model: spec.judgeModel ?? JUDGE_MODEL, problem: 'the judge reply holds no JSON object', latencyMs: 500 },
    };
  }
  const scores = Object.fromEntries(JUDGE_DIMENSIONS.map((dimension) => [dimension, spec.scores?.[dimension] ?? overall])) as JudgeScores;
  const mean = JUDGE_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0) / JUDGE_DIMENSIONS.length;
  return {
    ...base,
    checks: spec.checks ?? [PASSED_CHECK],
    judge: { ok: true, model: spec.judgeModel ?? JUDGE_MODEL, scores, overall: mean, critique: 'Fine.', truncated: false, latencyMs: 500 },
  };
}

/** Results for one case: one per score, as repetitions 1, 2, 3, ... */
export function caseResults(caseId: string, overalls: Array<number | null>, patch: Omit<ResultSpec, 'caseId' | 'overall' | 'rep'> = {}): EvalResult[] {
  return overalls.map((overall, index) => makeResult({ ...patch, caseId, overall, rep: index + 1 }));
}

/** A run record around these results: one case record per case id, and a clean fingerprint. */
export function makeRecord(
  results: EvalResult[],
  patch: { fingerprint?: Partial<EvalFingerprint>; caseHashes?: Record<string, string> } = {},
): EvalRunRecord {
  const cases: EvalCaseRecord[] = [];
  for (const result of results) {
    if (cases.some((entry) => entry.id === result.caseId)) continue;
    cases.push({
      id: result.caseId,
      version: 1,
      agent: result.agentId,
      category: 'normal',
      risk: 'standard',
      hash: patch.caseHashes?.[result.caseId] ?? `hash-${result.caseId}`,
      source: `${result.agentId}.yaml`,
    });
  }
  const reps = Math.max(...cases.map((entry) => results.filter((result) => result.caseId === entry.id).length));
  const judgeModels = [...new Set(results.flatMap((result) => (result.judge?.model ? [result.judge.model] : [])))].sort();
  return {
    schema: RUN_RECORD_SCHEMA,
    fingerprint: {
      startedAt: '2026-10-08T09:00:00.000Z',
      finishedAt: '2026-10-08T09:30:00.000Z',
      commit: 'c0ffee0000000000000000000000000000000000',
      dirty: false,
      reps,
      caseSetHash: 'c'.repeat(64),
      promptSetHash: 'p'.repeat(64),
      judgePromptHash: 'j'.repeat(64),
      agentsModel: { configured: AGENTS_MODEL, family: 'anthropic', resolved: [AGENTS_MODEL] },
      judgeModel: { configured: JUDGE_MODEL, family: 'openai', resolved: judgeModels },
      toolGrants: 'none',
      timeZone: 'UTC',
      specVersions: {},
      filters: { agents: null, cases: null },
      node: 'v24.0.0-test',
      ...patch.fingerprint,
    },
    cases,
    results,
  };
}
