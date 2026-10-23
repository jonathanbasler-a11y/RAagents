import {
  CLASSIFICATION_IDS,
  DEVELOPMENT_STAGES,
  type AgentId,
  type AgentSpec,
  type AgentTrigger,
  type ClassificationId,
  type DdSetup,
  type DevelopmentStage,
} from './contracts';

// The DD setup rule. Pure and free of server imports, so the page and the API use the same code.
//
// Each agent carries a `trigger` in its spec: an asset classification, `late` (the stage is Phase 3 or
// Filed), `filed` (the asset is filed), or nothing (the agent follows its default). `ruleWants` says
// whether the playbook wants an agent for a given setup. A person's switch is the current selection;
// it differs from the rule only where the person overrode it.

/** The words for an asset classification, written once for the page, the team list and the gates' facts. */
export const CLASSIFICATION_LABELS: Record<ClassificationId, string> = {
  orphan: 'Orphan',
  paed: 'Paediatric requirements',
  exp: 'Expedited programme',
  combo: 'Combination product',
  cdx: 'Companion diagnostic',
};

/** What a new workspace starts with: Phase 2, orphan and paediatric. It gives the 14 default agents. */
export const DEFAULT_DD_SETUP: DdSetup = { stage: 'Phase 2', classifications: ['orphan', 'paed'] };

/** Stages from which `late` agents are wanted. */
export const LATE_STAGES: readonly DevelopmentStage[] = ['Phase 3', 'Filed'];
/** Stages from which `filed` agents are wanted. */
export const FILED_STAGES: readonly DevelopmentStage[] = ['Filed'];

/** The fields of an agent the rule reads. */
export type RuleAgent = Pick<AgentSpec, 'id' | 'locked' | 'defaultSelected' | 'trigger'>;

/** Whether the playbook wants this agent for this setup. A locked agent is always wanted. */
export function ruleWants(agent: RuleAgent, setup: DdSetup): boolean {
  if (agent.locked) return true;
  const { trigger } = agent;
  if (trigger === undefined) return agent.defaultSelected;
  if (trigger === 'late') return LATE_STAGES.includes(setup.stage);
  if (trigger === 'filed') return FILED_STAGES.includes(setup.stage);
  return setup.classifications.includes(trigger);
}

/**
 * The selection after the setup changes from `before` to `after`. An agent whose own rule changes takes
 * the new rule; every other agent keeps its switch, so choices a person made by hand survive. Locked
 * agents are always on. The result holds roster agents only, in the order of `agents`.
 */
export function selectionAfterSetupChange(
  agents: readonly RuleAgent[],
  before: DdSetup,
  after: DdSetup,
  selected: readonly AgentId[],
): AgentId[] {
  const current = new Set(selected);
  return agents
    .filter((agent) => {
      if (agent.locked) return true;
      const was = ruleWants(agent, before);
      const now = ruleWants(agent, after);
      return was === now ? current.has(agent.id) : now;
    })
    .map((agent) => agent.id);
}

/** Why an agent is on or off, worked out from the setup and the switch; nothing is stored. */
export type SelectionReason =
  | { kind: 'always' }
  | { kind: 'classification'; id: ClassificationId }
  | { kind: 'late' }
  | { kind: 'filed' }
  | { kind: 'default' }
  | { kind: 'manual-on' }
  | { kind: 'manual-off' }
  | { kind: 'waiting'; trigger: AgentTrigger }
  | { kind: 'not-for-dd' };

export function selectionReason(agent: RuleAgent, setup: DdSetup, selected: boolean): SelectionReason {
  if (agent.locked) return { kind: 'always' };
  const wanted = ruleWants(agent, setup);
  if (selected) {
    if (!wanted) return { kind: 'manual-on' };
    const { trigger } = agent;
    if (trigger === undefined) return { kind: 'default' };
    if (trigger === 'late') return { kind: 'late' };
    if (trigger === 'filed') return { kind: 'filed' };
    return { kind: 'classification', id: trigger };
  }
  if (wanted) return { kind: 'manual-off' };
  return agent.trigger === undefined ? { kind: 'not-for-dd' } : { kind: 'waiting', trigger: agent.trigger };
}

export type NormalizedDdSetup = { ok: true; setup: DdSetup } | { ok: false; message: string };

const SHAPE_MESSAGE = `Send { "stage": one of ${DEVELOPMENT_STAGES.join(', ')}, "classifications": a list of ${CLASSIFICATION_IDS.join(', ')} }.`;

/**
 * Checks a request body and returns the setup in its canonical shape: unique classifications in
 * CLASSIFICATION_IDS order. Extra keys are ignored.
 */
export function normalizeDdSetup(value: unknown): NormalizedDdSetup {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, message: SHAPE_MESSAGE };
  const { stage, classifications } = value as { stage?: unknown; classifications?: unknown };
  if (typeof stage !== 'string' || !(DEVELOPMENT_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, message: `The stage must be one of ${DEVELOPMENT_STAGES.join(', ')}. ${SHAPE_MESSAGE}` };
  }
  if (!Array.isArray(classifications)) return { ok: false, message: `The classifications must be a list (it may be empty), with no stage left out. ${SHAPE_MESSAGE}` };
  const unknown = classifications.filter((item) => typeof item !== 'string' || !(CLASSIFICATION_IDS as readonly string[]).includes(item));
  if (unknown.length > 0) return { ok: false, message: `Unknown classification for the stage ${stage}: ${unknown.map(String).join(', ')}. ${SHAPE_MESSAGE}` };
  const chosen = new Set(classifications as string[]);
  return { ok: true, setup: { stage: stage as DevelopmentStage, classifications: CLASSIFICATION_IDS.filter((id) => chosen.has(id)) } };
}
