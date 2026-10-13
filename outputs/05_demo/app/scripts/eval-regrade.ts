// An offline re-grade of a saved eval run (BUILD-LEARNINGS 9.3, 9.6).
//
// Run from the app folder:
//   tsx --conditions=react-server scripts/eval-regrade.ts <run file> [--cases <folder>]
//
// Takes a run saved under .eval-runs/ and runs the deterministic checks of the CURRENT case
// files again on the stored answers. It prints, per agent, the answers with every check
// passed, the critical answers and the good answers, before and after, and lists each result
// whose pass status changed.
//
// What this is not: a new measurement. The answers and the judge scores are the stored ones;
// no model is called, no run is made, nothing is written (the run file is only read), and
// the case hash of an edited case no longer matches the one in the run. Use it to see what
// a wider or narrower check would have said about the same answers, then confirm with a fresh
// run on committed case files. It reads no env file, so it holds no key and prints no host.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EvalCaseError, formatIssue, loadCases, type EvalCase } from '../evals/lib/cases';
import { allPassed, hasCritical, runChecks, type CheckResult } from '../evals/lib/checks';
import { GOOD_SCORE, summarise, type AgentSummary } from '../evals/lib/report';
import { RUN_RECORD_SCHEMA, type EvalResult, type EvalRunRecord } from '../evals/lib/run';

/** passed: every check passed · failed: a check failed · critical: a forbidden claim or pattern matched. */
export type ResultStatus = 'passed' | 'failed' | 'critical';

export interface ChangedResult {
  caseId: string;
  /** 1-based. */
  rep: number;
  before: ResultStatus;
  after: ResultStatus;
  /** The stored judge's overall score; null when the judge could not score the answer. */
  judgeOverall: number | null;
}

export interface MissingCase {
  caseId: string;
  /** Results of this case in the run; their stored checks are kept. */
  results: number;
}

export interface Summaries {
  agents: AgentSummary[];
  all: AgentSummary;
}

export interface RegradeReport {
  before: Summaries;
  after: Summaries;
  /** Results (in run order) whose pass status differs before and after. */
  changed: ChangedResult[];
  /** Cases in the run with no case in the current files. */
  missingCases: MissingCase[];
  /** Cases in the run and in the current files whose hash differs. */
  hashChanged: string[];
  /** Cases in the run that the current files also hold. */
  comparedCases: number;
  /** The run with the re-run checks; a copy, the input is not touched. */
  regraded: EvalRunRecord;
}

const statusOf = (checks: readonly CheckResult[]): ResultStatus => (hasCritical(checks) ? 'critical' : allPassed(checks) ? 'passed' : 'failed');

/**
 * Re-runs the current cases' deterministic checks on the stored answers. An unusable answer
 * and a result of a case that is no longer in the files keep their stored checks.
 */
export function regradeRun(record: EvalRunRecord, cases: readonly EvalCase[]): RegradeReport {
  const current = new Map(cases.map((evalCase) => [evalCase.id, evalCase]));
  const missing = new Map<string, number>();
  const changed: ChangedResult[] = [];

  const results = record.results.map((result): EvalResult => {
    const evalCase = current.get(result.caseId);
    if (evalCase === undefined) {
      missing.set(result.caseId, (missing.get(result.caseId) ?? 0) + 1);
      return result;
    }
    if (result.answer.unusable !== null) return result;
    const checks = runChecks(evalCase.expected, result.answer.text);
    const before = statusOf(result.checks);
    const after = statusOf(checks);
    if (before !== after) {
      changed.push({ caseId: result.caseId, rep: result.rep, before, after, judgeOverall: result.judge?.ok ? result.judge.overall : null });
    }
    return { ...result, checks };
  });
  const regraded: EvalRunRecord = { ...record, results };

  const inBoth = record.cases.filter((entry) => current.has(entry.id));
  return {
    before: summarise(record),
    after: summarise(regraded),
    changed,
    missingCases: [...missing].map(([caseId, count]) => ({ caseId, results: count })),
    hashChanged: inBoth.filter((entry) => current.get(entry.id)?.hash !== entry.hash).map((entry) => entry.id),
    comparedCases: inBoth.length,
    regraded,
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((cells) => cells[column].length)));
  return rows.map((cells) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ').trimEnd());
}

