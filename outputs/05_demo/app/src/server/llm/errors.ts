import 'server-only';
import { randomUUID } from 'node:crypto';
import type { LlmErrorInfo, LlmErrorKind } from '@/shared/contracts';

/**
 * Thrown by an LlmClient when a call produced no text. Its message never holds a key, a
 * host or the provider's body; those details go to the server log, under correlationId.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly permanent: boolean;
  /** Ties this error to the server log lines that hold the redacted details. */
  readonly correlationId: string;

  constructor(info: LlmErrorInfo, options?: { cause?: unknown; correlationId?: string }) {
    super(info.message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LlmError';
    this.kind = info.kind;
    this.status = info.status;
    this.retryAfterMs = info.retryAfterMs;
    this.permanent = info.permanent;
    this.correlationId = options?.correlationId ?? randomUUID();
  }
}

/** Why one attempt failed, and what the client may do about it. */
export interface Failure {
  kind: LlmErrorKind;
  status?: number;
  retryAfterMs?: number;
  /** May be tried again within the same call: timeouts, 429, 5xx and connection resets. */
  retryable: boolean;
  /** Remembered for the process: auth and model refusals. */
  permanent: boolean;
  /** Short and safe: no key, no host, no provider text. */
  reason: string;
  /** Redacted provider detail, for the server log only. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export interface RedactionTargets {
  apiKey: string;
  baseUrl: string;
}

const MAX_SCANNED_CHARS = 64 * 1024;
const EXCERPT_CHARS = 300;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every pattern below is linear: bounded or single quantifiers only (no backtracking blow-up).
const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,15}:(?:\\?\/){2}(?:[^\s"'<>\\]|\\\/)+/gi;
const BEARER_PATTERN = /\b(bearer)\s+[^\s"',;]+/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_CANDIDATE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;

function looksLikeIpv6(candidate: string): boolean {
  // Keeps clock times such as 12:30:05 (two colons, digits only).
  return candidate.includes('::') || /[a-f]/i.test(candidate) || candidate.split(':').length > 3;
}

/**
 * Removes the key, the endpoint host, URLs, bearer tokens and IP addresses from text bound
 * for the server log, and collapses whitespace.
 */
export function redact(text: string, targets: RedactionTargets): string {
  let out = text;
  if (out.length > MAX_SCANNED_CHARS) {
    // Drop a key-length tail too, so a key cut in half at the boundary cannot survive.
    out = out.slice(0, Math.max(0, MAX_SCANNED_CHARS - targets.apiKey.length));
  }
  if (targets.apiKey !== '') {
    out = out.split(targets.apiKey).join('<key>');
    const encoded = encodeURIComponent(targets.apiKey);
    if (encoded !== targets.apiKey) out = out.split(encoded).join('<key>');
  }
  out = out.replace(URL_PATTERN, '<url>');
  let hosts: string[] = [];
  try {
    const url = new URL(targets.baseUrl);
    hosts = [url.host, url.hostname].filter((host) => host !== '');
  } catch {
    // not a URL: nothing host-shaped to remove
  }
  for (const host of hosts) out = out.replace(new RegExp(escapeRegExp(host), 'gi'), '<host>');
  out = out.replace(BEARER_PATTERN, '$1 <redacted>');
  out = out.replace(IPV4_PATTERN, '<ip>');
  out = out.replace(IPV6_CANDIDATE, (candidate) => (looksLikeIpv6(candidate) ? '<ip>' : candidate));
  return out.replace(/\s+/g, ' ').trim();
}

/** A redacted excerpt of a provider body for the server log (at most about 300 characters). */
export function excerpt(text: string, targets: RedactionTargets): string {
  const clean = redact(text, targets);
  return clean.length > EXCERPT_CHARS ? `${clean.slice(0, EXCERPT_CHARS)}…` : clean;
}

// ---------------------------------------------------------------------------
// HTTP status
// ---------------------------------------------------------------------------

const MODEL_REFUSED_PATTERNS = [
  /model_not_found|deploymentnotfound|unknown_model|invalid_model/i,
  /\bmodels?\b[\s\S]{0,120}?\b(?:not allowed|not found|does not exist|not available|unavailable|not entitled|not permitted|no access)\b/i,
  /\b(?:unknown|invalid|unsupported|unrecognized)\s+model\b/i,
];

/** Whether an error body says the model itself is refused (not entitled, unknown or missing). */
export function saysModelRefused(body: string): boolean {
  const head = body.slice(0, 4096);
  return MODEL_REFUSED_PATTERNS.some((pattern) => pattern.test(head));
}

/** Classifies a non-2xx response. `body` is the raw response text (used, never kept). */
export function failureForStatus(status: number, body: string): Failure {
  const http = `HTTP ${status}`;
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, retryable: false, permanent: true, reason: `the model endpoint refused the key (${http})` };
  }
  if (status === 408) {
    return { kind: 'timeout', status, retryable: true, permanent: false, reason: `the model endpoint timed out (${http})` };
  }
  if (status === 429) {
    return { kind: 'rate_limit', status, retryable: true, permanent: false, reason: `the model endpoint is rate limiting (${http})` };
  }
  if (status >= 500) {
    return { kind: 'outage', status, retryable: true, permanent: false, reason: `the model endpoint failed (${http})` };
  }
  if ((status === 400 || status === 404 || status === 412) && saysModelRefused(body)) {
    return { kind: 'model', status, retryable: false, permanent: true, reason: `the model endpoint does not allow this model (${http})` };
  }
  if (status >= 300 && status < 400) {
    return {
      kind: 'request',
      status,
      retryable: false,
      permanent: false,
      reason: `the model endpoint answered with a redirect (${http}); check LLM_BASE_URL`,
    };
  }
  return { kind: 'request', status, retryable: false, permanent: false, reason: `the model endpoint rejected the request (${http})` };
}

