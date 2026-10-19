// The findings-proposal evaluation (BUILD-LEARNINGS Part 9).
//
// What it measures: when a person asks an agent to "propose findings from your last answer", how much of what the agent
// proposes survives the code checks (src/shared/findings.ts), and how many of the planted problems of a case pack end up
// as findings on the documents where they are planted.
//
// - One execution path: the first answer and the proposal both come from the app's own runAgent(), in the agent's 1:1
//   room, with the data room the app would build for these documents. The proposal turn is built as the app builds it:
//   the history ends with the answer and the fixed request, and the findings instructions follow the data room's.
// - Grading is code, not a judge: the same checkProposal the app runs decides what is a draft and what is refused.
//   Nothing here reads whether a claim is true; a draft that passes is a verbatim quote from a document the agent was
//   shown, and that is all the check promises.
// - Planted-issue coverage is document level and says so: an issue counts as covered when every shown document where
//   it is planted has at least one draft. It does not say the finding states the problem correctly.
// - Fail fast: 3 unusable answers in a row abort the run, and the caller saves nothing then.
import { createHash } from 'node:crypto';
import type { RunAgentDeps, RunAgentResult } from '@/server/chat/run-agent';
import { dataRoomMaterial } from '@/server/prompts/data-room';
import { PROPOSE_FINDINGS_INSTRUCTIONS, proposalContextFor } from '@/server/prompts/findings';
import type { AgentId, AgentSpec, CheckedFinding, LlmClient, LlmMessage, ProposalRefusalCode, RefusedClaim } from '@/shared/contracts';
import { FINDINGS_REQUEST_TEXT, PROPOSAL_MAX_TOKENS, checkProposal } from '@/shared/findings';
import type { EvalCase } from './cases';
import { caseMaterial, caseRoom, type CasePack, type IssueKind } from './packs';
import {
  EVAL_FENCE_MARKER,
  EVAL_TIME_ZONE,
  EvalAbortedError,
  EvalSetupError,
  FAIL_FAST_AFTER,
  evalContext,
  unusableReason,
  type GitState,
  type RunAgentFn,
} from './run';

export const PROPOSE_RECORD_SCHEMA = 'dhht-eval-propose/1';

/** Kinds of planted problem that a draft on the right documents can stand for. The others are planted in the conversation or are absences. */
export const COVERABLE_KINDS: ReadonlySet<IssueKind> = new Set<IssueKind>(['claim-vs-record', 'gap', 'unsupported-claim', 'after-cutoff']);
/** Kinds that cannot be tested as a proposal at all: the problem is in the conversation, not in a document. */
const NOT_PROPOSABLE: ReadonlySet<IssueKind> = new Set<IssueKind>(['agent-error', 'referral']);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const evalFenceRandom = () => EVAL_FENCE_MARKER;

/** The cases a proposal can be asked of: on a pack, one question from the person, and no problem planted in the conversation. */
export function proposalCases(cases: readonly EvalCase[], packs: ReadonlyMap<string, CasePack>): EvalCase[] {
  return cases.filter((evalCase) => {
    const pack = evalCase.pack === undefined ? undefined : packs.get(evalCase.pack);
    if (pack === undefined || evalCase.turns.length !== 1) return false;
    const kinds = (evalCase.issues ?? []).map((id) => pack.issues.find((issue) => issue.id === id)?.kind);
    return !kinds.some((kind) => kind !== undefined && NOT_PROPOSABLE.has(kind));
  });
}

export type Coverage = 'full' | 'partial' | 'none';

export interface IssueCoverage {
  issueId: string;
  kind: IssueKind;
  /** The documents where it is planted and the agent was shown. */
  documents: string[];
  /** Of those, the ones that have at least one draft. */
  covered: string[];
  coverage: Coverage;
}

export interface ProposalRecord {
  /** sha256 of the exact prompt runAgent sent for the proposal. */
  promptHash: string;
  model: string | null;
  latencyMs: number;
  /** Set when the reply held no proposal at all. */
  parseError: string | null;
  /** The drafts: every claim that passed the checks. */
  accepted: CheckedFinding[];
  /** Claims refused by a check, and claims the agent itself listed as unsupported. */
  refused: RefusedClaim[];
}

export interface ProposeResult {
  caseId: string;
  agentId: AgentId;
  agentName: string;
  /** 1-based. */
  rep: number;
  /** The first answer the proposal follows. */
  answer: { text: string; status: RunAgentResult['status']; model: string | null; promptHash: string; latencyMs: number; unusable: string | null };
  /** Null when the first answer or the proposal could not be used. */
  proposal: ProposalRecord | null;
  /** Why there is no proposal; null when there is one. */
  unusable: string | null;
  /** Empty when there is no proposal. */
  coverage: IssueCoverage[];
}

