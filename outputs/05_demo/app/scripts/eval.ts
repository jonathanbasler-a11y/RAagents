// The evaluation runner (BUILD-LEARNINGS Part 9).
//
// Run from the app folder: npm run eval -- [options]   (tsx --conditions=react-server scripts/eval.ts)
//
// Loads env files the way `next dev` does (@next/env), loads the cases under evals/cases/,
// then runs every case 3 times through the app's own runAgent (one execution path), checks
// each usable answer deterministically, and has the judge route score it. Prints a
// per-agent summary with counts, saves the run under .eval-runs/ (git-ignored), and exits
// with a code a script can act on. Never prints a key or the gateway host.
//
// Exit codes: 0 a valid run (PASS) · 1 a complete run that is not a valid measurement
// (INVALID or UNVERIFIABLE), saved · 2 a setup problem, nothing was run · 3 the run aborted,
// nothing was saved.
import { loadEnvConfig } from '@next/env';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { AgentSpecError, loadRegistry } from '@/server/agents';
import { runAgent } from '@/server/chat/run-agent';
import { checkEnvFilePermissions, createLlmClient, modelFamily, readLlmConfig } from '@/server/llm';
import type { AgentRegistry, LlmConfigResult, LlmRouteName } from '@/shared/contracts';
import { EvalCaseError, formatIssue, loadCases, type EvalCase } from '../evals/lib/cases';
import { compareRuns, formatReport, verdictOf } from '../evals/lib/report';
import {
  EVAL_REPETITIONS,
  EvalAbortedError,
  EvalSetupError,
  RUN_RECORD_SCHEMA,
  judgeFamilyProblem,
  runEval,
  type EvalRunRecord,
  type GitState,
} from '../evals/lib/run';

const MAX_REPS = 10;
const REDACTED = '[redacted]';
// A value shorter than this is not a key or a host; replacing it would shred ordinary text.
const MIN_SECRET_LENGTH = 4;

export interface EvalArgs {
  /** Agent ids to run; empty means every agent. */
  agents: string[];
  /** Case ids to run; empty means every case. */
  cases: string[];
  reps: number;
  /** A saved run to compare with; null for none. */
  baseline: string | null;
  /** Validate the cases and show the settings; no model call. */
  check: boolean;
  help: boolean;
}

export type ParsedEvalArgs = { ok: true; args: EvalArgs } | { ok: false; message: string };

const LIST_OPTIONS = new Set(['--agent', '--case']);
const VALUE_OPTIONS = new Set(['--reps', '--baseline']);
const FLAG_OPTIONS = new Set(['--check', '--help', '-h']);

/** Parses the options after `npm run eval --`. Never throws: a problem comes back as a message. */
export function parseEvalArgs(argv: readonly string[]): ParsedEvalArgs {
  const args: EvalArgs = { agents: [], cases: [], reps: EVAL_REPETITIONS, baseline: null, check: false, help: false };
  for (let index = 0, count = argv.length; index < count; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) return { ok: false, message: `unexpected argument "${token}"` };
    const equals = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = equals === -1 ? token : token.slice(0, equals);

    if (FLAG_OPTIONS.has(name)) {
      if (equals !== -1) return { ok: false, message: `${name} does not take a value` };
      if (name === '--check') args.check = true;
      else args.help = true;
      continue;
    }
    if (!LIST_OPTIONS.has(name) && !VALUE_OPTIONS.has(name)) return { ok: false, message: `unknown option "${token}"` };

    let value: string | undefined;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined || value.trim() === '') return { ok: false, message: `${name} needs a value` };

    if (LIST_OPTIONS.has(name)) {
      const items = value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (items.length === 0) return { ok: false, message: `${name} needs a value` };
      args[name === '--agent' ? 'agents' : 'cases'].push(...items);
    } else if (name === '--reps') {
      const reps = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
      if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) return { ok: false, message: `--reps needs a whole number from 1 to ${MAX_REPS}` };
      args.reps = reps;
    } else {
      args.baseline = value.trim();
    }
  }
  return { ok: true, args };
}

/** One git command's output; throws when git fails. */
export type GitExec = (args: string[]) => string;

/**
 * HEAD, and whether the app or the agent specs folder has uncommitted changes (untracked
 * files count). A part git cannot tell is null, which makes the run UNVERIFIABLE; this
 * never throws.
 */
