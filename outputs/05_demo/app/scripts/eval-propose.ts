// The findings-proposal evaluation (BUILD-LEARNINGS Part 9).
//
// Run from the app folder: npm run eval:propose -- [options]   (tsx --conditions=react-server scripts/eval-propose.ts)
//
// For each case on a case pack that has one question from the person, the agent answers, then is asked to "propose
// findings from your last answer" exactly as the app's button asks it. Code (the app's own checkProposal) decides which
// claims are drafts, and the report counts them: how many proposed quotes pass, why the rest are refused, and how many
// planted problems end up with a draft on every document where they are planted. There is no judge model: nothing here
// reads whether a claim is true. Counts only are printed; the saved run (git-ignored) holds the drafts.
//
// Exit codes: 0 a valid run · 1 a complete run that is not a valid measurement (fewer than 3 repetitions, or a dirty or
// unknown checkout), saved · 2 a setup problem, nothing was run · 3 the run aborted, nothing was saved.
import { loadEnvConfig } from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AgentSpecError, loadRegistry } from '@/server/agents';
import { runAgent } from '@/server/chat/run-agent';
import { checkEnvFilePermissions, createLlmClient, readLlmConfig } from '@/server/llm';
import type { AgentRegistry } from '@/shared/contracts';
import { SHARED_RULES_HOSTED } from '@/server/prompts';
import { EvalCaseError, formatIssue, loadCases, type EvalCase } from '../evals/lib/cases';
import { bindPacks, EvalPackError, loadPacks, type CasePack } from '../evals/lib/packs';
import { PROPOSE_REPETITIONS, formatProposeReport, proposalCases, runProposeEval, type ProposeRunRecord } from '../evals/lib/propose';
import { EvalAbortedError, EvalSetupError, type GitState } from '../evals/lib/run';
import { hostedWordingCheck, parseEvalArgs, readGitState, redactingLog } from './eval';

export interface ProposeCliOptions {
  /** The options after `npm run eval:propose --`. */
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  appDir: string;
  specsDir: string;
  publicDir: string;
  casesDir: string;
  packsDir: string;
  /** Where runs are saved (.eval-runs). */
  outDir: string;
  git?: () => GitState;
  print: (line: string) => void;
  clock?: () => Date;
  nodeVersion?: string;
  log?: Pick<Console, 'error' | 'warn'>;
  /** Whether the prompts carry the hosted wording; default: what the prompt module fixed when it loaded. */
  hostedPrompts?: boolean;
}

