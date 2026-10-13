import 'server-only';
import type { AgentSpec, PublicAgent } from '@/shared/contracts';

/**
 * The browser-safe view of an agent. Built field by field, so prompt text ("In this
 * phase", "Persona and voice"), routing terms, handoffs and the allowlist can never leak
 * through a spread. Optional fields appear only when the agent has them.
 */
export function toPublicAgent(spec: AgentSpec): PublicAgent {
  const { sections } = spec;
  return {
    id: spec.id,
    name: spec.name,
    letter: spec.letter,
    capability: spec.capability,
    ...(spec.shortCapability === undefined ? {} : { shortCapability: spec.shortCapability }),
    group: spec.group,
    kind: spec.kind,
    ...(spec.teamRole === undefined ? {} : { teamRole: spec.teamRole }),
    order: spec.order,
    autonomyLevel: spec.autonomyLevel,
    humanOwner: spec.humanOwner,
    version: spec.version,
    routable: spec.routable,
    mentionOnly: spec.mentionOnly,
    locked: spec.locked,
    defaultSelected: spec.defaultSelected,
    ...(spec.trigger === undefined ? {} : { trigger: spec.trigger }),
    avatar: spec.avatar,
    plannedRemit: spec.plannedRemit,
    profile: {
      role: sections.role,
      plannedKnowledgeSources: sections.plannedKnowledgeSources,
      tools: sections.tools,
      guardrails: sections.guardrails,
      escalationLines: sections.escalationLines,
      humanOwner: sections.humanOwner,
      autonomyLevel: sections.autonomyLevel,
    },
    examplePrompts: [...sections.examplePrompts],
  };
}
