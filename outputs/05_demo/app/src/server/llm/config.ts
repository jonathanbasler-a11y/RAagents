import 'server-only';
import type { ChatLimits, LlmConfigResult, LlmRouteConfig, LlmRouteName } from '@/shared/contracts';

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Output token cap per reply when LLM_MAX_TOKENS is not set. */
export const DEFAULT_MAX_TOKENS = 1500;

const CALL_TIMEOUT_MS: ChatLimits['llmCallTimeoutMs'] = 120_000;

const PLACEHOLDER_WORDS = new Set([
  'changeme',
  'change-me',
  'change_me',
  'dummy',
  'none',
  'null',
  'undefined',
  'todo',
  'tbd',
  'placeholder',
  'replaceme',
  'replace-me',
  'replace_me',
  'n/a',
]);

/**
 * Whether a setting holds filler instead of a real value: empty, a filler word, a run of
 * x's, a template such as `<your-key>` or `https://<your-gateway>/v1`, an unexpanded
 * `${NAME}`, or a "your-..." hint. Placeholders count as missing.
 */
export function isPlaceholder(value: string): boolean {
  const text = value.trim().toLowerCase();
  return (
    text === '' ||
    PLACEHOLDER_WORDS.has(text) ||
    /^x+$/.test(text) ||
    /[<>]/.test(text) ||
    /\$\{[^}]*\}/.test(text) ||
    /^your[-_ ]/.test(text)
  );
}

interface Setting {
  /** The variable the value came from (or the last one tried, when nothing usable is set). */
  name: string;
  /** Trimmed value; null when unset or a placeholder. */
  value: string | null;
  /** When value is null: what each variable tried holds, e.g. "LLM_MODEL is not set". */
  unsetText: string;
}

/** The first of `names` that holds a usable value; otherwise the last name, with no value. */
function pick(env: EnvSource, ...names: string[]): Setting {
  const states: string[] = [];
  for (const name of names) {
    const raw = env[name];
    if (raw !== undefined && !isPlaceholder(raw)) return { name, value: raw.trim(), unsetText: '' };
    states.push(`${name} ${raw !== undefined && raw.trim() !== '' ? 'holds a placeholder' : 'is not set'}`);
  }
  return { name: names[names.length - 1], value: null, unsetText: states.join(' and ') };
}

interface RouteNames {
  baseUrl: string[];
  apiKey: string;
  apiKeyHeader: string[];
  model: string;
}

// The judge has its own model and key; its base URL and key header fall back to the
// agents route's values. Earlier names win.
const ROUTE_NAMES: Record<LlmRouteName, RouteNames> = {
  agents: { baseUrl: ['LLM_BASE_URL'], apiKey: 'LLM_API_KEY', apiKeyHeader: ['LLM_API_KEY_HEADER'], model: 'LLM_MODEL' },
  judge: {
    baseUrl: ['LLM_JUDGE_BASE_URL', 'LLM_BASE_URL'],
    apiKey: 'LLM_JUDGE_API_KEY',
    apiKeyHeader: ['LLM_JUDGE_API_KEY_HEADER', 'LLM_API_KEY_HEADER'],
    model: 'LLM_JUDGE_MODEL',
  },
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PRINTABLE_NO_SPACE = /^[\x21-\x7e]+$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface Problem {
  name: string;
  text: string;
}

function parseBaseUrl(value: string): { url: string; plainHttpRemote: boolean } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');
  return {
    url: `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`,
    plainHttpRemote: url.protocol === 'http:' && !local,
  };
}

function hasOtherProviderVariables(env: EnvSource): boolean {
  return Object.keys(env).some((name) => /^(ANTHROPIC|OPENAI)_/.test(name) && env[name] !== undefined);
}

/**
 * Reads one route's settings from env (LLM_* names only). Never throws. No default
 * endpoint; placeholder values count as missing; if ANTHROPIC_* or OPENAI_* variables are
 * set while LLM_* values are missing, the error says the app reads LLM_* only. Errors and
 * warnings name variables, never values or hosts.
 */
export function readLlmConfig(route: LlmRouteName, env: EnvSource = process.env): LlmConfigResult {
  const names = ROUTE_NAMES[route];
  const problems: Problem[] = [];
  const warnings: string[] = [];

  const base = pick(env, ...names.baseUrl);
  let baseUrl: string | null = null;
  if (base.value === null) {
    problems.push({ name: base.name, text: base.unsetText });
  } else {
    const parsed = parseBaseUrl(base.value);
    if (parsed === null) {
      problems.push({ name: base.name, text: `${base.name} is not a plain http(s) URL` });
    } else {
      baseUrl = parsed.url;
      if (parsed.plainHttpRemote) {
        warnings.push(`${base.name} uses plain http for a host that is not local, so the key travels unencrypted.`);
      }
    }
  }

  const key = pick(env, names.apiKey);
  if (key.value === null) {
    problems.push({ name: key.name, text: key.unsetText });
  } else if (!PRINTABLE_NO_SPACE.test(key.value)) {
    problems.push({
      name: key.name,
      text: `${key.name} contains spaces or characters a header cannot carry (set the key alone, without "Bearer")`,
    });
  }

  const model = pick(env, names.model);
  if (model.value === null) {
    problems.push({ name: model.name, text: model.unsetText });
  } else if (/\s/.test(model.value)) {
    problems.push({ name: model.name, text: `${model.name} contains spaces` });
  } else if (/(?:^|[^a-z])latest(?:$|[^a-z])/i.test(model.value)) {
    warnings.push(`${model.name} looks like a "latest" alias. Pin an exact model id.`);
  }

  const header = pick(env, ...names.apiKeyHeader);
  if (header.value !== null && !HEADER_NAME.test(header.value)) {
    problems.push({ name: header.name, text: `${header.name} is not a valid header name` });
  }
  const apiKeyHeader = header.value === null || header.value.toLowerCase() === 'authorization' ? null : header.value;

  let maxTokens = DEFAULT_MAX_TOKENS;
  const cap = pick(env, 'LLM_MAX_TOKENS');
  if (cap.value !== null) {
    const parsed = /^\d+$/.test(cap.value) ? Number(cap.value) : NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) maxTokens = parsed;
    else warnings.push(`LLM_MAX_TOKENS is not a positive whole number; using ${DEFAULT_MAX_TOKENS}.`);
  }

  if (problems.length > 0 || baseUrl === null || key.value === null || model.value === null) {
    const valueMissing = base.value === null || key.value === null || model.value === null;
    const note =
      valueMissing && hasOtherProviderVariables(env)
        ? ' ANTHROPIC_* or OPENAI_* variables are set, but this app reads only LLM_* names; they are ignored.'
        : '';
    return {
      ok: false,
      error: {
        kind: 'config',
        message:
          `The ${route} model route is not configured: ${problems.map((problem) => problem.text).join('; ')}. ` +
          `Set the LLM_* values in .env.local or the environment, then restart.${note}`,
        missing: problems.map((problem) => problem.name),
      },
      warnings,
    };
  }

  const config: LlmRouteConfig = {
    route,
    baseUrl,
    apiKey: key.value,
    apiKeyHeader,
    model: model.value,
    maxTokens,
    timeoutMs: CALL_TIMEOUT_MS,
  };
  return { ok: true, config, warnings };
}