const HELP = [
  'Usage: npm run eval:propose -- [options]',
  '',
  'Asks each agent that has a pack case to answer, then to propose findings from its answer, and counts what the code checks accept.',
  '',
  'Options:',
  '  --agent <id[,id]>   only the cases of these agents (repeat to add more)',
  '  --case <id[,id]>    only these cases (repeat to add more)',
  `  --reps <1-10>       repetitions per case (default ${PROPOSE_REPETITIONS}; fewer makes the run a trial, not a measurement)`,
  '  --check             list the cases it would run and the model setting; no model is called',
  '  --hosted-wording    measure the hosted copy\'s wording (needs RAAGENTS_HOSTED_NOTICE in the shell); without it, such prompts are refused',
  '  --help              show this text',
  '',
  'Exit codes: 0 valid run · 1 complete but not a valid measurement (saved) · 2 setup problem, nothing run · 3 aborted, nothing saved.',
  'Runs are saved under .eval-runs/ (git-ignored).',
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function saveRun(outDir: string, record: ProposeRunRecord): string {
  mkdirSync(outDir, { recursive: true });
  const { startedAt, commit } = record.fingerprint;
  const name = `propose-${startedAt.replace(/[:.]/g, '-')}-${commit === null ? 'nocommit' : commit.slice(0, 7)}`;
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

/** Why the run is not a valid measurement, or null. */
export function trialReason(record: ProposeRunRecord): string | null {
  const { reps, commit, dirty } = record.fingerprint;
  if (reps < PROPOSE_REPETITIONS) return `${reps} repetition${reps === 1 ? '' : 's'}, fewer than ${PROPOSE_REPETITIONS}`;
  if (commit === null || dirty === null) return 'the checkout could not be read, so the run cannot be tied to a commit';
  if (dirty) return 'the app or the agent specs have uncommitted changes, so the run cannot be tied to a commit';
  return null;
}

/** Runs the proposal evaluation and returns the exit code. */
export async function runProposeCli(options: ProposeCliOptions): Promise<number> {
  const print = options.print;
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
  if (args.baseline !== null) {
    print('error: --baseline is not supported here yet; compare two saved runs by reading their reports side by side');
    return 2;
  }
  const hosted = hostedWordingCheck({
    asked: args.hostedWording,
    hostedPrompts: options.hostedPrompts ?? SHARED_RULES_HOSTED,
    noticeNow: (options.env.RAAGENTS_HOSTED_NOTICE ?? '').trim() !== '',
  });
  if (!hosted.ok) {
    print(`error: ${hosted.message}`);
    return 2;
  }
  for (const line of hosted.lines) print(line);

  let registry: AgentRegistry;
  try {
    registry = loadRegistry({ specsDir: options.specsDir, publicDir: options.publicDir });
  } catch (error) {
    print('The agent specs cannot be used:');
    for (const issue of error instanceof AgentSpecError ? error.issues.map((entry) => `${entry.source}: ${entry.message}`) : [describe(error)]) print(`- ${issue}`);
    return 2;
  }
  let allCases: EvalCase[];
  let packs: ReadonlyMap<string, CasePack>;
  try {
    allCases = loadCases(options.casesDir);
    packs = loadPacks(options.packsDir);
    bindPacks(allCases, packs);
  } catch (error) {
    if (error instanceof EvalCaseError) print(`${plural(error.issues.length, 'problem')} in the eval cases:\n${error.issues.map(formatIssue).join('\n')}`);
    else if (error instanceof EvalPackError) print(`${plural(error.issues.length, 'problem')} in the eval packs:\n${error.issues.join('\n')}`);
    else print(`The cases or packs cannot be read: ${describe(error)}`);
    return 2;
  }

  const eligible = proposalCases(allCases, packs);
  const problems: string[] = [];
  for (const agent of args.agents) if (!eligible.some((evalCase) => evalCase.agent === agent)) problems.push(`no proposal case for agent "${agent}"`);
  for (const id of args.cases) if (!eligible.some((evalCase) => evalCase.id === id)) problems.push(`no proposal case with id "${id}"`);
  const rosterPosition = new Map(registry.agents.map((agent, position) => [agent.id, position]));
  const cases = eligible
    .filter((evalCase) => registry.get(evalCase.agent) !== undefined)
    .filter((evalCase) => args.agents.length === 0 || args.agents.includes(evalCase.agent))
    .filter((evalCase) => args.cases.length === 0 || args.cases.includes(evalCase.id))
    .sort((a, b) => (rosterPosition.get(a.agent) ?? Infinity) - (rosterPosition.get(b.agent) ?? Infinity));
  if (problems.length === 0 && cases.length === 0) problems.push('no case matches both the --agent and the --case filters');
  if (problems.length > 0) {
    print(`${plural(problems.length, 'problem')} with the cases or filters:`);
    for (const problem of problems) print(`- ${problem}`);
    return 2;
  }
  print(`Proposal cases: ${cases.length} (${cases.map((evalCase) => evalCase.id).join(', ')})`);

  const agents = readLlmConfig('agents', options.env);
  for (const warning of agents.warnings) print(`warning: ${warning}`);
  if (!agents.ok) {
    print(`error: the agents route is not configured: ${agents.error.message}`);
    return 2;
  }
  print(`agents route: model ${agents.config.model}`);
  if (args.check) {
    print('Cases OK. No model was called.');
    return 0;
  }

  print(`Running ${plural(cases.length, 'case')} x ${args.reps} repetition${args.reps === 1 ? '' : 's'} (two model calls each).`);
  let record: ProposeRunRecord;
  try {
    record = await runProposeEval(
      { cases, packs, reps: args.reps, filters: { agents: args.agents.length > 0 ? args.agents : null, cases: args.cases.length > 0 ? args.cases : null } },
      {
        runAgent,
        getAgent: (id) => registry.get(id),
        agentsLlm: createLlmClient({ config: agents.config, fetch: options.fetch }),
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

  let saved: string;
  try {
    saved = saveRun(options.outDir, record);
  } catch (error) {
    print(`ABORTED: the finished run could not be saved (${describe(error)}). Nothing was saved.`);
    return 3;
  }
  print('');
  for (const line of formatProposeReport(record)) print(line);
  const trial = trialReason(record);
  print(trial === null ? 'Verdict: a valid run.' : `Verdict: a TRIAL, not a measurement: ${trial}.`);
  print(`Saved: ${path.relative(options.appDir, saved).split(path.sep).join('/')}`);
  return trial === null ? 0 : 1;
}

async function main(): Promise<number> {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { loadedEnvFiles } = loadEnvConfig(appDir, true, {
    info: () => {},
    error: () => console.error('could not read one of the env files'),
  });
  console.log(`node ${process.version}`);
  console.log(`env files: ${loadedEnvFiles.map((file) => file.path).join(', ') || 'none'}`);
  checkEnvFilePermissions({ appDir });
  const specsFromEnv = process.env.AGENT_SPECS_DIR;
  return runProposeCli({
    argv: process.argv.slice(2),
    env: process.env,
    fetch: globalThis.fetch,
    appDir,
    specsDir: path.resolve(appDir, specsFromEnv !== undefined && specsFromEnv.trim() !== '' ? specsFromEnv : path.join('..', '..', '04_agents')),
    publicDir: path.join(appDir, 'public'),
    casesDir: path.join(appDir, 'evals', 'cases'),
    packsDir: path.join(appDir, 'evals', 'packs'),
    outDir: path.join(appDir, '.eval-runs'),
    print: (line) => console.log(line),
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`eval:propose crashed: ${error instanceof Error ? error.name : 'unknown error'}`);
      process.exit(3);
    },
  );
}
