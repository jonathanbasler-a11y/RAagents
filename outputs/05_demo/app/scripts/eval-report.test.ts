import { describe, expect, it } from 'vitest';
import { MIN_PAIRED_CASES, compareRuns, formatReport, reviewQueue, summarise, verdictOf } from '../evals/lib/report';
import {
  CRITICAL_CHECK,
  MISSING_CHECK,
  caseResults,
  makeRecord,
  makeResult,
} from '../evals/lib/test-support';

describe('summarise: per agent, with counts', () => {
  it('counts cases, answers, unusable, checks, critical failures, judged and good answers per agent, in run order', () => {
    const record = makeRecord([
      ...caseResults('lead-a', [5, 4, 3]),
      makeResult({ caseId: 'lead-b', rep: 1, overall: 4, checks: [CRITICAL_CHECK] }),
      makeResult({ caseId: 'lead-b', rep: 2, unusable: 'llm_outage' }),
      makeResult({ caseId: 'lead-b', rep: 3, overall: null }),
      ...caseResults('cmc-a', [2, 2, 2], { agentId: 'cmc', agentName: 'Carlos' }),
    ]);

    const { agents, all } = summarise(record);

    expect(agents.map((agent) => agent.label)).toEqual(['Rosa (lead)', 'Carlos (cmc)']);
    expect(agents[0]).toMatchObject({ cases: 2, answers: 6, unusable: 1, checksPassed: 4, critical: 1, judged: 4, unscored: 1, good: 2 });
    expect(agents[1]).toMatchObject({ cases: 1, answers: 3, unusable: 0, checksPassed: 3, critical: 0, judged: 3, unscored: 0, good: 0 });
    expect(all).toMatchObject({ label: 'All agents', cases: 3, answers: 9, unusable: 1, critical: 1, judged: 7 });
  });

  it('estimates the overall score across case means, with two standard errors across cases', () => {
    const record = makeRecord([...caseResults('a', [4, 4, 4]), ...caseResults('b', [3, 3, 3]), ...caseResults('c', [5, 5, 5])]);

    const { all } = summarise(record);

    // Case means 4, 3 and 5: mean 4, sample SD 1, SE 1/sqrt(3).
    expect(all.overall?.mean).toBeCloseTo(4);
    expect(all.overall?.twoSe).toBeCloseTo(2 / Math.sqrt(3));
    expect(all.overall?.n).toBe(3);
  });

  it('gives no noise band for a single case, and no estimate when nothing was judged', () => {
    expect(summarise(makeRecord(caseResults('a', [4, 5, 3]))).all.overall).toEqual({ mean: 4, twoSe: null, n: 1 });
    expect(summarise(makeRecord(caseResults('a', [null, null, null]))).all.overall).toBeNull();
  });

  it('averages each gated dimension over the judged answers', () => {
    const record = makeRecord([
      makeResult({ caseId: 'a', rep: 1, overall: 4, scores: { grounding: 2 } }),
      makeResult({ caseId: 'a', rep: 2, overall: 4, scores: { grounding: 4 } }),
    ]);

    expect(summarise(record).all.dimensions).toEqual({ task_success: 4, usefulness: 4, grounding: 3, role_fit: 4, clarity: 4 });
  });
});

