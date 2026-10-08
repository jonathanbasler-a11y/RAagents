import 'server-only';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AGENT_SECTION_HEADINGS,
  type AgentSpec,
  type SpecIssue,
  type SpecValidationResult,
  type TeamRole,
  type ValidateSpecsOptions,
} from '@/shared/contracts';
import { avatarPathFor, fileOf, MIN_EXAMPLE_PROMPTS, SECTION_KEY_BY_HEADING } from './spec-format';

/** The `source` of issues about the roster as a whole. */
export const ROSTER_SOURCE = 'roster';

/** One word: letters (any script), hyphens or apostrophes, so that "@Name" can address it. */
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u;
const AVATAR_PATH_PATTERN = /^\/avatars\/[a-z][a-z0-9-]*\.svg$/;
/** Team roles that join a team turn by rule; an @mention only adds a note. */
const JOINS_BY_RULE: ReadonlySet<TeamRole> = new Set(['orchestrator', 'synthesiser']);
/** Team roles that join a team turn only when @mentioned. */
const JOINS_WHEN_MENTIONED: ReadonlySet<TeamRole> = new Set(['sanitiser', 'evidence-checker', 'red-team']);

export interface RosterCheckOptions {
  avatarExists: (avatarPath: string) => boolean;
  /** Ids of spec files that failed to parse. A handoff to one of them is not reported as unknown. */
  unparsedIds?: readonly string[];
}

/**
 * Checks a parsed roster against every rule in outputs/04_agents/README.md, "What the app
 * checks", that parsing one file cannot settle: unique ids, names and orders; the letter
 * rule; kind and team_role against group; exactly one active orchestrator; flag
 * consistency and team-role semantics; routing lists and distinct routing terms among
 * active routable agents; avatars; handoffs; non-empty sections and at least 3 example
 * prompts. Reports every issue, not just the first. Inactive agents must still be
 * well-formed, but their avatars, routing terms and orchestrator status are not checked.
 */
export function validateSpecs(specs: readonly AgentSpec[], options: ValidateSpecsOptions = {}): SpecValidationResult {
  return checkRoster(specs, { avatarExists: options.avatarExists ?? avatarExistsUnder(resolve(process.cwd(), 'public')) });
}

/** Whether `/avatars/<id>.svg` exists as a file under `publicDir`. Any other path counts as missing. */
export function avatarExistsUnder(publicDir: string): (avatarPath: string) => boolean {
  return (avatarPath) => {
    if (!AVATAR_PATH_PATTERN.test(avatarPath)) return false;
    try {
      return statSync(join(publicDir, avatarPath)).isFile();
    } catch {
      return false;
    }
  };
}

/** validateSpecs with the options the registry needs. */
export function checkRoster(specs: readonly AgentSpec[], options: RosterCheckOptions): SpecValidationResult {
  const issues: SpecIssue[] = [];
  const knownIds = new Set([...specs.map((spec) => spec.id), ...(options.unparsedIds ?? [])]);

  for (const spec of specs) {
    const report = (message: string) => {
      issues.push({ source: fileOf(spec), message });
    };
    checkNameAndLetter(spec, report);
    checkGroupKindAndTeamRole(spec, report);
    checkFlags(spec, report);
    checkRoutingLists(spec, report);
    checkAvatar(spec, report, options.avatarExists);
    checkHandoffs(spec, report, knownIds);
    checkSections(spec, report);
    if (spec.sourceAllowlist.length > 0) report('source_allowlist must be empty in this phase: no sources are connected yet');
  }

  const reportFor = (spec: AgentSpec, message: string) => {
    issues.push({ source: fileOf(spec), message });
  };
  checkUniqueIds(specs, reportFor);
  checkUnique(specs, (spec) => spec.name.toLowerCase(), (spec, first) => `name "${spec.name}" is also used by ${fileOf(first)}`, reportFor);
  checkUnique(specs, (spec) => String(spec.order), (spec, first) => `order ${spec.order} is also used by ${fileOf(first)}`, reportFor);
  checkOrchestrator(specs, options.unparsedIds?.length ?? 0, (message) => {
    issues.push({ source: ROSTER_SOURCE, message });
  });
  checkDistinctRoutingTerms(specs, reportFor);

  return { ok: issues.length === 0, issues };
}

