import 'server-only';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { AgentId, AgentRegistry, AgentSpec, LoadRegistryOptions, PublicAgent, SpecIssue } from '@/shared/contracts';
import { AgentSpecError } from './errors';
import { parseAgentSpec } from './parse';
import { toPublicAgent } from './public';
import { avatarExistsUnder, checkRoster } from './validate';

/** From the app folder (the working directory of next dev, build, start and vitest). */
const DEFAULT_SPECS_DIR = join('..', '..', '04_agents');
const SKIPPED_FILE_NAMES: ReadonlySet<string> = new Set(['README.md']);

// The specs and avatars are read at runtime from folders chosen at runtime. The ignore
// comments keep Turbopack from tracing the whole project into the server output for them.

function resolveSpecsDir(options: LoadRegistryOptions): string {
  const fromEnv = process.env.AGENT_SPECS_DIR;
  const envDir = fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : undefined;
  return resolve(/* turbopackIgnore: true */ process.cwd(), options.specsDir ?? envDir ?? DEFAULT_SPECS_DIR);
}

function resolvePublicDir(options: LoadRegistryOptions): string {
  return resolve(/* turbopackIgnore: true */ process.cwd(), options.publicDir ?? 'public');
}

/** Spec files: `*.md`, except README.md and hidden files (editor locks and the like). Sorted. */
function listSpecFiles(specsDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(specsDir);
  } catch (error) {
    throw new Error(folderProblem(specsDir, error), { cause: error });
  }
  return names.filter((name) => name.endsWith('.md') && !name.startsWith('.') && !SKIPPED_FILE_NAMES.has(name)).sort();
}

function folderProblem(specsDir: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return `agent specs folder not found: ${specsDir}. Set AGENT_SPECS_DIR, or start the app from outputs/05_demo/app so that ../../04_agents resolves.`;
  }
  if (code === 'ENOTDIR') return `agent specs path is not a folder: ${specsDir}`;
  return `cannot read the agent specs folder ${specsDir}: ${code ?? String(error)}`;
}

type SpecFileResult = { ok: true; spec: AgentSpec } | { ok: false; issues: SpecIssue[] };

function readSpecFile(specsDir: string, fileName: string): SpecFileResult {
  let text: string;
  try {
    text = readFileSync(join(specsDir, fileName), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? String(error);
    return { ok: false, issues: [{ source: fileName, message: `cannot read the file (${code})` }] };
  }
  try {
    return { ok: true, spec: parseAgentSpec(text, fileName) };
  } catch (error) {
    if (error instanceof AgentSpecError) return { ok: false, issues: error.issues };
    throw error;
  }
}

/**
 * Reads every `<id>.md` in the specs folder (README.md and hidden files are skipped),
 * validates the roster and returns the active agents. Not cached: the helpers below
 * cache. Throws AgentSpecError listing every issue of every file, or an error naming the
 * folder when it cannot be read.
 *
 * Folder: options.specsDir, else env AGENT_SPECS_DIR, else ../../04_agents from
 * process.cwd(). Avatars: options.publicDir, else <process.cwd()>/public.
 */
export function loadRegistry(options: LoadRegistryOptions = {}): AgentRegistry {
  const specsDir = resolveSpecsDir(options);
  const publicDir = resolvePublicDir(options);
  const files = listSpecFiles(specsDir);
  if (files.length === 0) {
    // The issue is shown on the page: the folder's name only. Its full path stays in the server log.
    throw new AgentSpecError([{ source: basename(specsDir) || 'the agent specs folder', message: 'no agent spec files (<id>.md) in this folder' }], {
      logDetail: `specs folder: ${specsDir}`,
    });
  }

  const issues: SpecIssue[] = [];
  const specs: AgentSpec[] = [];
  const unparsedIds: string[] = [];
  for (const fileName of files) {
    const result = readSpecFile(specsDir, fileName);
    if (result.ok) {
      specs.push(result.spec);
    } else {
      issues.push(...result.issues);
      unparsedIds.push(fileName.slice(0, -'.md'.length));
    }
  }
  // Roster order: an issue between two agents is reported on the later one.
  specs.sort((a, b) => a.order - b.order);
  issues.push(...checkRoster(specs, { avatarExists: avatarExistsUnder(publicDir), unparsedIds }).issues);
  if (issues.length > 0) throw new AgentSpecError(issues);
  return buildRegistry(specsDir, specs);
}

function buildRegistry(specsDir: string, specs: readonly AgentSpec[]): AgentRegistry {
  // The registry leaves inactive agents out entirely: no lookup, no list, no handoff reaches them.
  const active = specs.filter((spec) => spec.active);
  const activeIds = new Set(active.map((spec) => spec.id));
  const agents = active.map((spec) => deepFreeze({ ...spec, handoffs: spec.handoffs.filter((id) => activeIds.has(id)) }));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const orchestrator = agents.find((agent) => agent.kind === 'orchestrator');
  if (orchestrator === undefined) {
    // checkRoster refuses a roster without exactly one active orchestrator.
    throw new Error('agent registry: validation passed, but there is no active orchestrator');
  }
  return Object.freeze({
    specsDir,
    agents: Object.freeze(agents),
    orchestrator,
    get: (id: AgentId) => byId.get(id),
  });
}

/** Freezes the parsed agents, so no caller can change the roster the whole process shares. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The process-wide registry used by the helpers below: default options, cached.
// ---------------------------------------------------------------------------

let cached: { key: string; registry: AgentRegistry } | undefined;

/** Changes whenever the folder, a spec file's mtime or size, or the list of spec files changes. */
function fingerprint(specsDir: string, publicDir: string): string {
  const parts = [specsDir, publicDir];
  for (const fileName of listSpecFiles(specsDir)) {
    try {
      const stats = statSync(join(specsDir, fileName));
      parts.push(`${fileName}\t${stats.mtimeMs}\t${stats.size}`);
    } catch {
      parts.push(`${fileName}\tunreadable`);
    }
  }
  return parts.join('\n');
}

/**
 * The single invalidation point: reloads when the fingerprint changes. A failed load is
 * thrown and not remembered, so the next call tries again (for example once a missing
 * avatar appears).
 */
function currentRegistry(): AgentRegistry {
  const specsDir = resolveSpecsDir({});
  const publicDir = resolvePublicDir({});
  const key = fingerprint(specsDir, publicDir);
  if (cached?.key !== key) cached = { key, registry: loadRegistry({ specsDir, publicDir }) };
  return cached.registry;
}

/** Undefined for unknown and inactive ids. */
export function getAgent(id: AgentId): AgentSpec | undefined {
  return currentRegistry().get(id);
}

/** Active agents by `order`. */
export function listAgents(): AgentSpec[] {
  return [...currentRegistry().agents];
}

/** Active agents by `order`, browser-safe. */
export function listPublicAgents(): PublicAgent[] {
  return currentRegistry().agents.map((agent) => toPublicAgent(agent));
}

/** The one agent with kind `orchestrator`. */
export function getOrchestrator(): AgentSpec {
  return currentRegistry().orchestrator;
}