describe('verdictOf (BUILD-LEARNINGS 9.6)', () => {
  const clean = () => makeRecord([...caseResults('a', [4, 4, 4]), ...caseResults('b', [5, 5, 5])]);

  it('passes a complete, fully scored run on committed code', () => {
    expect(verdictOf(clean())).toEqual({ verdict: 'PASS', reasons: [] });
  });

  it('is INVALID with any unusable or unscored answer, or fewer than 3 repetitions', () => {
    expect(verdictOf(makeRecord([...caseResults('a', [4, 4]), makeResult({ caseId: 'a', rep: 3, unusable: 'blank' })]))).toEqual({
      verdict: 'INVALID',
      reasons: ['1 unusable answer (blank, error or broken off)'],
    });
    expect(verdictOf(makeRecord(caseResults('a', [4, null, 4]))).reasons).toEqual(['1 answer the judge could not score']);
    expect(verdictOf(makeRecord(caseResults('a', [4]))).reasons).toEqual(['fewer than 3 repetitions per case (1), so the run does not count']);
  });

  it('is INVALID when more than one judge model scored the run, or answers are missing', () => {
    const mixed = makeRecord([...caseResults('a', [4, 4]), makeResult({ caseId: 'a', rep: 3, judgeModel: 'gpt-5.6-other-test' })]);
    expect(verdictOf(mixed).reasons).toEqual([expect.stringMatching(/more than one judge model/)]);

    const short = makeRecord(caseResults('a', [4, 4, 4]), { fingerprint: { reps: 3 } });
    short.cases.push({ ...short.cases[0], id: 'never-ran' });
    expect(verdictOf(short).reasons).toEqual(['incomplete: 3 of 6 answers']);
  });

  it('is UNVERIFIABLE with uncommitted code, no commit, an unknown dirty flag or a missing fingerprint field', () => {
    expect(verdictOf(makeRecord(caseResults('a', [4, 4, 4]), { fingerprint: { dirty: true } }))).toEqual({
      verdict: 'UNVERIFIABLE',
      reasons: ['uncommitted changes in the app or the agent specs when the run started'],
    });
    expect(verdictOf(makeRecord(caseResults('a', [4, 4, 4]), { fingerprint: { commit: null } })).reasons).toEqual(['no commit recorded']);
    expect(verdictOf(makeRecord(caseResults('a', [4, 4, 4]), { fingerprint: { dirty: null } })).reasons).toEqual([
      'could not tell whether there were uncommitted changes',
    ]);
    expect(verdictOf(makeRecord(caseResults('a', [4, 4, 4]), { fingerprint: { judgePromptHash: '' } })).reasons).toEqual([
      'fingerprint field "judgePromptHash" is missing',
    ]);
  });

  it('reports INVALID before UNVERIFIABLE, keeping every reason', () => {
    expect(verdictOf(makeRecord(caseResults('a', [4]), { fingerprint: { dirty: true } }))).toEqual({
      verdict: 'INVALID',
      reasons: [expect.stringMatching(/fewer than 3/), 'uncommitted changes in the app or the agent specs when the run started'],
    });
  });
});

describe('reviewQueue (BUILD-LEARNINGS 9.8)', () => {
  it('lists critical failures, unusable and unscored answers, disagreeing graders, low scores, cut-off answers and unstable cases', () => {
    const record = makeRecord([
      makeResult({ caseId: 'a', rep: 1, overall: 5, checks: [CRITICAL_CHECK] }),
      makeResult({ caseId: 'a', rep: 2, unusable: 'llm_outage' }),
      makeResult({ caseId: 'a', rep: 3, overall: null }),
      makeResult({ caseId: 'b', rep: 1, overall: 4.6, checks: [MISSING_CHECK] }),
      makeResult({ caseId: 'b', rep: 2, overall: 2.4 }),
      makeResult({ caseId: 'b', rep: 3, overall: 4, truncated: true }),
      ...caseResults('c', [4, 4, 4]),
    ]);

    expect(reviewQueue(record).map((item) => `${item.caseId}${item.rep === null ? '' : ` #${item.rep}`}: ${item.reason}`)).toEqual([
      'a #1: critical: forbidden claim "I recommend buying" matched "I recommend buying"',
      'a #2: unusable: llm_outage',
      'a #3: the judge could not score it: the judge reply holds no JSON object',
      'a: unstable across repetitions: deterministic checks passed in 1 of 2',
      'b #1: graders disagree: a deterministic check failed, but the judge gave 4.6',
      'b #2: low judge score (2.4)',
      'b #3: cut off at the output limit',
      'b: unstable across repetitions: overall from 2.4 to 4.6',
      'b: unstable across repetitions: deterministic checks passed in 2 of 3',
    ]);
  });
});