export function readGitState(
  appDir: string,
  specsDir: string,
  exec: GitExec = (args) => execFileSync('git', args, { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
): GitState {
  let commit: string | null = null;
  try {
    const head = exec(['rev-parse', 'HEAD']).trim();
    commit = head === '' ? null : head;
  } catch {
    commit = null;
  }
  let dirty: boolean | null = null;
  try {
    const specs = path.relative(appDir, specsDir).split(path.sep).join('/');
    dirty = exec(['status', '--porcelain', '--', '.', specs]).trim() !== '';
  } catch {
    dirty = null;
  }
  return { commit, dirty };
}

type Env = Readonly<Record<string, string | undefined>>;

/** The configured keys and gateway hosts: the values that must never reach the output. */
function secretsOf(env: Env): string[] {
  const secrets = new Set<string>();
  for (const name of ['LLM_API_KEY', 'LLM_JUDGE_API_KEY']) {
    const value = env[name]?.trim();
    if (value) secrets.add(value);
  }
  for (const name of ['LLM_BASE_URL', 'LLM_JUDGE_BASE_URL']) {
    const value = env[name]?.trim();
    if (!value) continue;
    secrets.add(value);
    try {
      const url = new URL(value);
      secrets.add(url.host);
      secrets.add(url.hostname);
    } catch {
      // Not a URL: the whole value is already covered.
    }
  }
  // Longest first, so a URL goes before the host inside it.
  return [...secrets].filter((secret) => secret.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
}

function redactor(env: Env): (text: string) => string {
  const secrets = secretsOf(env);
  return (text) => secrets.reduce((result, secret) => result.split(secret).join(REDACTED), text);
}

/** console.error and console.warn with the configured keys and hosts removed from every line. */
export function redactingLog(env: Env): Pick<Console, 'error' | 'warn'> {
  const redact = redactor(env);
  return {
    error: (...args: unknown[]) => console.error(redact(format(...args))),
    warn: (...args: unknown[]) => console.warn(redact(format(...args))),
  };
}

export interface EvalCliOptions {
  /** The options after `npm run eval --`. */
  argv: readonly string[];
  env: Env;
  fetch: typeof fetch;
  appDir: string;
  specsDir: string;
  publicDir: string;
  /** The folder of case files (evals/cases). */
  casesDir: string;
  /** Where runs are saved (.eval-runs). */
  outDir: string;
  /** The checkout's state; default: read it with git. */
  git?: () => GitState;
  /** One line of output. */
  print: (line: string) => void;
  clock?: () => Date;
  nodeVersion?: string;
  /** Passed to runAgent; default: console with keys and hosts removed. */
  log?: Pick<Console, 'error' | 'warn'>;
}

const HELP = [
  'Usage: npm run eval -- [options]',
  '',
  'Runs every eval case 3 times through the agents route, checks each answer, and has the judge route score it.',
  '',
  'Options:',
  '  --agent <id[,id]>   only the cases of these agents (repeat to add more)',
  '  --case <id[,id]>    only these cases (repeat to add more)',
  `  --reps <1-${MAX_REPS}>       repetitions per case (default ${EVAL_REPETITIONS}; fewer than ${EVAL_REPETITIONS} makes the run INVALID)`,
  '  --baseline <file>   compare the run with a saved run, case by case',
  '  --check             validate the cases against the roster and show the settings; no model is called',
  '  --help              show this text',
  '',
  'Exit codes: 0 valid run (PASS) · 1 complete but INVALID or UNVERIFIABLE (saved) · 2 setup problem, nothing run · 3 aborted, nothing saved.',
  'Runs are saved under .eval-runs/ (git-ignored).',
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function registryProblems(error: unknown): string[] {
  if (error instanceof AgentSpecError) return error.issues.map((issue) => `${issue.source}: ${issue.message}`);
  return [error instanceof Error ? error.message : String(error)];
}

function routeLine(route: LlmRouteName, read: LlmConfigResult): string {
  if (!read.ok) return `${route} route: not configured (${read.error.missing.join(', ')})`;
  return `${route} route: model ${read.config.model} (family ${modelFamily(read.config.model)})`;
}

type BaselineRead = { ok: true; record: EvalRunRecord } | { ok: false; message: string };

/** A saved run, read back. Only the shape compareRuns relies on is checked. */
function readBaseline(file: string, shown: string): BaselineRead {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return { ok: false, message: `cannot read the baseline "${shown}": ${code ?? 'it is not valid JSON'}` };
  }
  const record = value as Partial<EvalRunRecord> | null;
  const isRecord =
    typeof record === 'object' &&
    record !== null &&
    record.schema === RUN_RECORD_SCHEMA &&
    typeof record.fingerprint === 'object' &&
    record.fingerprint !== null &&
    Array.isArray(record.cases) &&
    Array.isArray(record.results);
  if (!isRecord) return { ok: false, message: `the baseline "${shown}" is not an eval run record (expected schema "${RUN_RECORD_SCHEMA}")` };
  return { ok: true, record: record as EvalRunRecord };
}

/** Writes the run under outDir without overwriting an earlier one. Returns the file. */
function saveRun(outDir: string, record: object, startedAt: string, commit: string | null): string {
  mkdirSync(outDir, { recursive: true });
  const name = `${startedAt.replace(/[:.]/g, '-')}-${commit === null ? 'nocommit' : commit.slice(0, 7)}`;
  const body = `${JSON.stringify(record, null, 2)}\n`;
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const file = path.join(outDir, `${name}${attempt === 1 ? '' : `-${attempt}`}.json`);
    try {
      writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('too many runs saved under the same name');
}

/** Cases in roster order (then file order), and the problems that stop a run. */
function selectCases(allCases: readonly EvalCase[], registry: AgentRegistry, args: EvalArgs): { cases: EvalCase[]; problems: string[] } {
  const problems = allCases
    .filter((evalCase) => registry.get(evalCase.agent) === undefined)
    .map((evalCase) => `${evalCase.id}: agent "${evalCase.agent}" is not an active agent`);
  for (const agent of args.agents) {
    if (!allCases.some((evalCase) => evalCase.agent === agent)) problems.push(`no cases for agent "${agent}"`);
  }
  for (const id of args.cases) {
    if (!allCases.some((evalCase) => evalCase.id === id)) problems.push(`no case with id "${id}"`);
  }
  const rosterPosition = new Map(registry.agents.map((agent, position) => [agent.id, position]));
  const selected = allCases
    .filter((evalCase) => args.agents.length === 0 || args.agents.includes(evalCase.agent))
    .filter((evalCase) => args.cases.length === 0 || args.cases.includes(evalCase.id))
    .sort((a, b) => (rosterPosition.get(a.agent) ?? Infinity) - (rosterPosition.get(b.agent) ?? Infinity));
  if (problems.length === 0 && selected.length === 0) problems.push('no case matches both the --agent and the --case filters');
  return { cases: selected, problems };
}

function casesLine(cases: readonly EvalCase[], registry: AgentRegistry): string {
  const counts = registry.agents
    .map((agent) => ({ name: agent.name, count: cases.filter((evalCase) => evalCase.agent === agent.id).length }))
    .filter((entry) => entry.count > 0);
  return `Cases: ${cases.length} for ${plural(counts.length, 'agent')} (${counts.map((entry) => `${entry.name} ${entry.count}`).join(', ')})`;
}

/** Runs the evaluation and returns the exit code. */
export async function runEvalCli(options: EvalCliOptions): Promise<number> {
  const redact = redactor(options.env);
  const print = (line: string) => options.print(redact(line));
  const printProblems = (heading: string, problems: readonly string[]) => {
    print(`${heading}:`);
    for (const problem of problems) print(`- ${problem}`);
  };

  const parsed = parseEvalArgs(options.argv);
  if (!parsed.ok) {
    print(`error: ${parsed.message}`);
    print('Run with --help to see the options.');
    return 2;
  }
  const { args } = parsed;
  if (args.help) {
    for (const line of HELP) print(line);
    return 0;
  }

  let registry: AgentRegistry;
  try {
    registry = loadRegistry({ specsDir: options.specsDir, publicDir: options.publicDir });
  } catch (error) {
    printProblems('The agent specs cannot be used', registryProblems(error));
    return 2;
  }
  let allCases: EvalCase[];
  try {
    allCases = loadCases(options.casesDir);
  } catch (error) {
    if (error instanceof EvalCaseError) printProblems(plural(error.issues.length, 'problem') + ' in the eval cases', error.issues.map(formatIssue));
    else printProblems('The eval cases cannot be read', [error instanceof Error ? error.message : String(error)]);
    return 2;
  }
  const selection = selectCases(allCases, registry, args);
  if (selection.problems.length > 0) {
    printProblems(plural(selection.problems.length, 'problem') + ' with the cases or filters', selection.problems);
    return 2;
  }
  const { cases } = selection;
  print(casesLine(cases, registry));

  const agents = readLlmConfig('agents', options.env);
  const judge = readLlmConfig('judge', options.env);
  for (const warning of new Set([...agents.warnings, ...judge.warnings])) print(`warning: ${warning}`);
  const familyProblem = agents.ok && judge.ok ? judgeFamilyProblem(agents.config.model, judge.config.model) : null;

  if (args.check) {
    print(routeLine('agents', agents));
    print(routeLine('judge', judge));
    if (familyProblem !== null) {
      print(`problem: ${familyProblem}`);
      return 2;
    }
    print('Cases OK. No model was called.');
    return 0;
  }

  if (!agents.ok || !judge.ok) {
    const unusable = [agents, judge].flatMap((read, position) => (read.ok ? [] : [`${position === 0 ? 'agents' : 'judge'} route: ${read.error.message}`]));
    printProblems('The model settings are incomplete', unusable);
    return 2;
  }
  if (familyProblem !== null) {
    print(`error: ${familyProblem}`);
    return 2;
  }

  let baseline: EvalRunRecord | undefined;
  if (args.baseline !== null) {
    const read = readBaseline(path.resolve(options.appDir, args.baseline), args.baseline);
    if (!read.ok) {
      print(`error: ${read.message}`);
      return 2;
    }
    baseline = read.record;
  }

  print(routeLine('agents', agents));
  print(routeLine('judge', judge));
  print(`Running ${plural(cases.length, 'case')} x ${args.reps} repetition${args.reps === 1 ? '' : 's'}.`);

  let record: EvalRunRecord;
  try {
    record = await runEval(
      {
        cases,
        reps: args.reps,
        filters: { agents: args.agents.length > 0 ? args.agents : null, cases: args.cases.length > 0 ? args.cases : null },
      },
      {
        runAgent,
        getAgent: (id) => registry.get(id),
        agentsLlm: createLlmClient({ config: agents.config, fetch: options.fetch }),
        judgeLlm: createLlmClient({ config: judge.config, fetch: options.fetch }),
        git: options.git ?? (() => readGitState(options.appDir, options.specsDir)),
        clock: options.clock,
        print,
        log: options.log ?? redactingLog(options.env),
        nodeVersion: options.nodeVersion,
      },
    );
  } catch (error) {
    if (error instanceof EvalSetupError) {
      print(`error: ${error.message}`);
      return 2;
    }
    print(`ABORTED: ${error instanceof EvalAbortedError ? error.message : `unexpected ${describe(error)}`}`);
    print('Nothing was saved. Fix the cause and run again.');
    return 3;
  }

  const verdict = verdictOf(record);
  let saved: string;
  try {
    saved = saveRun(options.outDir, { ...record, verdict }, record.fingerprint.startedAt, record.fingerprint.commit);
  } catch (error) {
    print(`ABORTED: the finished run could not be saved (${describe(error)}). Nothing was saved.`);
    return 3;
  }

  print('');
  for (const line of formatReport(record, baseline === undefined ? undefined : compareRuns(baseline, record))) print(line);
  print('');
  print(`Saved: ${path.relative(options.appDir, saved).split(path.sep).join('/')}`);
  return verdict.verdict === 'PASS' ? 0 : 1;
}

async function main(): Promise<number> {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // As `next dev` does. Logs name files only, never their contents or folder.
  const { loadedEnvFiles } = loadEnvConfig(appDir, true, {
    info: () => {},
    error: () => console.error('could not read one of the env files'),
  });
  console.log(`node ${process.version}`);
  console.log(`env files: ${loadedEnvFiles.map((file) => file.path).join(', ') || 'none'}`);
  checkEnvFilePermissions({ appDir });
  const specsFromEnv = process.env.AGENT_SPECS_DIR;
  return runEvalCli({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    appDir,
    specsDir: path.resolve(appDir, specsFromEnv !== undefined && specsFromEnv.trim() !== '' ? specsFromEnv : path.join('..', '..', '04_agents')),
    publicDir: path.join(appDir, 'public'),
    casesDir: path.join(appDir, 'evals', 'cases'),
    outDir: path.join(appDir, '.eval-runs'),
    print: (line) => console.log(line),
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`eval crashed: ${error instanceof Error ? error.name : 'unknown error'}`);
      process.exit(3);
    },
  );
}
