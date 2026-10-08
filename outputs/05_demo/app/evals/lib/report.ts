// What a run says, and what it does not (BUILD-LEARNINGS 9.6 to 9.8).
//
// - summarise: per agent, with counts. The overall score is estimated across case means
//   with two standard errors, because the case is the unit, not the answer.
// - verdictOf: INVALID (unusable or unscored answers, fewer than 3 repetitions, more than
//   one judge, missing answers), UNVERIFIABLE (no commit, uncommitted code, a missing
//   fingerprint field), or PASS. PASS means a valid measurement, not a good score.
// - reviewQueue: the answers and cases a person should read.
// - compareRuns: case-paired, candidate minus baseline. "better" or "worse" only beyond two
//   standard errors with at least 5 paired cases; otherwise "no measurable effect" or "too
//   few cases". Different judges, a changed case or an INVALID run give no verdict at all.
// - formatReport: the lines to print. Counts and scores only, never answer text.
import type { AgentId } from '@/shared/contracts';
import { allPassed, hasCritical } from './checks';
import { JUDGE_DIMENSIONS, type JudgeDimension } from './judge';
import { EVAL_REPETITIONS, type EvalResult, type EvalRunRecord } from './run';

/** Fewest paired cases for a comparison verdict. */
export const MIN_PAIRED_CASES = 5;
/** A judge overall score at or above this is a "good" answer when every check passed. */
export const GOOD_SCORE = 4;
/** Below this, an answer goes to review. */
export const LOW_SCORE = 3;
/**
 * A spread of overall scores this wide between repetitions sends a case to review. A
 * 1-point spread is ordinary judge noise on a 5-point scale; 1.5 or more is not.
 */
export const UNSTABLE_RANGE = 1.5;

export interface Estimate {
  mean: number;
  /** Two standard errors across cases; null with fewer than 2 cases. */
  twoSe: number | null;
  /** Cases with at least one judged answer. */
  n: number;
}

export interface AgentSummary {
  /** Null for the "All agents" row. */
  agentId: AgentId | null;
  label: string;
  cases: number;
  answers: number;
  unusable: number;
  /** Usable answers whose every deterministic check passed. */
  checksPassed: number;
  /** Usable answers with a critical failure. */
  critical: number;
  judged: number;
  /** Usable answers the judge could not score. */
  unscored: number;
  overall: Estimate | null;
  /** Mean over the judged answers; null when none. */
  dimensions: Record<JudgeDimension, number | null>;
  /** Every check passed and the judge gave at least GOOD_SCORE. */
  good: number;
}

export type RunVerdict = 'PASS' | 'INVALID' | 'UNVERIFIABLE';

export interface ReviewItem {
  caseId: string;
  /** Null for a reason about the whole case. */
  rep: number | null;
  reason: string;
}

export type ComparisonBand = 'better' | 'worse' | 'no measurable effect' | 'too few cases';

export interface ComparisonRow {
  label: string;
  /** Paired cases. */
  n: number;
  /** Mean of candidate minus baseline case means; null with no paired case. */
  diff: number | null;
  twoSe: number | null;
  band: ComparisonBand;
}