describe('compareRuns: case-paired, against the noise (BUILD-LEARNINGS 9.6)', () => {
  /** One run with these per-case overall scores (3 repetitions each, all the same). */
  function run(means: Record<string, number>, patch: Parameters<typeof makeRecord>[1] = {}) {
    return makeRecord(
      Object.entries(means).flatMap(([caseId, mean]) => caseResults(caseId, [mean, mean, mean])),
      patch,
    );
  }
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `case-${index + 1}`);
  const scores = (values: number[]) => Object.fromEntries(values.map((value, index) => [`case-${index + 1}`, value]));

  it('calls a consistent gain larger than two standard errors "better"', () => {
    const comparison = compareRuns(run(scores([3, 3.2, 3.4, 3, 3.1, 3.3])), run(scores([4, 4.1, 4.4, 4.1, 4, 4.2])));

    expect(comparison.status).toBe('valid');
    expect(comparison.rows.find((row) => row.label === 'All agents')).toMatchObject({ n: 6, band: 'better' });
  });

  it('never calls a gain inside the noise a gain: "no measurable effect"', () => {
    const comparison = compareRuns(run(scores([3, 4, 5, 3, 4, 5])), run(scores([3.5, 4.2, 4.6, 3.8, 3.9, 5])));
    const all = comparison.rows.find((row) => row.label === 'All agents');

    expect(all?.diff).toBeGreaterThan(0);
    expect(all?.band).toBe('no measurable effect');
    expect(formatReport(run(scores([3.5, 4.2, 4.6, 3.8, 3.9, 5])), comparison).join('\n')).not.toMatch(/\bbetter\b|\bimprov|\bgains?\b/i);
  });

  it(`says "too few cases" below ${MIN_PAIRED_CASES} paired cases, however large the difference`, () => {
    const comparison = compareRuns(run(scores([2, 2, 2, 2])), run(scores([5, 5, 5, 5])));

    expect(comparison.rows.find((row) => row.label === 'All agents')).toMatchObject({ n: 4, band: 'too few cases' });
  });

  it('calls a consistent loss "worse", per agent and overall', () => {
    const comparison = compareRuns(run(scores([4.5, 4.6, 4.4, 4.5, 4.7])), run(scores([3.1, 3.4, 3.2, 3.3, 3.2])));

    expect(comparison.rows.map((row) => [row.label, row.band])).toEqual([
      ['Rosa (lead)', 'worse'],
      ['All agents', 'worse'],
    ]);
  });

  it('refuses to compare runs judged by different judges or judge prompts, giving no verdict at all', () => {
    const baseline = run(scores([3, 3, 3, 3, 3]));
    const otherPrompt = run(scores([5, 5, 5, 5, 5]), { fingerprint: { judgePromptHash: 'k'.repeat(64) } });
    const otherModel = makeRecord(ids(5).flatMap((id) => caseResults(id, [5, 5, 5], { judgeModel: 'gpt-5.6-other-test' })));

    for (const candidate of [otherPrompt, otherModel]) {
      const comparison = compareRuns(baseline, candidate);
      expect(comparison.status).toBe('invalid');
      expect(comparison.rows).toEqual([]);
    }
    expect(compareRuns(baseline, otherPrompt).problems.join('\n')).toMatch(/judge prompt differs/);
    expect(compareRuns(baseline, otherModel).problems.join('\n')).toMatch(/different judge models/);
  });

  it('refuses to compare when a paired case changed, naming it', () => {
    const comparison = compareRuns(run(scores([3, 3, 3, 3, 3])), run(scores([4, 4, 4, 4, 4]), { caseHashes: { 'case-2': 'changed' } }));

    expect(comparison.status).toBe('invalid');
    expect(comparison.changed).toEqual(['case-2']);
    expect(comparison.problems.join('\n')).toMatch(/changed case/);
  });

  it('refuses to compare with an INVALID run, and flags an UNVERIFIABLE one while still comparing', () => {
    const invalid = makeRecord(ids(5).flatMap((id) => caseResults(id, [4])));
    expect(compareRuns(invalid, run(scores([4, 4, 4, 4, 4]))).status).toBe('invalid');

    const dirty = run(scores([4, 4, 4, 4, 4]), { fingerprint: { dirty: true } });
    const comparison = compareRuns(run(scores([4, 4, 4, 4, 4])), dirty);
    expect(comparison.status).toBe('unverifiable');
    expect(comparison.problems.join('\n')).toMatch(/candidate run is UNVERIFIABLE/);
    expect(comparison.rows.length).toBeGreaterThan(0);
  });

  it('lists cases in only one run, and every baseline case below 4.0 so nothing is hand-picked', () => {
    const comparison = compareRuns(run({ 'case-1': 3.5, 'case-2': 4.5, 'only-old': 3 }), run({ 'case-1': 4, 'case-2': 4, 'only-new': 4 }));

    expect(comparison.unpaired).toEqual(['only-new', 'only-old']);
    expect(comparison.baselineBelow4).toEqual([
      { caseId: 'case-1', mean: 3.5 },
      { caseId: 'only-old', mean: 3 },
    ]);
  });
});

