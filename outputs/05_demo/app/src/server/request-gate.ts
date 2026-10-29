// The request gate behind src/proxy.ts. It is a pure function of the request's headers and
// the environment, so tests need no server. It has two jobs:
//
// 1. DNS rebinding. A web page on attacker.example can point its own name at 127.0.0.1 and
//    then call this app from the visitor's browser. The browser still sends the attacker's
//    name in the Host header, so the app answers 421 unless the Host is one it expects:
//    localhost, 127.0.0.1 or [::1] on any port, or a name listed in ALLOWED_HOSTS.
// 2. Cross-site writes. A state-changing request with an Origin header must come from the
//    same host it is sent to. (The API routes also require Sec-Fetch-Site: same-origin.)
//
// No import of server-only or Next: the module has to load in any runtime.

import { readAccessSetting } from './access-gate';

/**
 * The process environment, or a stand-in. Two names are read:
 * - HOST: the address the server binds to (the npm scripts pass it as -H); unset means 127.0.0.1.
 * - ALLOWED_HOSTS: comma-separated host names, exact or "*.suffix", served in addition to loopback.
 */
export type GateEnv = Readonly<Record<string, string | undefined>>;

export interface GateInput {
  method: string;
  /** The raw Host header, or null when absent. */
  host: string | null;
  /** The raw Origin header, or null when absent. */
  origin: string | null;
  /** The raw X-Forwarded-Host header; only read when the server is bound beyond loopback. */
  forwardedHost?: string | null;
}

export type GateDecision = { allow: true } | { allow: false; status: 421 | 403; message: string };

export interface HostParts {
  /** Lower-case; an IPv6 literal keeps its brackets. */
  hostname: string;
  port: number | null;
}

export interface AllowedHosts {
  exact: string[];
  /** Suffixes of "*.suffix" entries, without the "*.". */
  suffixes: string[];
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const LABEL = '[a-z0-9-]+';
const HOSTNAME = `(?:\\[[0-9a-f:.]+\\]|${LABEL}(?:\\.${LABEL})*)`;
const HOST_HEADER = new RegExp(`^(${HOSTNAME})(?::(\\d{1,5}))?$`, 'i');
const SUFFIX_ENTRY = new RegExp(`^\\*\\.(${LABEL}(?:\\.${LABEL})*)$`, 'i');

/**
 * Splits a Host header into host name and port. Strict on purpose: anything with user info,
 * a path, spaces, a list or a bad port is not a Host header and returns null.
 */
export function parseHostHeader(value: string): HostParts | null {
  const match = HOST_HEADER.exec(value.trim());
  if (match === null) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && port > 65535) return null;
  return { hostname: match[1].toLowerCase(), port };
}

/** True when HOST keeps the server on this machine. Unset counts: the npm scripts default to 127.0.0.1. */
export function isLoopbackBind(host: string | undefined): boolean {
  const value = (host ?? '').trim().toLowerCase();
  return (
    value === '' ||
    value === 'localhost' ||
    value === '::1' ||
    value === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(value)
  );
}

/** Reads ALLOWED_HOSTS. Empty and malformed entries are dropped; a port on an exact entry is ignored. */
export function parseAllowedHosts(value: string | undefined): AllowedHosts {
  const allowed: AllowedHosts = { exact: [], suffixes: [] };
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const suffix = SUFFIX_ENTRY.exec(entry);
    if (suffix !== null) {
      allowed.suffixes.push(suffix[1].toLowerCase());
      continue;
    }
    const parts = parseHostHeader(entry);
    if (parts !== null) allowed.exact.push(parts.hostname);
  }
  return allowed;
}

export function matchesAllowedHost(hostname: string, allowed: AllowedHosts): boolean {
  return allowed.exact.includes(hostname) || allowed.suffixes.some((suffix) => hostname.endsWith(`.${suffix}`));
}

function hostAllowed(hostname: string, allowed: AllowedHosts): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname) || matchesAllowedHost(hostname, allowed);
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

/** Whether the Origin's host and port equal the given Host header value, default ports counted as no port. */
function originMatchesHost(origin: string, host: string | null | undefined): boolean {
  if (host === null || host === undefined) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const parts = parseHostHeader(host);
  if (parts === null) return false;
  const originPort = url.port === '' ? defaultPort(url.protocol) : Number(url.port);
  return url.hostname.toLowerCase() === parts.hostname && originPort === (parts.port ?? defaultPort(url.protocol));
}

const MISDIRECTED = 'Misdirected Request: this host name is not served here.';
const CROSS_SITE = 'Forbidden: the Origin of this request does not match the host it was sent to.';

export function decideRequest(input: GateInput, env: GateEnv): GateDecision {
  const exposed = !isLoopbackBind(env.HOST);
  const allowed = parseAllowedHosts(env.ALLOWED_HOSTS);
  const restricted = !exposed || allowed.exact.length > 0 || allowed.suffixes.length > 0;

  // Bound beyond loopback with no ALLOWED_HOSTS: the served host name is unknown, so the
  // Host check would only break the service. The port must then stay private.
  if (restricted) {
    const parts = input.host === null ? null : parseHostHeader(input.host);
    if (parts === null || !hostAllowed(parts.hostname, allowed)) {
      return { allow: false, status: 421, message: MISDIRECTED };
    }
  }

  if (UNSAFE_METHODS.has(input.method.toUpperCase()) && input.origin !== null) {
    const forwarded = exposed ? (input.forwardedHost ?? '').split(',')[0].trim() : '';
    const sameHost =
      originMatchesHost(input.origin, input.host) || (forwarded !== '' && originMatchesHost(input.origin, forwarded));
    if (!sameHost) return { allow: false, status: 403, message: CROSS_SITE };
  }

  return { allow: true };
}

/** One startup line when the server listens beyond this machine; null for a loopback bind. Names no host. */
export function exposureWarning(env: GateEnv): string | null {
  if (isLoopbackBind(env.HOST)) return null;
  const allowed = parseAllowedHosts(env.ALLOWED_HOSTS);
  const hostCheck =
    allowed.exact.length > 0 || allowed.suffixes.length > 0
      ? 'Requests are limited to loopback and the ALLOWED_HOSTS names.'
      : 'The Host header is not checked (set ALLOWED_HOSTS to restrict it).';
  const access = readAccessSetting(env);
  const login =
    access.state === 'on'
      ? 'Sign-in is required: every request needs the shared access password (RAAGENTS_ACCESS_PASSWORD). '
      : access.state === 'misconfigured'
        ? `Nobody can sign in: ${access.reason} `
        : 'The app has no login: keep the port private (reachable only by you). ';
  return 'HOST is set beyond loopback, so this server accepts connections from other machines. ' + login + hostCheck;
}
