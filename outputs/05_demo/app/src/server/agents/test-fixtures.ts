// Test-only helpers for the agent registry tests. Not imported by app code.
//
// The fixture roster is small and fictional. Its ids deliberately differ from the real
// roster's ids, so code that hard-codes a real id (such as `orc`) fails these tests.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import { AgentSpecError } from '@/server/agents';
import type { AgentSections, AgentSpec, SpecIssue } from '@/shared/contracts';

/** The ten body headings and the AgentSections key each fills, written out by hand. */
const SECTIONS: ReadonlyArray<readonly [string, keyof AgentSections]> = [
  ['Role', 'role'],
  ['In this phase', 'inThisPhase'],
  ['Persona and voice', 'personaAndVoice'],
  ['Planned knowledge sources', 'plannedKnowledgeSources'],
  ['Tools', 'tools'],
  ['Guardrails', 'guardrails'],
  ['Escalation lines', 'escalationLines'],
  ['Human owner', 'humanOwner'],
  ['Autonomy level', 'autonomyLevel'],
  ['Example prompts', 'examplePrompts'],
];

function sections(id: string, name: string, owner: string): AgentSections {
  return {
    role: `${name} covers one part of a due diligence and names the teammate for anything else.`,
    inThisPhase: `phase-limits-${id}: no documents are connected and ${name} has no tools, so ${name} explains what to check and marks open points "to verify".`,
    personaAndVoice: `persona-brief-${id}: ${name} writes short, plain sentences. When a term has a regulated meaning, ${name} explains it.`,
    plannedKnowledgeSources: '- Public health authority guidance documents: not connected',
    tools: 'None in this phase. No tool can open a document or accept a finding.',
    guardrails: '- Works with public, company-neutral information only.',
    escalationLines: '- "Have the accountable reviewer check this before anyone relies on it."',
    humanOwner: `${owner}. Keeps this brief up to date.`,
    autonomyLevel: 'Level 2, Collaborate. A person checks every output before it is used.',
    examplePrompts: [
      `What would ${name} check first?`,
      'Which risks are typical at this stage?',
      'What should we verify before the review meeting?',
    ],
  };
}

type FixtureId = 'lead' | 'cmc' | 'labels' | 'conductor' | 'critic' | 'summary';

