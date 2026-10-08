// Live check of the model connection, through the app's own config and client.
//
// Run from the app folder: npm run smoke   (tsx --conditions=react-server scripts/smoke.ts)
//
// Loads env files the way `next dev` does (@next/env), then makes a plain and a streaming
// call on the agents route and a plain call on the judge route. Prints, per call: route,
// status, resolved model, model family, finish reason and latency. Never prints the key or
// the endpoint host, so the output is safe to paste. Checks that the judge is a different
// model family from the agents.
//
// Exit codes: 0 every configured route answered, 1 a configured route failed (or the judge
// shares the agents' family), 2 nothing configured.
import { loadEnvConfig } from '@next/env';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LlmResult, LlmRouteConfig, LlmRouteName } from '../src/shared/contracts';
import { LlmError, checkEnvFilePermissions, createLlmClient, modelFamily, readLlmConfig } from '../src/server/llm/index';

const PROMPT = 'Reply with the single word OK.';

export interface SmokeOptions {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  /** One line of output. */
  print: (line: string) => void;
  /** Clock for latency, in ms. Default: performance.now. */
  now?: () => number;
}

interface CallReport {
  ok: boolean;
  line: string;
  /** The model the gateway reported, when the call answered. */
  model?: string;
}

/** A fetch that remembers the status of the last response it saw. */
function statusRecorder(fetchFn: typeof fetch) {
  let last: number | undefined;
  const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchFn(input, init);
    last = response.status;
    return response;
  }) as typeof fetch;
  return { fetch: recording, status: () => last };
}

const label = (route: LlmRouteName, kind: 'plain' | 'stream') => `${route.padEnd(6)} ${kind.padEnd(6)}`;

function answered(head: string, status: number | undefined, result: LlmResult, timing: string): CallReport {
  const facts = `HTTP ${status ?? '?'}  model=${result.model}  family=${modelFamily(result.model)}  finish=${result.finishReason ?? '(none)'}  ${timing}`;
  if (result.partial) {
    return { ok: false, line: `${head} FAIL partial answer (${result.errorKind ?? 'unknown'}): ${facts}`, model: result.model };
  }
  if (result.truncated) {
    return { ok: false, line: `${head} FAIL cut off at the output cap (raise LLM_MAX_TOKENS): ${facts}`, model: result.model };
  }
  return { ok: true, line: `${head} OK   ${facts}`, model: result.model };
}

function failed(head: string, error: unknown, status: number | undefined, ms: number): CallReport {
  if (!(error instanceof LlmError)) {
    return { ok: false, line: `${head} FAIL unexpected ${error instanceof Error ? error.name : 'error'} after ${ms} ms` };
  }
  const http = error.status ?? status;
  const inconclusive = error.kind === 'timeout' || error.kind === 'rate_limit' ? ' (inconclusive: run again later)' : '';
  return {
    ok: false,
    line:
      `${head} FAIL ${error.kind}${http === undefined ? '' : `, HTTP ${http}`}, after ${ms} ms ` +
      `(correlation ${error.correlationId}): ${error.message}${inconclusive}`,
  };
}

async function plainCall(config: LlmRouteConfig, options: SmokeOptions, now: () => number): Promise<CallReport> {
  const head = label(config.route, 'plain');
  const recorder = statusRecorder(options.fetch);
  const client = createLlmClient({ config, fetch: recorder.fetch });
  const started = now();
  try {
    const result = await client.complete({ messages: [{ role: 'user', content: PROMPT }] });
    return answered(head, recorder.status(), result, `${Math.round(now() - started)} ms`);
  } catch (error) {
    return failed(head, error, recorder.status(), Math.round(now() - started));
  }
}

async function streamCall(config: LlmRouteConfig, options: SmokeOptions, now: () => number): Promise<CallReport> {
  const head = label(config.route, 'stream');
  const recorder = statusRecorder(options.fetch);
  const client = createLlmClient({ config, fetch: recorder.fetch });
  const started = now();
  let firstText: number | undefined;
  try {
    for await (const event of client.stream({ messages: [{ role: 'user', content: PROMPT }] })) {
      if (event.type === 'delta') {
        firstText ??= Math.round(now() - started);
        continue;
      }
      const total = Math.round(now() - started);
      return answered(head, recorder.status(), event.result, `first text ${firstText ?? '-'} ms, total ${total} ms`);
    }
    return { ok: false, line: `${head} FAIL the stream ended without a result` };
  } catch (error) {
    return failed(head, error, recorder.status(), Math.round(now() - started));
  }
}

/** Runs the live checks and returns the exit code. */
export async function runSmoke(options: SmokeOptions): Promise<0 | 1 | 2> {
  const { env, print } = options;
  const now = options.now ?? (() => performance.now());
  const warnings = new Set<string>();
  const models: Partial<Record<LlmRouteName, string>> = {};
  let configured = 0;
  let failures = 0;

  for (const route of ['agents', 'judge'] as const) {
    const read = readLlmConfig(route, env);
    for (const warning of read.warnings) {
      if (!warnings.has(warning)) print(`warning: ${warning}`);
      warnings.add(warning);
    }
    if (!read.ok) {
      print(`${route.padEnd(6)} not configured: ${read.error.message}`);
      continue;
    }
    configured += 1;
    const calls = route === 'agents' ? [plainCall, streamCall] : [plainCall];
    for (const call of calls) {
      const report = await call(read.config, options, now);
      print(report.line);
      if (!report.ok) failures += 1;
      if (report.model !== undefined) models[route] ??= report.model;
    }
  }

  if (models.agents !== undefined && models.judge !== undefined) {
    const agents = modelFamily(models.agents);
    const judge = modelFamily(models.judge);
    if (agents === 'unknown' || judge === 'unknown') {
      print('check: could not tell a model family; confirm by hand that the judge is a different family from the agents.');
    } else if (agents === judge) {
      print(`FAIL: the judge (${judge}) is the same family as the agents (${agents}); it must be a different family.`);
      failures += 1;
    } else {
      print(`ok: the judge family (${judge}) differs from the agents' family (${agents}).`);
    }
  }

  if (configured === 0) {
    print('Nothing configured. Set your own LLM_* values in .env.local (see env.example) and run again.');
    return 2;
  }
  return failures > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const fromShell = Object.keys(process.env)
    .filter((name) => name.startsWith('LLM_'))
    .sort();
  // As `next dev` does. Logs name files only, never their contents or folder.
  const { loadedEnvFiles } = loadEnvConfig(appDir, true, {
    info: () => {},
    error: () => console.error('could not read one of the env files'),
  });
  console.log(`node ${process.version}`);
  console.log(`env files: ${loadedEnvFiles.map((file) => file.path).join(', ') || 'none'}`);
  if (fromShell.length > 0) {
    console.log(`note: set in the shell, so env files do not override them: ${fromShell.join(', ')}`);
  }
  checkEnvFilePermissions({ appDir });
  return runSmoke({ env: process.env, fetch: globalThis.fetch, print: (line) => console.log(line) });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`smoke crashed: ${error instanceof Error ? error.name : 'unknown error'}`);
      process.exit(1);
    },
  );
}