describe('formatReport', () => {
  it('prints the run, a per-agent table with counts, the verdict, the review list and how to compare', () => {
    const record = makeRecord([...caseResults('lead-a', [4, 4, 5]), ...caseResults('cmc-a', [3, 3, 3], { agentId: 'cmc', agentName: 'Carlos' })]);

    const text = formatReport(record).join('\n');

    expect(text).toMatch(/2 cases x 3 repetitions = 6 answers/);
    expect(text).toMatch(/commit c0ffee0 \(uncommitted changes: no\)/);
    expect(text).toMatch(/Agents: anthropic\.claude-test-agents \(anthropic\)/);
    expect(text).toMatch(/Judge: gpt-5\.6-sol-test-judge \(openai\)/);
    expect(text).toMatch(/^Rosa \(lead\)\s+1\s+3\s+0\s+3\/3\s+0\s+3\/3\s+4\.33/m);
    expect(text).toMatch(/^Carlos \(cmc\)\s+1\s+3\s+0\s+3\/3\s+0\s+3\/3\s+3\.00/m);
    expect(text).toMatch(/^All agents\s+2\s+6\s+0\s+6\/6\s+0\s+6\/6\s+3\.67 ±1\.33/m);
    expect(text).toMatch(/Run verdict: PASS/);
    expect(text).toMatch(/To review: nothing/);
    expect(text).toMatch(/No comparison: pass --baseline <run file> to compare case by case against the noise\./);
  });

  it('prints no answer text and no critique', () => {
    const record = makeRecord(caseResults('a', [4, 4, 4]));
    record.results[0].answer.text = 'ANSWER-TEXT-MARKER';
    const judge = record.results[0].judge;
    if (judge?.ok) judge.critique = 'CRITIQUE-MARKER';

    const text = formatReport(record).join('\n');

    expect(text).not.toContain('ANSWER-TEXT-MARKER');
    expect(text).not.toContain('CRITIQUE-MARKER');
  });

  it('prints an invalid comparison as problems only, with no per-agent verdicts', () => {
    const baseline = makeRecord(caseResults('a', [4]));
    const candidate = makeRecord(caseResults('a', [5, 5, 5]));

    const text = formatReport(candidate, compareRuns(baseline, candidate)).join('\n');

    expect(text).toMatch(/Comparison INVALID, so no verdict: the baseline run is INVALID/);
    expect(text).not.toMatch(/better|worse|no measurable effect/);
  });
});