export interface Comparison {
  /** invalid: no verdict at all · unverifiable: a verdict, flagged. */
  status: 'valid' | 'unverifiable' | 'invalid';
  problems: string[];
  baseline: { startedAt: string; commit: string | null };
  /** Per agent in the candidate's order, then "All agents". Empty when invalid. */
  rows: ComparisonRow[];
  /** Case ids in one run only. */
  unpaired: string[];
  /** Case ids in both runs whose content changed. */
  changed: string[];
  /** Every baseline case whose mean is below 4.0. */
  baselineBelow4: Array<{ caseId: string; mean: number }>;
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Mean and two standard errors (sample standard deviation over sqrt n). */
export function estimate(values: readonly number[]): Estimate | null {
  if (values.length === 0) return null;
  const average = mean(values);
  if (values.length < 2) return { mean: average, twoSe: null, n: values.length };
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return { mean: average, twoSe: 2 * Math.sqrt(variance / values.length), n: values.length };
}

const isUsable = (result: EvalResult) => result.answer.unusable === null;
const judgedOverall = (result: EvalResult): number | null => (result.judge?.ok ? result.judge.overall : null);

/** Per case, the mean overall score of its judged answers (cases with none are left out). */
function caseMeans(results: readonly EvalResult[]): Map<string, number> {
  const scores = new Map<string, number[]>();
  for (const result of results) {
    const overall = judgedOverall(result);
    if (overall === null) continue;
    scores.set(result.caseId, [...(scores.get(result.caseId) ?? []), overall]);
  }
  return new Map([...scores].map(([caseId, values]) => [caseId, mean(values)]));
}

function summaryOf(agentId: AgentId | null, label: string, results: readonly EvalResult[]): AgentSummary {
  const usable = results.filter(isUsable);
  const judged = usable.filter((result) => result.judge?.ok);
  const dimensions = Object.fromEntries(
    JUDGE_DIMENSIONS.map((dimension) => [
      dimension,
      judged.length === 0 ? null : mean(judged.map((result) => (result.judge?.ok ? result.judge.scores[dimension] : 0))),
    ]),
  ) as Record<JudgeDimension, number | null>;
  return {
    agentId,
    label,
    cases: new Set(results.map((result) => result.caseId)).size,
    answers: results.length,
    unusable: results.length - usable.length,
    checksPassed: usable.filter((result) => allPassed(result.checks)).length,
    critical: usable.filter((result) => hasCritical(result.checks)).length,
    judged: judged.length,
    unscored: usable.filter((result) => result.judge !== null && !result.judge.ok).length,
    overall: estimate([...caseMeans(results).values()]),
    dimensions,
    good: usable.filter((result) => allPassed(result.checks) && (judgedOverall(result) ?? 0) >= GOOD_SCORE).length,
  };
}

/** Per agent, in the order the agents first answered, and for all agents together. */
export function summarise(record: EvalRunRecord): { agents: AgentSummary[]; all: AgentSummary } {
  const byAgent = new Map<AgentId, EvalResult[]>();
  for (const result of record.results) byAgent.set(result.agentId, [...(byAgent.get(result.agentId) ?? []), result]);
  const agents = [...byAgent].map(([agentId, results]) => summaryOf(agentId, `${results[0].agentName} (${agentId})`, results));
  return { agents, all: summaryOf(null, 'All agents', record.results) };
}

const FINGERPRINT_TEXT_FIELDS = ['startedAt', 'finishedAt', 'caseSetHash', 'promptSetHash', 'judgePromptHash'] as const;

/** Whether the run is a valid measurement, and every reason it is not. */
export function verdictOf(record: EvalRunRecord): { verdict: RunVerdict; reasons: string[] } {
  const { fingerprint, results } = record;
  const invalid: string[] = [];
  const unverifiable: string[] = [];
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  if (fingerprint.reps < EVAL_REPETITIONS) {
    invalid.push(`fewer than ${EVAL_REPETITIONS} repetitions per case (${fingerprint.reps}), so the run does not count`);
  }
  const unusable = results.filter((result) => !isUsable(result)).length;
  if (unusable > 0) invalid.push(`${plural(unusable, 'unusable answer')} (blank, error or broken off)`);
  const unscored = results.filter((result) => isUsable(result) && !result.judge?.ok).length;
  if (unscored > 0) invalid.push(`${plural(unscored, 'answer')} the judge could not score`);
  const judges = [...new Set(results.flatMap((result) => (result.judge?.model ? [result.judge.model] : [])))].sort();
  if (judges.length > 1) invalid.push(`more than one judge model: ${judges.join(', ')}`);
  const expectedAnswers = record.cases.length * fingerprint.reps;
  if (results.length !== expectedAnswers) invalid.push(`incomplete: ${results.length} of ${expectedAnswers} answers`);

  if (!fingerprint.commit) unverifiable.push('no commit recorded');
  if (fingerprint.dirty === true) unverifiable.push('uncommitted changes in the app or the agent specs when the run started');
  if (fingerprint.dirty === null || fingerprint.dirty === undefined) unverifiable.push('could not tell whether there were uncommitted changes');
  for (const field of FINGERPRINT_TEXT_FIELDS) {
    const value = fingerprint[field];
    if (typeof value !== 'string' || value === '') unverifiable.push(`fingerprint field "${field}" is missing`);
  }

  const verdict: RunVerdict = invalid.length > 0 ? 'INVALID' : unverifiable.length > 0 ? 'UNVERIFIABLE' : 'PASS';
  return { verdict, reasons: [...invalid, ...unverifiable] };
}

const CHECK_LABELS = {
  required_phrase: 'required phrase',
  required_pattern: 'required pattern',
  forbidden_claim: 'forbidden claim',
  forbidden_pattern: 'forbidden pattern',
} as const;

/** The answers and cases a person should read, in run order. */
export function reviewQueue(record: EvalRunRecord): ReviewItem[] {
  const items: ReviewItem[] = [];
  const caseIds = [...new Set(record.results.map((result) => result.caseId))];
  for (const caseId of caseIds) {
    const results = record.results.filter((result) => result.caseId === caseId);
    for (const result of results) {
      const add = (reason: string) => items.push({ caseId, rep: result.rep, reason });
      if (result.answer.unusable !== null) {
        add(`unusable: ${result.answer.unusable}`);
        continue;
      }
      const critical = result.checks.filter((check) => check.critical);
      for (const check of critical) add(`critical: ${CHECK_LABELS[check.kind]} "${check.check}" matched "${check.matched ?? ''}"`);
      const overall = judgedOverall(result);
      if (result.judge !== null && !result.judge.ok) add(`the judge could not score it: ${result.judge.problem}`);
      if (critical.length === 0 && !allPassed(result.checks) && overall !== null && overall >= GOOD_SCORE) {
        add(`graders disagree: a deterministic check failed, but the judge gave ${overall.toFixed(1)}`);
      }
      if (overall !== null && overall < LOW_SCORE) add(`low judge score (${overall.toFixed(1)})`);
      if (result.answer.truncated) add('cut off at the output limit');
    }
    const overalls = results.map(judgedOverall).filter((value): value is number => value !== null);
    if (overalls.length >= 2 && Math.max(...overalls) - Math.min(...overalls) >= UNSTABLE_RANGE) {
      items.push({
        caseId,
        rep: null,
        reason: `unstable across repetitions: overall from ${Math.min(...overalls).toFixed(1)} to ${Math.max(...overalls).toFixed(1)}`,
      });
    }
    const usable = results.filter(isUsable);
    const passed = usable.filter((result) => allPassed(result.checks)).length;
    if (passed > 0 && passed < usable.length) {
      items.push({ caseId, rep: null, reason: `unstable across repetitions: deterministic checks passed in ${passed} of ${usable.length}` });
    }
  }
  return items;
}

function band(n: number, diff: number | null, twoSe: number | null): ComparisonBand {
  if (n < MIN_PAIRED_CASES || diff === null || twoSe === null) return 'too few cases';
  if (diff > twoSe) return 'better';
  if (diff < -twoSe) return 'worse';
  return 'no measurable effect';
}

function row(label: string, diffs: readonly number[]): ComparisonRow {
  const result = estimate(diffs);
  return { label, n: diffs.length, diff: result?.mean ?? null, twoSe: result?.twoSe ?? null, band: band(diffs.length, result?.mean ?? null, result?.twoSe ?? null) };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

/** Candidate minus baseline, paired by case, with the noise band. */
export function compareRuns(baseline: EvalRunRecord, candidate: EvalRunRecord): Comparison {
  const problems: string[] = [];
  const warnings: string[] = [];
  const judgesOf = (record: EvalRunRecord) => [...new Set(record.results.flatMap((result) => (result.judge?.model ? [result.judge.model] : [])))];

  if (baseline.schema !== candidate.schema) problems.push(`the run records have different formats (${baseline.schema} and ${candidate.schema})`);
  if (baseline.fingerprint.judgePromptHash !== candidate.fingerprint.judgePromptHash) {
    problems.push('the judge prompt differs between the runs, so the grading criteria are not the same');
  }
  if (!sameSet(judgesOf(baseline), judgesOf(candidate))) {
    problems.push(`different judge models (baseline: ${judgesOf(baseline).join(', ') || 'none'}; candidate: ${judgesOf(candidate).join(', ') || 'none'})`);
  }
  const baselineHashes = new Map(baseline.cases.map((entry) => [entry.id, entry.hash]));
  const candidateHashes = new Map(candidate.cases.map((entry) => [entry.id, entry.hash]));
  const changed = candidate.cases.filter((entry) => baselineHashes.has(entry.id) && baselineHashes.get(entry.id) !== entry.hash).map((entry) => entry.id);
  if (changed.length > 0) problems.push(`a changed case suite blocks comparison (changed cases: ${changed.join(', ')})`);
  for (const [name, record] of [
    ['baseline', baseline],
    ['candidate', candidate],
  ] as const) {
    const { verdict, reasons } = verdictOf(record);
    if (verdict === 'INVALID') problems.push(`the ${name} run is INVALID (${reasons.join('; ')})`);
    else if (verdict === 'UNVERIFIABLE') warnings.push(`the ${name} run is UNVERIFIABLE (${reasons.join('; ')})`);
  }

  const unpaired = [
    ...candidate.cases.filter((entry) => !baselineHashes.has(entry.id)).map((entry) => entry.id),
    ...baseline.cases.filter((entry) => !candidateHashes.has(entry.id)).map((entry) => entry.id),
  ].sort();
  const baselineMeans = caseMeans(baseline.results);
  const baselineBelow4 = baseline.cases
    .filter((entry) => (baselineMeans.get(entry.id) ?? Infinity) < 4)
    .map((entry) => ({ caseId: entry.id, mean: baselineMeans.get(entry.id) as number }));

  const result: Comparison = {
    status: problems.length > 0 ? 'invalid' : warnings.length > 0 ? 'unverifiable' : 'valid',
    problems: [...problems, ...warnings],
    baseline: { startedAt: baseline.fingerprint.startedAt, commit: baseline.fingerprint.commit },
    rows: [],
    unpaired,
    changed,
    baselineBelow4,
  };
  if (result.status === 'invalid') return result;

  const candidateMeans = caseMeans(candidate.results);
  const diffs: Array<{ agentId: AgentId; diff: number }> = [];
  for (const entry of candidate.cases) {
    const before = baselineMeans.get(entry.id);
    const after = candidateMeans.get(entry.id);
    if (before !== undefined && after !== undefined && baselineHashes.get(entry.id) === entry.hash) diffs.push({ agentId: entry.agent, diff: after - before });
  }
  const labels = new Map(candidate.results.map((entry) => [entry.agentId, `${entry.agentName} (${entry.agentId})`]));
  const agents = [...new Set(diffs.map((entry) => entry.agentId))];
  result.rows = [
    ...agents.map((agentId) => row(labels.get(agentId) ?? agentId, diffs.filter((entry) => entry.agentId === agentId).map((entry) => entry.diff))),
    row('All agents', diffs.map((entry) => entry.diff)),
  ];
  return result;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const fixed = (value: number | null, digits: number) => (value === null ? '-' : value.toFixed(digits));
const short = (hash: string) => hash.slice(0, 8);
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((cells) => cells[column].length)));
  return rows.map((cells) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ').trimEnd());
}

function summaryRow(summary: AgentSummary): string[] {
  const usable = summary.answers - summary.unusable;
  const overall = summary.overall === null ? '-' : `${summary.overall.mean.toFixed(2)}${summary.overall.twoSe === null ? '' : ` ±${summary.overall.twoSe.toFixed(2)}`}`;
  return [
    summary.label,
    String(summary.cases),
    String(summary.answers),
    String(summary.unusable),
    `${summary.checksPassed}/${usable}`,
    String(summary.critical),
    `${summary.judged}/${usable}`,
    overall,
    ...JUDGE_DIMENSIONS.map((dimension) => fixed(summary.dimensions[dimension], 1)),
    `${summary.good}/${summary.answers}`,
  ];
}

function comparisonLines(comparison: Comparison): string[] {
  if (comparison.status === 'invalid') return [`Comparison INVALID, so no verdict: ${comparison.problems.join('; ')}`];
  const commit = comparison.baseline.commit === null ? 'no commit' : `commit ${comparison.baseline.commit.slice(0, 7)}`;
  const lines = [
    `Comparison with the baseline run started ${comparison.baseline.startedAt} (${commit}): candidate minus baseline, overall score, paired by case, ±2 standard errors across cases.`,
  ];
  if (comparison.status === 'unverifiable') lines.push(`UNVERIFIABLE: ${comparison.problems.join('; ')}`);
  for (const entry of comparison.rows) {
    const diff = entry.diff === null ? 'no paired case' : `${signed(entry.diff)}${entry.twoSe === null ? '' : ` ±${entry.twoSe.toFixed(2)}`}`;
    lines.push(`- ${entry.label}: ${diff} over ${entry.n} case${entry.n === 1 ? '' : 's'}: ${entry.band}`);
  }
  if (comparison.unpaired.length > 0) lines.push(`Not paired (in one run only): ${comparison.unpaired.join(', ')}`);
  lines.push(
    `Baseline cases below 4.0: ${
      comparison.baselineBelow4.length === 0 ? 'none' : comparison.baselineBelow4.map((entry) => `${entry.caseId} ${entry.mean.toFixed(2)}`).join(', ')
    }`,
  );
  return lines;
}

/** The report to print after a run: counts, scores and statuses, never answer text or critiques. */
export function formatReport(record: EvalRunRecord, comparison?: Comparison): string[] {
  const { fingerprint } = record;
  const { agents, all } = summarise(record);
  const { verdict, reasons } = verdictOf(record);
  const review = reviewQueue(record);
  const commit = fingerprint.commit === null ? 'no commit' : `commit ${fingerprint.commit.slice(0, 7)}`;
  const dirty = fingerprint.dirty === null ? 'unknown' : fingerprint.dirty ? 'yes' : 'no';
  const lines = [
    `Eval run: ${record.cases.length} cases x ${fingerprint.reps} repetitions = ${record.cases.length * fingerprint.reps} answers`,
    `Started ${fingerprint.startedAt}, ${commit} (uncommitted changes: ${dirty})`,
    `Agents: ${fingerprint.agentsModel.configured} (${fingerprint.agentsModel.family}); reported: ${fingerprint.agentsModel.resolved.join(', ') || 'none'}`,
    `Judge: ${fingerprint.judgeModel.configured} (${fingerprint.judgeModel.family}); reported: ${fingerprint.judgeModel.resolved.join(', ') || 'none'}`,
    `Hashes: cases ${short(fingerprint.caseSetHash)}, prompts ${short(fingerprint.promptSetHash)}, judge prompt ${short(fingerprint.judgePromptHash)}`,
    '',
    'Per agent. Overall: the mean of the case means, ±2 standard errors across cases. Good: every check passed and the judge gave 4 or more.',
    ...table([
      ['Agent', 'Cases', 'Answers', 'Unusable', 'Checks passed', 'Critical', 'Judged', 'Overall', 'Task', 'Useful', 'Grounding', 'Role', 'Clarity', 'Good'],
      ...agents.map(summaryRow),
      summaryRow(all),
    ]),
    '',
    verdict === 'PASS'
      ? 'Run verdict: PASS (complete, fully scored, on committed code: a valid measurement, not a quality grade)'
      : `Run verdict: ${verdict} (${reasons.join('; ')})`,
    review.length === 0 ? 'To review: nothing' : `To review (${review.length}):`,
    ...review.map((item) => `- ${item.caseId}${item.rep === null ? '' : ` #${item.rep}`}: ${item.reason}`),
    '',
    ...(comparison === undefined ? ['No comparison: pass --baseline <run file> to compare case by case against the noise.'] : comparisonLines(comparison)),
  ];
  return lines;
}