/** The report to print: counts, ids and statuses only. It never holds an answer, a critique, a key or a host. */
export function formatRegrade(record: EvalRunRecord, report: RegradeReport, runName = 'the run'): string[] {
  const { fingerprint } = record;
  const commit = typeof fingerprint.commit === 'string' ? `commit ${fingerprint.commit.slice(0, 7)}` : 'no commit';
  const move = (before: number, after: number) => `${before} -> ${after}`;
  const rowOf = (before: AgentSummary, after: AgentSummary): string[] => [
    before.label,
    String(before.answers - before.unusable),
    move(before.checksPassed, after.checksPassed),
    move(before.critical, after.critical),
    move(before.good, after.good),
  ];
  const hashLine =
    report.hashChanged.length === 0
      ? `Case hash unchanged for all ${plural(report.comparedCases, 'case')} found in the current files, so the checks should say what they said in the run.`
      : `Case hash changed for ${report.hashChanged.length} of ${plural(report.comparedCases, 'case')} found in the current files (the case files were edited after the run), so this is not a new measurement: confirm with a fresh run on committed case files.`;

  const lines = [
    'Re-grade of a saved eval run. Offline: no model was called, no new run was made, and nothing was written.',
    `Run: ${runName}, started ${fingerprint.startedAt}, ${commit}, ${plural(record.cases.length, 'case')} x ${fingerprint.reps} repetitions`,
    'This is a re-grade of the same answers: the answers and the judge scores are the stored ones. Only the deterministic checks were run again, with the current case files.',
    hashLine,
  ];
  if (report.hashChanged.length > 0) lines.push(`Cases with a changed hash: ${report.hashChanged.join(', ')}`);
  if (report.missingCases.length > 0) {
    const results = report.missingCases.reduce((sum, entry) => sum + entry.results, 0);
    lines.push(
      `No case in the current files for ${plural(report.missingCases.length, 'case')} (${plural(results, 'result')}): ${report.missingCases
        .map((entry) => entry.caseId)
        .join(', ')}. Their stored checks are kept as they were.`,
    );
  }
  lines.push(
    '',
    `Per agent, before -> after. Checks passed: usable answers with every check passed. Critical: usable answers where a forbidden claim or pattern matched. Good: every check passed and the stored judge overall is at least ${GOOD_SCORE}.`,
    ...table([
      ['Agent', 'Usable', 'Checks passed', 'Critical', 'Good'],
      ...report.before.agents.map((entry, position) => rowOf(entry, report.after.agents[position])),
      rowOf(report.before.all, report.after.all),
    ]),
    '',
    report.changed.length === 0
      ? 'Results whose pass status changed: none'
      : `Results whose pass status changed (${report.changed.length}; passed = every check passed, failed = a check failed, critical = a forbidden hit):`,
    ...report.changed.map(
      (entry) =>
        `- ${entry.caseId} #${entry.rep}: ${entry.before} -> ${entry.after} (${entry.judgeOverall === null ? 'no judge score' : `judge ${entry.judgeOverall.toFixed(1)}`})`,
    ),
  );
  return lines;
}

export interface RegradeArgs {
  /** The saved run, as written on the command line; null with --help. */
  runFile: string | null;
  /** A cases folder to use instead of evals/cases; null for the default. */
  casesDir: string | null;
  help: boolean;
}

export type ParsedRegradeArgs = { ok: true; args: RegradeArgs } | { ok: false; message: string };

/** Parses the command line. Never throws: a problem comes back as a message. */
export function parseRegradeArgs(argv: readonly string[]): ParsedRegradeArgs {
  const args: RegradeArgs = { runFile: null, casesDir: null, help: false };
  for (let index = 0, count = argv.length; index < count; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--cases' || token.startsWith('--cases=')) {
      let value: string | undefined;
      if (token.startsWith('--cases=')) {
        value = token.slice('--cases='.length);
      } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
        value = argv[index + 1];
        index += 1;
      }
      if (value === undefined || value.trim() === '') return { ok: false, message: '--cases needs a value' };
      args.casesDir = value.trim();
    } else if (token.startsWith('-')) {
      return { ok: false, message: `unknown option "${token}"` };
    } else if (args.runFile !== null) {
      return { ok: false, message: `unexpected argument "${token}": name one run file` };
    } else {
      args.runFile = token;
    }
  }
  if (!args.help && args.runFile === null) return { ok: false, message: 'needs a run file: pass the path of a run saved under .eval-runs/' };
  return { ok: true, args };
}