function base(id: FixtureId): AgentSpec {
  const common = {
    active: true,
    version: '0.1.0',
    modelRoute: 'agents' as const,
    sourceAllowlist: [],
    avatar: `/avatars/${id}.svg`,
  };
  switch (id) {
    case 'lead':
      return {
        ...common,
        id,
        name: 'Rosa',
        letter: 'R',
        capability: 'Regulatory lead',
        group: 'core',
        kind: 'domain',
        order: 1,
        autonomyLevel: 2,
        humanOwner: 'Regulatory lead agent owner',
        routing: { keywords: ['regulatory strategy', 'filing route'], acronyms: [] },
        routable: true,
        mentionOnly: false,
        locked: false,
        defaultSelected: true,
        handoffs: ['cmc'],
        plannedRemit: 'Frames the regulatory questions of a due diligence.',
        sections: sections(id, 'Rosa', 'Regulatory lead agent owner'),
      };
    case 'cmc':
      return {
        ...common,
        id,
        name: 'Carlos',
        letter: 'C',
        capability: 'CMC regulatory',
        group: 'core',
        kind: 'domain',
        order: 2,
        autonomyLevel: 2,
        humanOwner: 'CMC regulatory agent owner',
        routing: { keywords: ['comparability', 'manufacturing change'], acronyms: ['CMC'] },
        routable: true,
        mentionOnly: false,
        locked: false,
        defaultSelected: true,
        trigger: 'late',
        handoffs: [],
        plannedRemit: 'Looks at the manufacturing and controls part of the dossier.',
        sections: sections(id, 'Carlos', 'CMC regulatory agent owner'),
      };
    case 'labels':
      return {
        ...common,
        id,
        name: 'Lena',
        letter: 'L',
        capability: 'Labelling',
        shortCapability: 'Labels',
        group: 'core',
        kind: 'domain',
        order: 3,
        autonomyLevel: 2,
        humanOwner: 'Labelling agent owner',
        routing: { keywords: ['labelling', 'product information'], acronyms: ['SmPC'] },
        routable: true,
        mentionOnly: false,
        locked: false,
        defaultSelected: false,
        handoffs: ['lead'],
        plannedRemit: 'Compares product information across regions.',
        sections: sections(id, 'Lena', 'Labelling agent owner'),
      };
    case 'conductor':
      return {
        ...common,
        id,
        name: 'Oskar',
        letter: 'O',
        capability: 'Orchestrator',
        group: 'role',
        kind: 'orchestrator',
        teamRole: 'orchestrator',
        order: 4,
        autonomyLevel: 2,
        humanOwner: 'Orchestrator agent owner',
        routing: { keywords: [], acronyms: [] },
        routable: false,
        mentionOnly: false,
        locked: true,
        defaultSelected: true,
        handoffs: [],
        plannedRemit: 'Answers when nobody else is routed and names who fits.',
        sections: sections(id, 'Oskar', 'Orchestrator agent owner'),
      };
    case 'critic':
      return {
        ...common,
        id,
        name: 'Ruben',
        letter: 'R',
        capability: 'Red team',
        group: 'role',
        kind: 'team-role',
        teamRole: 'red-team',
        order: 5,
        autonomyLevel: 2,
        humanOwner: 'Red team agent owner',
        routing: { keywords: [], acronyms: [] },
        routable: false,
        mentionOnly: true,
        locked: true,
        defaultSelected: true,
        handoffs: [],
        plannedRemit: 'Challenges the team view when asked.',
        sections: sections(id, 'Ruben', 'Red team agent owner'),
      };
    case 'summary':
      return {
        ...common,
        id,
        name: 'Sofia',
        letter: 'S',
        capability: 'Synthesiser',
        group: 'role',
        kind: 'team-role',
        teamRole: 'synthesiser',
        order: 6,
        autonomyLevel: 1,
        humanOwner: 'Synthesiser agent owner',
        routing: { keywords: [], acronyms: [] },
        routable: false,
        mentionOnly: false,
        locked: true,
        defaultSelected: true,
        handoffs: [],
        plannedRemit: 'Summarises unverified views after two or more contributions.',
        sections: sections(id, 'Sofia', 'Synthesiser agent owner'),
      };
  }
}

export const FIXTURE_IDS: readonly FixtureId[] = ['lead', 'cmc', 'labels', 'conductor', 'critic', 'summary'];

/** A fresh copy of one fixture agent. */
export function fixtureSpec(id: FixtureId): AgentSpec {
  return structuredClone(base(id));
}

/** A fresh copy of the valid fixture roster, in `order`. */
export function fixtureSpecs(): AgentSpec[] {
  return FIXTURE_IDS.map(fixtureSpec);
}

/** The fixture roster with one agent changed (a shallow merge of `patch`). */
export function changed(id: FixtureId, patch: Partial<AgentSpec>): AgentSpec[] {
  return fixtureSpecs().map((spec) => (spec.id === id ? { ...spec, ...patch } : spec));
}

/** A valid extra domain agent, for tests that add a file. */
export function extraSpec(): AgentSpec {
  return {
    ...fixtureSpec('lead'),
    id: 'dosing',
    name: 'Dara',
    letter: 'D',
    capability: 'Dosing strategy',
    order: 7,
    humanOwner: 'Dosing strategy agent owner',
    routing: { keywords: ['dose finding'], acronyms: [] },
    handoffs: [],
    avatar: '/avatars/dosing.svg',
    plannedRemit: 'Explains how dose selection is usually justified.',
    sections: sections('dosing', 'Dara', 'Dosing strategy agent owner'),
  };
}

