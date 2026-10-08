// The eval runner (BUILD-LEARNINGS Part 9).
//
// - One execution path: every answer comes from the app's own runAgent(), in the agent's
//   1:1 room, exactly as the chat calls it. The clock is frozen at the case's as_of date
//   (12:00 UTC) and the time zone is UTC, so a case's prompt is the same on every run.
// - Each case runs 3 times. Each usable answer gets the deterministic checks, then one
//   judge call on the judge route, which must be a different model family from the agents.
// - The judge sees the exact system prompt the agent was sent: the runner rebuilds it and
//   aborts if its hash differs from the one runAgent reports.
// - Fail fast: 3 unusable answers in a row (blank, error, broken off), or 3 answers in a
//   row the judge could not score, abort the run. The caller saves nothing then.
// - The fingerprint records the commit and dirty flag read at the start, the prompt, case
//   and judge prompt hashes, and the configured and resolved models.
import { createHash } from 'node:crypto';
import type { RunAgentContext, RunAgentDeps, RunAgentResult } from '@/server/chat/run-agent';
import { LlmError, modelFamily, type ModelFamily } from '@/server/llm';
import { buildAgentPrompt, type AgentPrompt } from '@/server/prompts';
import type { AgentId, AgentSpec, ChatErrorCode, ChatLimits, LlmClient, LlmMessage, MessageStatus } from '@/shared/contracts';
import type { CaseCategory, CaseRisk, EvalCase } from './cases';
import { runChecks, type CheckResult } from './checks';
import { JUDGE_MAX_TOKENS, buildJudgeMessages, judgePromptHash, parseJudgeReply, type JudgeScores } from './judge';

/** Repetitions per case before a run counts (BUILD-LEARNINGS 9.6). */
export const EVAL_REPETITIONS = 3;
/** Unusable answers (or unscored ones) in a row that abort the run. */
export const FAIL_FAST_AFTER = 3;
/** The prompt's time zone in every eval call. */
export const EVAL_TIME_ZONE = 'UTC';
export const RUN_RECORD_SCHEMA = 'dhht-eval-run/1';
const MAX_REPETITIONS = 10;
/** The same deadline a chat turn gets. */
const TURN_DEADLINE_MS: ChatLimits['turnDeadlineMs'] = 180_000;

/** A configuration problem found before any model call: the run never starts. */
export class EvalSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalSetupError';
  }
}

/** The run stopped part-way; nothing may be saved from it. */
export class EvalAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAbortedError';
  }
}

export interface GitState {
  /** HEAD when the run started; null when it could not be read. */
  commit: string | null;
  /** Uncommitted changes in the app or the agent specs when the run started; null when unknown. */
  dirty: boolean | null;
}

export interface AnswerRecord {
  /** Everything received, also when the reply broke off. */
  text: string;
  status: MessageStatus;
  truncated: boolean;
  /** The model the agents route reported; null when no reply arrived. */
  model: string | null;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
  /** sha256 of the exact prompt runAgent sent. */
  promptHash: string;
  latencyMs: number;
  /** Why the answer cannot be graded; null when it can. */
  unusable: string | null;
}

export type JudgeRecord =
  | { ok: true; model: string; scores: JudgeScores; overall: number; critique: string; truncated: boolean; latencyMs: number }
  | { ok: false; model: string | null; problem: string; latencyMs: number };

export interface EvalResult {
  caseId: string;
  agentId: AgentId;
  /** The agent's name when it answered. */
  agentName: string;
  /** 1-based. */
  rep: number;
  answer: AnswerRecord;
  /** Empty for an unusable answer. */
  checks: CheckResult[];
  /** Null for an unusable answer (never judged). */
  judge: JudgeRecord | null;
}

export interface ModelRecord {
  /** The model id the route is configured with. */
  configured: string;
  family: ModelFamily;
  /** Every model id the route reported in this run, sorted. */
  resolved: string[];
}

export interface EvalFingerprint {
  startedAt: string;
  finishedAt: string;
  /** Read once, at the start. */
  commit: string | null;
  dirty: boolean | null;
  reps: number;
  /** sha256 over the run's case ids and case hashes. */
  caseSetHash: string;
  /** sha256 over the run's case ids and the prompt hashes runAgent reported. */
  promptSetHash: string;
  judgePromptHash: string;
  agentsModel: ModelRecord;
  judgeModel: ModelRecord;
  /** No agent has tools in this phase. */
  toolGrants: 'none';
  timeZone: string;
  /** Spec version of each agent that answered. */
  specVersions: Record<AgentId, string>;
  filters: EvalFilters;
  node: string;
}