type RunRead = { ok: true; record: EvalRunRecord } | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a saved run and checks the shape the re-grade relies on. Never writes. */
function readRun(file: string, shown: string): RunRead {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return { ok: false, message: `cannot read the run file "${shown}": ${code ?? 'it is not valid JSON'}` };
  }
  if (!isObject(value) || value.schema !== RUN_RECORD_SCHEMA || !isObject(value.fingerprint) || !Array.isArray(value.cases) || !Array.isArray(value.results)) {
    return { ok: false, message: `"${shown}" is not an eval run record (expected schema "${RUN_RECORD_SCHEMA}")` };
  }
  for (const [index, result] of value.results.entries()) {
    const at = `result ${index + 1}`;
    if (!isObject(result) || typeof result.caseId !== 'string' || typeof result.rep !== 'number') {
      return { ok: false, message: `${at} of "${shown}" has no case id or repetition` };
    }
    const answer = result.answer;
    if (!isObject(answer) || typeof answer.text !== 'string') return { ok: false, message: `${at} of "${shown}" has no answer text, so it cannot be re-graded` };
    if (answer.unusable !== null && typeof answer.unusable !== 'string') return { ok: false, message: `${at} of "${shown}" does not say whether the answer was usable` };
    if (!Array.isArray(result.checks)) return { ok: false, message: `${at} of "${shown}" has no stored checks` };
  }
  return { ok: true, record: value as unknown as EvalRunRecord };
}

const HELP = [
  'Usage: tsx --conditions=react-server scripts/eval-regrade.ts <run file> [--cases <folder>]',
  '',
  'Re-runs the deterministic checks of the current case files on the answers stored in a saved run, and prints',
  'per agent the answers with every check passed, the critical answers and the good answers, before and after.',
  'Offline: no model is called, no new run is made, and the run file is only read, never written.',
  'It is a re-grade of the same answers with the stored judge scores, not a new measurement.',
  '',
  'Options:',
  '  --cases <folder>   use this folder of case files instead of evals/cases',
  '  --help             show this text',
  '',
  'Exit codes: 0 done · 2 setup problem (no re-grade made).',
];

export interface RegradeCliOptions {
  /** The command-line arguments after the script name. */
  argv: readonly string[];
  /** Relative paths are read from here; default: the working folder. */
  cwd?: string;
  /** The folder of case files used when --cases is not given (evals/cases). */
  casesDir: string;
  /** One line of output. */
  print: (line: string) => void;
}

/** Runs the re-grade and returns the exit code. */
export function runRegradeCli(options: RegradeCliOptions): number {
  const { print } = options;
  const cwd = options.cwd ?? process.cwd();

  const parsed = parseRegradeArgs(options.argv);
  if (!parsed.ok) {
    print(`error: ${parsed.message}`);
    print('Run with --help to see the options.');
    return 2;
  }
  const { args } = parsed;
  if (args.help || args.runFile === null) {
    for (const line of HELP) print(line);
    return 0;
  }

  const read = readRun(path.resolve(cwd, args.runFile), args.runFile);
  if (!read.ok) {
    print(`error: ${read.message}`);
    return 2;
  }

  let cases: EvalCase[];
  try {
    cases = loadCases(args.casesDir === null ? options.casesDir : path.resolve(cwd, args.casesDir));
  } catch (error) {
    if (error instanceof EvalCaseError) {
      print(`${plural(error.issues.length, 'problem')} in the eval cases:`);
      for (const issue of error.issues) print(`- ${formatIssue(issue)}`);
    } else {
      print(`error: cannot read the cases folder "${args.casesDir ?? 'evals/cases'}"`);
    }
    return 2;
  }

  for (const line of formatRegrade(read.record, regradeRun(read.record, cases), path.basename(args.runFile))) print(line);
  return 0;
}

async function main(): Promise<number> {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return runRegradeCli({ argv: process.argv.slice(2), casesDir: path.join(appDir, 'evals', 'cases'), print: (line) => console.log(line) });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`regrade crashed: ${error instanceof Error ? error.name : 'unknown error'}`);
      process.exit(3);
    },
  );
}