/** The spec's front matter as snake_case YAML fields (optional fields left out when unset). */
function frontMatterOf(spec: AgentSpec): Record<string, unknown> {
  return {
    id: spec.id,
    name: spec.name,
    letter: spec.letter,
    capability: spec.capability,
    short_capability: spec.shortCapability,
    group: spec.group,
    kind: spec.kind,
    team_role: spec.teamRole,
    order: spec.order,
    autonomy_level: spec.autonomyLevel,
    human_owner: spec.humanOwner,
    active: spec.active,
    version: spec.version,
    model_route: spec.modelRoute,
    routing: { keywords: [...spec.routing.keywords], acronyms: [...spec.routing.acronyms] },
    routable: spec.routable,
    mention_only: spec.mentionOnly,
    locked: spec.locked,
    default_selected: spec.defaultSelected,
    trigger: spec.trigger,
    handoffs: [...spec.handoffs],
    source_allowlist: [...spec.sourceAllowlist],
    avatar: spec.avatar,
    planned_remit: spec.plannedRemit,
  };
}

/** The body as [heading, text] pairs in order (example prompts as `- ` bullets), for tests that rearrange sections. */
export function bodyParts(specSections: AgentSections): Array<[string, string]> {
  return SECTIONS.map(([heading, key]) => [
    heading,
    key === 'examplePrompts' ? specSections.examplePrompts.map((prompt) => `- ${prompt}`).join('\n') : specSections[key],
  ]);
}

export function bodyFromParts(parts: ReadonlyArray<readonly [string, string]>): string {
  return parts.map(([heading, text]) => `## ${heading}\n\n${text}\n`).join('\n');
}

export interface SpecTextEdits {
  /** Front-matter fields to set. `undefined` removes the field. */
  front?: Record<string, unknown>;
  /** Replaces the whole body (everything after the closing `---`). */
  body?: string;
}

/** A spec file's text, as an author would write it. */
export function specText(spec: AgentSpec, edits: SpecTextEdits = {}): string {
  const front = { ...frontMatterOf(spec), ...edits.front };
  // stringify leaves out fields whose value is undefined.
  return `---\n${stringify(front)}---\n\n${edits.body ?? bodyFromParts(bodyParts(spec.sections))}`;
}

/** Runs `fn` and returns the issues of the AgentSpecError it throws. */
export function specIssues(fn: () => unknown): SpecIssue[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentSpecError) return error.issues;
    throw error;
  }
  throw new Error('expected an AgentSpecError, but nothing was thrown');
}

/** A throwaway copy of the repo layout: outputs/04_agents next to outputs/05_demo/app/public. */
export interface TempLayout {
  root: string;
  specsDir: string;
  appDir: string;
  publicDir: string;
  cleanup(): void;
}

export function makeLayout(): TempLayout {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-registry-'));
  const specsDir = path.join(root, 'outputs', '04_agents');
  const appDir = path.join(root, 'outputs', '05_demo', 'app');
  const publicDir = path.join(appDir, 'public');
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(path.join(publicDir, 'avatars'), { recursive: true });
  return { root, specsDir, appDir, publicDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function writeAvatar(layout: TempLayout, id: string): void {
  writeFileSync(path.join(layout.publicDir, 'avatars', `${id}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
}

/** Writes each spec as `<id>.md`, plus its avatar. */
export function writeSpecs(layout: TempLayout, specs: readonly AgentSpec[]): void {
  for (const spec of specs) {
    writeFileSync(path.join(layout.specsDir, `${spec.id}.md`), specText(spec));
    writeAvatar(layout, spec.id);
  }
}

/** Sets a file's mtime `secondsAhead` seconds into the future, so a change is visible on any filesystem. */
export function touch(file: string, secondsAhead: number): void {
  const when = new Date(Date.now() + secondsAhead * 1000);
  utimesSync(file, when, when);
}