type Report = (message: string) => void;

function initial(text: string): string {
  return (Array.from(text)[0] ?? '').toUpperCase();
}

function checkNameAndLetter(spec: AgentSpec, report: Report): void {
  if (!NAME_PATTERN.test(spec.name)) {
    report(`name "${spec.name}" must be one word (letters, hyphens or apostrophes), so that "@${spec.name}" works as a mention`);
  }
  const letter = spec.letter.toUpperCase();
  if (initial(spec.name) !== letter) report(`name "${spec.name}" must start with its letter "${spec.letter}"`);
  const words = `${spec.capability} ${spec.shortCapability ?? ''}`.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.some((word) => initial(word) === letter)) {
    const short = spec.shortCapability === undefined ? '' : ` or short_capability "${spec.shortCapability}"`;
    report(`letter "${spec.letter}" must be the initial of a word in capability "${spec.capability}"${short}`);
  }
}

function checkGroupKindAndTeamRole(spec: AgentSpec, report: Report): void {
  if (spec.group !== 'role') {
    if (spec.kind !== 'domain') report(`kind must be "domain" in group "${spec.group}"; got "${spec.kind}"`);
    if (spec.teamRole !== undefined) report(`team_role is only for group "role"; remove it from this "${spec.group}" agent`);
    return;
  }
  if (spec.teamRole === undefined) {
    report('team_role is required in group "role"');
    if (spec.kind === 'domain') report('kind "domain" is only for groups core, spec and other');
    return;
  }
  const expectedKind = spec.teamRole === 'orchestrator' ? 'orchestrator' : 'team-role';
  if (spec.kind !== expectedKind) report(`kind must be "${expectedKind}" for team_role "${spec.teamRole}"; got "${spec.kind}"`);
}

function checkFlags(spec: AgentSpec, report: Report): void {
  if (spec.locked && !spec.defaultSelected) report('locked: true needs default_selected: true');
  if (spec.mentionOnly && spec.routable) report('mention_only: true needs routable: false');
  if (spec.routable && spec.kind !== 'domain') {
    report(`only domain agents can be routable; this ${spec.kind} agent needs routable: false`);
  }
  if (spec.group !== 'role') return;
  if (!spec.locked) report('team roles are always on: set locked: true');
  if (spec.teamRole !== undefined && JOINS_BY_RULE.has(spec.teamRole) && spec.mentionOnly) {
    report(`the ${spec.teamRole} joins by rule, not by @mention: set mention_only: false`);
  }
  if (spec.teamRole !== undefined && JOINS_WHEN_MENTIONED.has(spec.teamRole) && !spec.mentionOnly) {
    report(`the ${spec.teamRole} joins only when @mentioned: set mention_only: true`);
  }
}

function checkRoutingLists(spec: AgentSpec, report: Report): void {
  const termCount = spec.routing.keywords.length + spec.routing.acronyms.length;
  if (spec.routable && termCount === 0) report('a routable agent needs at least one routing keyword or acronym');
  if (!spec.routable && termCount > 0) {
    report('this agent is not routable, so routing.keywords and routing.acronyms must be empty');
  }
}

function checkAvatar(spec: AgentSpec, report: Report, avatarExists: (avatarPath: string) => boolean): void {
  const expected = avatarPathFor(spec.id);
  if (spec.avatar !== expected) {
    report(`avatar must be "${expected}"; got "${spec.avatar}"`);
  } else if (spec.active && !avatarExists(spec.avatar)) {
    report(`avatar file ${spec.avatar} not found in the app's public folder`);
  }
}