export interface ProposeFingerprint {
  startedAt: string;
  finishedAt: string;
  commit: string | null;
  dirty: boolean | null;
  reps: number;
  /** sha256 over the case ids and hashes. */
  caseSetHash: string;
  packSetHash: string;
  /** sha256 over the instructions every proposal turn carries. */
  proposalInstructionsHash: string;
  agentsModel: { configured: string; resolved: string[] };
  filters: { agents: string[] | null; cases: string[] | null };
  node: string;
}

export interface ProposeRunRecord {
  schema: typeof PROPOSE_RECORD_SCHEMA;
  fingerprint: ProposeFingerprint;
  cases: Array<{ id: string; version: number; agent: AgentId; hash: string; issues: string[] }>;
  results: ProposeResult[];
}

export interface ProposeRunOptions {
  cases: readonly EvalCase[];
  packs: ReadonlyMap<string, CasePack>;
  reps?: number;
  filters?: ProposeFingerprint['filters'];
}

export interface ProposeRunDeps {
  runAgent: RunAgentFn;
  getAgent: (id: AgentId) => AgentSpec | undefined;
  agentsLlm: LlmClient;
  git: () => GitState;
  clock?: () => Date;
  elapsed?: () => number;
  print?: (line: string) => void;
  log?: Pick<Console, 'error' | 'warn'>;
  nodeVersion?: string;
  deadline?: () => AbortSignal;
}

const TURN_DEADLINE_MS = 180_000;
export const PROPOSE_REPETITIONS = 3;

/** How well the drafts cover one issue: the shown documents where it is planted, and the ones with a draft. */
export function coverageOf(evalCase: EvalCase, pack: CasePack, accepted: readonly Pick<CheckedFinding, 'documentId'>[]): IssueCoverage[] {
  const room = caseRoom(evalCase, pack);
  const shown = new Set((room?.documents ?? []).filter((document) => document.provided).map((document) => document.id));
  const withDraft = new Set(accepted.map((finding) => finding.documentId));
  const out: IssueCoverage[] = [];
  for (const issueId of evalCase.issues ?? []) {
    const issue = pack.issues.find((entry) => entry.id === issueId);
    if (issue === undefined || !COVERABLE_KINDS.has(issue.kind)) continue;
    const documents = issue.plantedIn.filter((id) => shown.has(id));
    if (documents.length === 0) continue;
    const covered = documents.filter((id) => withDraft.has(id));
    out.push({
      issueId,
      kind: issue.kind,
      documents,
      covered,
      coverage: covered.length === documents.length ? 'full' : covered.length > 0 ? 'partial' : 'none',
    });
  }
  return out;
}

function unusableResult(result: RunAgentResult): string | null {
  return unusableReason(result);
}

async function proposeOnce(
  evalCase: EvalCase,
  pack: CasePack,
  rep: number,
  deps: ProposeRunDeps & Required<Pick<ProposeRunDeps, 'elapsed' | 'deadline'>>,
): Promise<ProposeResult> {
  const agent = deps.getAgent(evalCase.agent);
  if (agent === undefined || !agent.active) throw new EvalSetupError(`case ${evalCase.id}: agent "${evalCase.agent}" is not an active agent`);
  const runDeps: RunAgentDeps = { getAgent: deps.getAgent, llm: deps.agentsLlm, now: () => new Date(`${evalCase.asOf}T12:00:00.000Z`), ...(deps.log ? { log: deps.log } : {}) };
  const material = caseMaterial(evalCase, pack);
  const room = caseRoom(evalCase, pack);
  if (room === null) throw new EvalSetupError(`case ${evalCase.id}: no data room`);
  const roomMaterial = dataRoomMaterial(room);
  const shownIds = roomMaterial.trace?.shown ?? [];

  const base = { caseId: evalCase.id, agentId: agent.id, agentName: agent.name, rep };

  // Step 1: the answer the person asked for, exactly as the standard evaluation asks it.
  let started = deps.elapsed();
  const first = await deps.runAgent(agent.id, evalContext(evalCase, deps.deadline(), material), runDeps);
  const answer = {
    text: first.text,
    status: first.status,
    model: first.model,
    promptHash: first.promptHash,
    latencyMs: Math.round(deps.elapsed() - started),
    unusable: unusableResult(first),
  };
  if (answer.unusable !== null) return { ...base, answer, proposal: null, unusable: `the first answer was unusable (${answer.unusable})`, coverage: [] };

  // Step 2: the proposal, as the app builds it.
  const history: LlmMessage[] = [
    ...evalCase.turns.map(({ role, content }) => ({ role, content })),
    { role: 'assistant', content: first.text },
    { role: 'user', content: FINDINGS_REQUEST_TEXT },
  ];
  started = deps.elapsed();
  const second = await deps.runAgent(
    agent.id,
    {
      room: 'one-to-one',
      role: 'solo',
      history,
      roomContext: material.roomContext,
      instructions: [...material.instructions, ...PROPOSE_FINDINGS_INSTRUCTIONS],
      fenceRandom: evalFenceRandom,
      timeZone: EVAL_TIME_ZONE,
      signal: deps.deadline(),
      maxTokens: PROPOSAL_MAX_TOKENS,
    },
    runDeps,
  );
  const latencyMs = Math.round(deps.elapsed() - started);
  const problem = unusableResult(second);
  if (problem !== null) return { ...base, answer, proposal: null, unusable: `the proposal reply was unusable (${problem})`, coverage: [] };
  if (second.truncated) return { ...base, answer, proposal: null, unusable: 'the proposal reply was cut off', coverage: [] };

  const checked = checkProposal(second.text, proposalContextFor(room, shownIds));
  const proposal: ProposalRecord = {
    promptHash: second.promptHash,
    model: second.model,
    latencyMs,
    parseError: checked.parseError,
    accepted: checked.checked,
    refused: checked.refused,
  };
  return { ...base, answer, proposal, unusable: null, coverage: coverageOf(evalCase, pack, checked.checked) };
}

