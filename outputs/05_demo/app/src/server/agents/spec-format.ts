import 'server-only';
import type { AgentSectionKeyByHeading, AgentSpec } from '@/shared/contracts';

// Format rules shared by the parser and the roster checks. The authoring guide is
// outputs/04_agents/README.md.

/** Lowercase letters, digits and hyphens, starting with a letter. */
export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Ids an agent may not take. `team` is the team chat. */
export const RESERVED_AGENT_IDS: ReadonlySet<string> = new Set(['team']);

/** Which AgentSections key each `## ` heading fills. */
export const SECTION_KEY_BY_HEADING = {
  'Role': 'role',
  'In this phase': 'inThisPhase',
  'Persona and voice': 'personaAndVoice',
  'Planned knowledge sources': 'plannedKnowledgeSources',
  'Tools': 'tools',
  'Guardrails': 'guardrails',
  'Escalation lines': 'escalationLines',
  'Human owner': 'humanOwner',
  'Autonomy level': 'autonomyLevel',
  'Example prompts': 'examplePrompts',
} as const satisfies AgentSectionKeyByHeading;

/** Fewest bullet items in "## Example prompts". */
export const MIN_EXAMPLE_PROMPTS = 3;

/** The one avatar path an agent may use. */
export function avatarPathFor(id: string): string {
  return `/avatars/${id}.svg`;
}

/** How issues name a spec: its file name. */
export function fileOf(spec: Pick<AgentSpec, 'id'>): string {
  return `${spec.id}.md`;
}