export interface EvalFilters {
  agents: string[] | null;
  cases: string[] | null;
}

export interface EvalCaseRecord {
  id: string;
  version: number;
  agent: AgentId;
  category: CaseCategory;
  risk: CaseRisk;
  hash: string;
  source: string;
}

export interface EvalRunRecord {
  schema: typeof RUN_RECORD_SCHEMA;
  fingerprint: EvalFingerprint;
  cases: EvalCaseRecord[];
  results: EvalResult[];
}

export type RunAgentFn = (agentId: AgentId, context: RunAgentContext, deps: RunAgentDeps) => Promise<RunAgentResult>;

export interface EvalRunOptions {
  cases: readonly EvalCase[];
  /** Default 3. */
  reps?: number;
  /** What the person asked for, recorded in the fingerprint. */
  filters?: EvalFilters;
}

export interface EvalRunDeps {
  /** The app's runAgent (tests pass a fake). */
  runAgent: RunAgentFn;
  /** The registry lookup: undefined for unknown and inactive agents. */
  getAgent: (id: AgentId) => AgentSpec | undefined;
  /** The agents route client, handed to runAgent. */
  agentsLlm: LlmClient;
  /** The judge route client. */
  judgeLlm: LlmClient;
  /** The checkout's state; called once, before any model call. */
  git: () => GitState;
  /** Wall clock for the start and end times. */
  clock?: () => Date;
  /** Milliseconds from a monotonic clock, for latency. */
  elapsed?: () => number;
  /** One progress line: counts and scores, never answer text. */
  print?: (line: string) => void;
  /** Passed to runAgent. */
  log?: Pick<Console, 'error' | 'warn'>;
  nodeVersion?: string;
  /** The deadline of one model call; default the chat's turn deadline. */
  deadline?: () => AbortSignal;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The frozen clock of a case: its as_of date at 12:00 UTC (the same calendar day almost everywhere). */
export function frozenNow(asOf: string): Date {
  return new Date(`${asOf}T12:00:00.000Z`);
}

function historyOf(evalCase: EvalCase): LlmMessage[] {
  return evalCase.turns.map(({ role, content }) => ({ role, content }));
}

/** The context runAgent gets for a case: the agent's 1:1 room, as the chat's 1:1 executor calls it. */
export function evalContext(evalCase: EvalCase, signal: AbortSignal): RunAgentContext {
  return { room: 'one-to-one', role: 'solo', history: historyOf(evalCase), timeZone: EVAL_TIME_ZONE, signal };
}

/**
 * The prompt runAgent builds for this case (same inputs: the agent, its active handoffs
 * as teammates, the 1:1 room, the frozen clock and the history). The judge sees its
 * system message; the runner checks its hash against the one runAgent reports.
 */
export function agentPromptFor(evalCase: EvalCase, getAgent: EvalRunDeps['getAgent']): AgentPrompt {
  const agent = getAgent(evalCase.agent);
  if (agent === undefined || !agent.active) throw new EvalSetupError(`case ${evalCase.id}: agent "${evalCase.agent}" is not an active agent`);
  const teammates = agent.handoffs
    .map((id) => getAgent(id))
    .filter((mate): mate is AgentSpec => mate !== undefined && mate.active && mate.id !== agent.id);
  return buildAgentPrompt({
    agent,
    teammates,
    room: 'one-to-one',
    role: 'solo',
    now: frozenNow(evalCase.asOf),
    timeZone: EVAL_TIME_ZONE,
    history: historyOf(evalCase),
  });
}

/**
 * Null when the judge's model family is known and differs from the agents'; otherwise
 * why the pair cannot be used. Compares families, never route names.
 */
export function judgeFamilyProblem(agentsModel: string, judgeModel: string): string | null {
  for (const model of [agentsModel, judgeModel]) {
    if (modelFamily(model) === 'unknown') {
      return `cannot tell the model family of "${model}", so the judge cannot be shown to differ from the agents; use exact model ids that name the vendor`;
    }
  }
  const family = modelFamily(agentsModel);
  if (modelFamily(judgeModel) === family) {
    return `the judge ("${judgeModel}") is the same model family (${family}) as the agents ("${agentsModel}"); the judge must be a different family`;
  }
  return null;
}

/** Why an answer cannot be graded, or null. A reply with no choices reaches here as an error. */
export function unusableReason(result: Pick<RunAgentResult, 'text' | 'status' | 'errorCode' | 'truncated'>): string | null {
  if (result.status === 'error') return result.errorCode ?? 'error';
  if (result.status === 'partial') return `broke off (${result.errorCode ?? 'partial'})`;
  if (result.text.trim() === '') return result.truncated ? 'cut off before any text' : 'blank';
  return null;
}

async function judgeAnswer(
  evalCase: EvalCase,
  agent: AgentSpec,
  prompt: AgentPrompt,
  result: RunAgentResult,
  deps: Required<Pick<EvalRunDeps, 'judgeLlm' | 'elapsed' | 'deadline'>>,
): Promise<JudgeRecord> {
  const messages = buildJudgeMessages({
    evalCase,
    agent: { name: agent.name, capability: agent.capability },
    agentInstructions: prompt.messages[0].content,
    response: result.text,
    cutOff: result.truncated,
  });
  const started = deps.elapsed();
  try {
    const reply = await deps.judgeLlm.complete({ messages, maxTokens: JUDGE_MAX_TOKENS, signal: deps.deadline() });
    const latencyMs = Math.round(deps.elapsed() - started);
    const parsed = parseJudgeReply(reply.text);
    if (!parsed.ok) {
      const cut = reply.truncated ? ' (the judge reply was cut off at its output limit)' : '';
      return { ok: false, model: reply.model, problem: `${parsed.problem}${cut}`, latencyMs };
    }
    return { ok: true, model: reply.model, scores: parsed.scores, overall: parsed.overall, critique: parsed.critique, truncated: reply.truncated, latencyMs };
  } catch (error) {
    const latencyMs = Math.round(deps.elapsed() - started);
    const problem =
      error instanceof LlmError
        ? `the judge call failed: ${error.kind} (correlation ${error.correlationId})`
        : `the judge call failed: ${describe(error)}`;
    return { ok: false, model: null, problem, latencyMs };
  }
}

function progressLine(position: string, result: EvalResult): string {
  const { answer, checks, judge } = result;
  if (answer.unusable !== null) return `${position} unusable (${answer.unusable})`;
  const passed = checks.filter((check) => check.passed).length;
  const critical = checks.some((check) => check.critical) ? ', CRITICAL' : '';
  const cut = answer.truncated ? ', cut off' : '';
  const graded = judge === null ? 'not judged' : judge.ok ? `judge ${judge.overall.toFixed(1)}` : `judge could not score (${judge.problem})`;
  return `${position} answered (${answer.text.length} chars${cut}), checks ${passed}/${checks.length}${critical}, ${graded}`;
}

/**
 * Runs the cases and returns the run record. Throws EvalSetupError before any model call
 * for a configuration problem, and EvalAbortedError when the run stops part-way.
 */
export async function runEval(options: EvalRunOptions, deps: EvalRunDeps): Promise<EvalRunRecord> {
  const reps = options.reps ?? EVAL_REPETITIONS;
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPETITIONS) {
    throw new EvalSetupError(`repetitions must be a whole number from 1 to ${MAX_REPETITIONS}; got ${reps}`);
  }
  const cases = [...options.cases];
  if (cases.length === 0) throw new EvalSetupError('no cases to run');
  const familyProblem = judgeFamilyProblem(deps.agentsLlm.model, deps.judgeLlm.model);
  if (familyProblem !== null) throw new EvalSetupError(familyProblem);
  // Throws EvalSetupError for an unknown or inactive agent, before any call.
  const prompts = new Map(cases.map((evalCase) => [evalCase.id, agentPromptFor(evalCase, deps.getAgent)]));