/** Runs the proposal evaluation. Throws EvalSetupError before any call, and EvalAbortedError when it stops part-way. */
export async function runProposeEval(options: ProposeRunOptions, deps: ProposeRunDeps): Promise<ProposeRunRecord> {
  const reps = options.reps ?? PROPOSE_REPETITIONS;
  if (!Number.isInteger(reps) || reps < 1 || reps > 10) throw new EvalSetupError(`repetitions must be a whole number from 1 to 10; got ${reps}`);
  const cases = [...options.cases];
  if (cases.length === 0) throw new EvalSetupError('no cases to run');
  const usedPacks = new Map<string, CasePack>();
  for (const evalCase of cases) {
    const pack = evalCase.pack === undefined ? undefined : options.packs.get(evalCase.pack);
    if (pack === undefined) throw new EvalSetupError(`case ${evalCase.id}: it names no loaded pack, so there is nothing to propose findings from`);
    usedPacks.set(pack.id, pack);
  }

  const clock = deps.clock ?? (() => new Date());
  const elapsed = deps.elapsed ?? (() => performance.now());
  const deadline = deps.deadline ?? (() => AbortSignal.timeout(TURN_DEADLINE_MS));
  const print = deps.print ?? (() => undefined);
  const git = deps.git();
  const startedAt = clock().toISOString();

  const results: ProposeResult[] = [];
  let unusableInARow = 0;
  const total = cases.length * reps;
  let position = 0;
  for (const evalCase of cases) {
    const pack = usedPacks.get(evalCase.pack as string) as CasePack;
    for (let rep = 1; rep <= reps; rep += 1) {
      position += 1;
      const result = await proposeOnce(evalCase, pack, rep, { ...deps, elapsed, deadline });
      results.push(result);
      if (result.proposal === null) {
        unusableInARow += 1;
        print(`[${position}/${total}] ${evalCase.id} rep ${rep}: no proposal (${result.unusable})`);
        if (unusableInARow >= FAIL_FAST_AFTER) {
          throw new EvalAbortedError(`${FAIL_FAST_AFTER} unusable answers in a row (last: ${result.unusable}); the run is stopped and nothing is saved`);
        }
        continue;
      }
      unusableInARow = 0;
      const { proposal } = result;
      print(
        `[${position}/${total}] ${evalCase.id} rep ${rep}: ${proposal.parseError === null ? `${proposal.accepted.length} drafts, ${proposal.refused.length} refused or unsupported` : `unreadable (${proposal.parseError})`}`,
      );
    }
  }

  const resolved = [...new Set(results.flatMap((result) => [result.answer.model, result.proposal?.model ?? null]).filter((model): model is string => model !== null))].sort();
  return {
    schema: PROPOSE_RECORD_SCHEMA,
    fingerprint: {
      startedAt,
      finishedAt: clock().toISOString(),
      commit: git.commit,
      dirty: git.dirty,
      reps,
      caseSetHash: sha256(cases.map((evalCase) => `${evalCase.id}:${evalCase.hash}`).join('\n')),
      packSetHash: sha256([...usedPacks.values()].map((pack) => `${pack.id}:${pack.hash}`).sort().join('\n')),
      proposalInstructionsHash: sha256([FINDINGS_REQUEST_TEXT, ...PROPOSE_FINDINGS_INSTRUCTIONS].join('\n')),
      agentsModel: { configured: deps.agentsLlm.model, resolved },
      filters: options.filters ?? { agents: null, cases: null },
      node: deps.nodeVersion ?? process.version,
    },
    cases: cases.map((evalCase) => ({ id: evalCase.id, version: evalCase.version, agent: evalCase.agent, hash: evalCase.hash, issues: evalCase.issues ?? [] })),
    results,
  };
}