/** Milliseconds a response asks the client to wait (retry-after-ms, or Retry-After in seconds or as a date). */
export function retryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const ms = headers.get('retry-after-ms')?.trim();
  if (ms && /^\d+(?:\.\d+)?$/.test(ms)) return Math.ceil(Number(ms));
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

// ---------------------------------------------------------------------------
// Thrown errors (fetch rejections and broken bodies)
// ---------------------------------------------------------------------------

interface ErrorFacts {
  codes: string[];
  names: string[];
  messages: string[];
  /** "Name CODE: message" per error in the chain, unredacted. */
  chain: string[];
}

// fetch wraps the real network error ("TypeError: fetch failed" with a cause), and a
// dual-stack connect reports an AggregateError with one member per address tried.
function factsOf(error: unknown): ErrorFacts {
  const facts: ErrorFacts = { codes: [], names: [], messages: [], chain: [] };
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (value === null || typeof value !== 'object' || depth > 8 || seen.has(value)) return;
    seen.add(value);
    const record = value as { code?: unknown; name?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
    const code = typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message : '';
    if (code) facts.codes.push(code);
    if (name) facts.names.push(name);
    if (message) facts.messages.push(message);
    facts.chain.push(`${name || 'Error'}${code ? ` ${code}` : ''}: ${message}`);
    if (Array.isArray(record.errors)) for (const member of record.errors) visit(member, depth + 1);
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  return facts;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA']);
const TLS_CODE = /^(?:CERT_|ERR_TLS_|ERR_SSL_|ERR_OSSL_|UNABLE_TO_|SELF_SIGNED_|DEPTH_ZERO_|HOSTNAME_MISMATCH)/;
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN']);

/**
 * Classifies a thrown fetch or body-read error through its whole cause chain. Order is
 * policy: a blocked port, DNS and TLS are permanent connection problems and are never
 * retried, even when another address timed out.
 */
export function failureForThrown(error: unknown, targets: RedactionTargets): Failure {
  const facts = factsOf(error);
  const detail = excerpt(facts.chain.join(' <- '), targets);
  const has = (set: Set<string>) => facts.codes.some((code) => set.has(code));
  const base = { permanent: false, detail };

  if (facts.messages.some((message) => /bad port/i.test(message))) {
    return { ...base, kind: 'config', retryable: false, reason: 'fetch refuses the port in LLM_BASE_URL; use another port' };
  }
  if (has(DNS_CODES)) {
    return { ...base, kind: 'dns', retryable: false, reason: 'the model endpoint host name did not resolve (check the VPN or LLM_BASE_URL)' };
  }
  if (facts.codes.some((code) => TLS_CODE.test(code))) {
    return { ...base, kind: 'tls', retryable: false, reason: 'the TLS connection to the model endpoint failed' };
  }
  if (has(TIMEOUT_CODES) || facts.names.includes('TimeoutError')) {
    return { ...base, kind: 'timeout', retryable: true, reason: 'the connection to the model endpoint timed out' };
  }
  if (
    has(RESET_CODES) ||
    facts.messages.some((message) => /socket hang up|other side closed|^terminated$/i.test(message))
  ) {
    return { ...base, kind: 'network', retryable: true, reason: 'the connection to the model endpoint was reset' };
  }
  if (facts.names.includes('AbortError')) {
    return { ...base, kind: 'timeout', retryable: true, reason: 'the request to the model endpoint was aborted' };
  }
  if (has(UNREACHABLE_CODES)) {
    return { ...base, kind: 'network', retryable: false, reason: 'could not connect to the model endpoint (refused or unreachable)' };
  }
  return { ...base, kind: 'network', retryable: false, reason: 'the request to the model endpoint failed' };
}