  const clock = deps.clock ?? (() => new Date());
  const elapsed = deps.elapsed ?? (() => performance.now());
  const print = deps.print ?? (() => {});
  const deadline = deps.deadline ?? (() => AbortSignal.timeout(TURN_DEADLINE_MS));
  const log = deps.log ?? console;

  const startedAt = clock().toISOString();
  const git = deps.git();
  const results: EvalResult[] = [];
  const resolvedAgents = new Set<string>();
  const resolvedJudge = new Set<string>();
  const specVersions: Record<AgentId, string> = {};
  let unusableRun: string[] = [];
  let unscoredRun: string[] = [];
  const total = cases.length * reps;

  for (const evalCase of cases) {
    const agent = deps.getAgent(evalCase.agent) as AgentSpec;
    const prompt = prompts.get(evalCase.id) as AgentPrompt;
    for (let rep = 1; rep <= reps; rep += 1) {
      const label = `${evalCase.id} #${rep}`;
      const position = `[${results.length + 1}/${total}] ${label}:`;
      const started = elapsed();
      let result: RunAgentResult;
      try {
        result = await deps.runAgent(evalCase.agent, evalContext(evalCase, deadline()), {
          getAgent: deps.getAgent,
          llm: deps.agentsLlm,
          now: () => frozenNow(evalCase.asOf),
          log,
        });
      } catch (error) {
        throw new EvalAbortedError(`${label}: runAgent failed, which is a harness or setup problem, not an answer (${describe(error)})`);
      }
      const latencyMs = Math.round(elapsed() - started);
      if (result.promptHash !== prompt.promptHash) {
        throw new EvalAbortedError(
          `${label}: the prompt runAgent sent differs from the one the judge would be shown; update agentPromptFor in evals/lib/run.ts to match runAgent`,
        );
      }
      specVersions[agent.id] = result.agentVersion;

      const unusable = unusableReason(result);
      const answer: AnswerRecord = {
        text: result.text,
        status: result.status,
        truncated: result.truncated,
        model: result.model,
        errorCode: result.errorCode,
        correlationId: result.correlationId,
        promptHash: result.promptHash,
        latencyMs,
        unusable,
      };
      const base = { caseId: evalCase.id, agentId: agent.id, agentName: result.agentName, rep, answer };

      if (unusable !== null) {
        const entry: EvalResult = { ...base, checks: [], judge: null };
        results.push(entry);
        print(progressLine(position, entry));
        unusableRun.push(`${label}: ${unusable}`);
        if (unusableRun.length >= FAIL_FAST_AFTER) {
          throw new EvalAbortedError(`${FAIL_FAST_AFTER} unusable answers in a row (${unusableRun.join('; ')})`);
        }
        continue;
      }
      unusableRun = [];

      const agentModel = result.model ?? deps.agentsLlm.model;
      if (modelFamily(agentModel) === 'unknown') {
        throw new EvalAbortedError(`${label}: ${judgeFamilyProblem(agentModel, deps.judgeLlm.model)}`);
      }
      resolvedAgents.add(agentModel);

      const checks = runChecks(evalCase.expected, result.text);
      const judge = await judgeAnswer(evalCase, agent, prompt, result, { judgeLlm: deps.judgeLlm, elapsed, deadline });
      if (judge.model !== null) {
        const problem = judgeFamilyProblem(agentModel, judge.model);
        if (problem !== null) throw new EvalAbortedError(`${label}: the judge route reported another model than configured: ${problem}`);
        resolvedJudge.add(judge.model);
      }
      const entry: EvalResult = { ...base, checks, judge };
      results.push(entry);
      print(progressLine(position, entry));

      if (judge.ok) {
        unscoredRun = [];
      } else {
        unscoredRun.push(`${label}: ${judge.problem}`);
        if (unscoredRun.length >= FAIL_FAST_AFTER) {
          throw new EvalAbortedError(`${FAIL_FAST_AFTER} answers in a row the judge could not score (${unscoredRun.join('; ')})`);
        }
      }
    }
  }