// ---------------------------------------------------------------------------
// The summary: counts only, never answer text.
// ---------------------------------------------------------------------------

export interface CaseSummary {
  caseId: string;
  agentName: string;
  reps: number;
  /** Repetitions with a readable proposal. */
  proposals: number;
  /** Repetitions with no proposal (first answer or proposal unusable, or a reply with no findings block). */
  noProposal: number;
  drafts: number;
  /** Claims the agent put forward as findings, whether or not they passed: drafts + refused by a check. */
  proposed: number;
  /** Claims the agent listed as unsupported (kept as open questions). */
  unsupported: number;
  refusedByCode: Partial<Record<ProposalRefusalCode, number>>;
  coverage: Record<Coverage, number>;
}

export interface ProposeSummary {
  cases: CaseSummary[];
  totals: Omit<CaseSummary, 'caseId' | 'agentName'>;
}

const emptyTotals = (): ProposeSummary['totals'] => ({
  reps: 0,
  proposals: 0,
  noProposal: 0,
  drafts: 0,
  proposed: 0,
  unsupported: 0,
  refusedByCode: {},
  coverage: { full: 0, partial: 0, none: 0 },
});

function add(into: ProposeSummary['totals'], from: ProposeSummary['totals']): void {
  into.reps += from.reps;
  into.proposals += from.proposals;
  into.noProposal += from.noProposal;
  into.drafts += from.drafts;
  into.proposed += from.proposed;
  into.unsupported += from.unsupported;
  for (const [code, count] of Object.entries(from.refusedByCode)) {
    const key = code as ProposalRefusalCode;
    into.refusedByCode[key] = (into.refusedByCode[key] ?? 0) + (count ?? 0);
  }
  for (const key of ['full', 'partial', 'none'] as const) into.coverage[key] += from.coverage[key];
}

export function summarise(record: ProposeRunRecord): ProposeSummary {
  const byCase = new Map<string, CaseSummary>();
  for (const result of record.results) {
    let summary = byCase.get(result.caseId);
    if (summary === undefined) {
      summary = { caseId: result.caseId, agentName: result.agentName, ...emptyTotals() };
      byCase.set(result.caseId, summary);
    }
    summary.reps += 1;
    const proposal = result.proposal;
    if (proposal === null || proposal.parseError !== null) {
      summary.noProposal += 1;
      continue;
    }
    summary.proposals += 1;
    const refusedChecks = proposal.refused.filter((claim) => claim.code !== 'declared_unsupported');
    summary.drafts += proposal.accepted.length;
    summary.proposed += proposal.accepted.length + refusedChecks.length;
    summary.unsupported += proposal.refused.length - refusedChecks.length;
    for (const claim of refusedChecks) summary.refusedByCode[claim.code] = (summary.refusedByCode[claim.code] ?? 0) + 1;
    for (const entry of result.coverage) summary.coverage[entry.coverage] += 1;
  }
  const cases = [...byCase.values()];
  const totals = emptyTotals();
  for (const entry of cases) add(totals, entry);
  return { cases, totals };
}

const percent = (part: number, whole: number) => (whole === 0 ? 'n/a' : `${Math.round((100 * part) / whole)}%`);

function coverageText(coverage: Record<Coverage, number>): string {
  const total = coverage.full + coverage.partial + coverage.none;
  return total === 0 ? 'no coverable issue' : `issue coverage full ${coverage.full}, partial ${coverage.partial}, none ${coverage.none}`;
}

/** The report: one line per case and a total. Counts and rates; the saved run holds the drafts. */
export function formatProposeReport(record: ProposeRunRecord): string[] {
  const { cases, totals } = summarise(record);
  const lines = [
    `Findings proposals: ${record.cases.length} cases x ${record.fingerprint.reps} repetitions (document-level coverage; code-checked quotes, no judge)`,
  ];
  for (const entry of cases) {
    const refused = Object.entries(entry.refusedByCode)
      .map(([code, count]) => `${code} ${count}`)
      .join(', ');
    lines.push(
      `- ${entry.caseId} (${entry.agentName}): ${entry.proposals}/${entry.reps} readable, ${entry.drafts} drafts of ${entry.proposed} proposed (${percent(entry.drafts, entry.proposed)} passed)` +
        `${entry.unsupported > 0 ? `, ${entry.unsupported} unsupported` : ''}${refused ? `, refused: ${refused}` : ''}; ${coverageText(entry.coverage)}`,
    );
  }
  lines.push(
    `Total: ${totals.proposals}/${totals.reps} readable proposals, ${totals.drafts} drafts of ${totals.proposed} proposed (${percent(totals.drafts, totals.proposed)} passed), ${totals.unsupported} unsupported; ${coverageText(totals.coverage)}`,
  );
  return lines;
}