function checkHandoffs(spec: AgentSpec, report: Report, knownIds: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const id of spec.handoffs) {
    if (seen.has(id)) report(`handoff "${id}" is listed twice`);
    seen.add(id);
    if (id === spec.id) report(`handoffs name "${id}", the agent itself; hand off to other agents only`);
    else if (!knownIds.has(id)) report(`handoff "${id}" is not a known agent id`);
  }
}

function checkSections(spec: AgentSpec, report: Report): void {
  for (const heading of AGENT_SECTION_HEADINGS) {
    const key = SECTION_KEY_BY_HEADING[heading];
    if (key === 'examplePrompts') continue;
    if (spec.sections[key].trim() === '') report(`section "## ${heading}" is empty`);
  }
  const prompts = spec.sections.examplePrompts.length;
  if (prompts < MIN_EXAMPLE_PROMPTS) {
    report(`"## Example prompts" needs at least ${MIN_EXAMPLE_PROMPTS} bullet items; found ${prompts}`);
  }
}

function checkUniqueIds(specs: readonly AgentSpec[], reportFor: (spec: AgentSpec, message: string) => void): void {
  const counts = new Map<string, AgentSpec[]>();
  for (const spec of specs) counts.set(spec.id, [...(counts.get(spec.id) ?? []), spec]);
  for (const [id, group] of counts) {
    if (group.length > 1) reportFor(group[0], `id "${id}" is used by ${group.length} specs`);
  }
}

/** Reports every spec whose key an earlier spec already has. */
function checkUnique(
  specs: readonly AgentSpec[],
  keyOf: (spec: AgentSpec) => string,
  message: (spec: AgentSpec, first: AgentSpec) => string,
  reportFor: (spec: AgentSpec, message: string) => void,
): void {
  const firstByKey = new Map<string, AgentSpec>();
  for (const spec of specs) {
    const first = firstByKey.get(keyOf(spec));
    // Two entries with the same id are one problem, reported by checkUniqueIds.
    if (first === undefined) firstByKey.set(keyOf(spec), spec);
    else if (first.id !== spec.id) reportFor(spec, message(spec, first));
  }
}

function checkOrchestrator(specs: readonly AgentSpec[], unparsedCount: number, report: Report): void {
  const orchestrators = specs.filter((spec) => spec.active && spec.kind === 'orchestrator');
  if (orchestrators.length === 0) {
    const hint = unparsedCount > 0 ? ` (${unparsedCount} spec file(s) could not be parsed; the orchestrator may be among them)` : '';
    report(`no active agent has kind "orchestrator"; exactly one is required${hint}`);
  } else if (orchestrators.length > 1) {
    report(
      `exactly one active agent may have kind "orchestrator"; found ${orchestrators.length}: ${orchestrators.map(fileOf).join(', ')}`,
    );
  }
}

/** Compared case-insensitively across keywords and acronyms: `cmc` and `CMC` are one term. */
function routingTermKey(term: string): string {
  return term.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function checkDistinctRoutingTerms(specs: readonly AgentSpec[], reportFor: (spec: AgentSpec, message: string) => void): void {
  const owners = new Map<string, { spec: AgentSpec; term: string; list: string }>();
  for (const spec of specs) {
    if (!spec.active || !spec.routable) continue;
    const terms = [
      ...spec.routing.keywords.map((term) => ({ term, list: 'keyword' })),
      ...spec.routing.acronyms.map((term) => ({ term, list: 'acronym' })),
    ];
    for (const { term, list } of terms) {
      const key = routingTermKey(term);
      const owner = owners.get(key);
      if (owner === undefined) {
        owners.set(key, { spec, term, list });
      } else if (owner.spec !== spec) {
        reportFor(
          spec,
          `routing ${list} "${term}" is also a routing ${owner.list} of ${fileOf(owner.spec)} ("${owner.term}"); two routable agents may not share a term`,
        );
      }
    }
  }
}