  const promptLines = [...new Set(results.map((result) => `${result.caseId}\t${result.answer.promptHash}`))].sort();
  const caseLines = cases.map((evalCase) => `${evalCase.id}\t${evalCase.hash}`).sort();
  return {
    schema: RUN_RECORD_SCHEMA,
    fingerprint: {
      startedAt,
      finishedAt: clock().toISOString(),
      commit: git.commit,
      dirty: git.dirty,
      reps,
      caseSetHash: sha256(caseLines.join('\n')),
      promptSetHash: sha256(promptLines.join('\n')),
      judgePromptHash: judgePromptHash(),
      agentsModel: { configured: deps.agentsLlm.model, family: modelFamily(deps.agentsLlm.model), resolved: [...resolvedAgents].sort() },
      judgeModel: { configured: deps.judgeLlm.model, family: modelFamily(deps.judgeLlm.model), resolved: [...resolvedJudge].sort() },
      toolGrants: 'none',
      timeZone: EVAL_TIME_ZONE,
      specVersions,
      filters: options.filters ?? { agents: null, cases: null },
      node: deps.nodeVersion ?? process.version,
    },
    cases: cases.map((evalCase) => ({
      id: evalCase.id,
      version: evalCase.version,
      agent: evalCase.agent,
      category: evalCase.category,
      risk: evalCase.risk,
      hash: evalCase.hash,
      source: evalCase.source,
    })),
    results,
  };
}
