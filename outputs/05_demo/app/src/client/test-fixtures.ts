/**
 * Test data only: fictional agents, messages and turns shaped exactly like the
 * contracts. Imported by tests, never by app code.
 */
import type {
  AgentGroup,
  AgentKind,
  Message,
  PublicAgent,
  RoomMessagesResponse,
  TeamRole,
  Thread,
  Turn,
} from '@/shared/contracts';

interface AgentSeed {
  id: string;
  name: string;
  capability: string;
  shortCapability?: string;
  group: AgentGroup;
  kind?: AgentKind;
  teamRole?: TeamRole;
  order: number;
  autonomyLevel?: 1 | 2;
  defaultSelected?: boolean;
  locked?: boolean;
  mentionOnly?: boolean;
  routable?: boolean;
  trigger?: PublicAgent['trigger'];
  examplePrompts?: string[];
}

export function makeAgent(seed: AgentSeed): PublicAgent {
  const kind = seed.kind ?? (seed.group === 'role' ? 'team-role' : 'domain');
  return {
    id: seed.id,
    name: seed.name,
    letter: seed.name[0],
    capability: seed.capability,
    shortCapability: seed.shortCapability,
    group: seed.group,
    kind,
    teamRole: seed.teamRole,
    order: seed.order,
    autonomyLevel: seed.autonomyLevel ?? 2,
    humanOwner: `${seed.capability} agent owner`,
    version: '0.1.0',
    routable: seed.routable ?? kind === 'domain',
    mentionOnly: seed.mentionOnly ?? false,
    locked: seed.locked ?? false,
    defaultSelected: seed.defaultSelected ?? seed.locked ?? false,
    trigger: seed.trigger,
    avatar: `/avatars/${seed.id}.svg`,
    plannedRemit: `Planned remit of the ${seed.capability.toLowerCase()} agent.`,
    profile: {
      role: `${seed.name} covers ${seed.capability.toLowerCase()}.`,
      plannedKnowledgeSources: '- Public guidance documents: not connected',
      tools: 'None in this phase.',
      guardrails: '- Public, company-neutral information only.',
      escalationLines: '- "A person decides."',
      humanOwner: `${seed.capability} agent owner.`,
      autonomyLevel: `Level ${seed.autonomyLevel ?? 2}.`,
    },
    examplePrompts: seed.examplePrompts ?? [`What would ${seed.name} check first?`],
  };
}

export const ROSA = makeAgent({
  id: 'reglead',
  name: 'Rosa',
  capability: 'Regulatory lead',
  group: 'core',
  order: 1,
  defaultSelected: true,
  examplePrompts: ['How would you scope the regulatory part of a due diligence?', 'What usually slows a first filing?'],
});
export const CARLOS = makeAgent({ id: 'cmcreg', name: 'Carlos', capability: 'CMC regulatory', group: 'core', order: 3, defaultSelected: true });
export const LENA = makeAgent({ id: 'label', name: 'Lena', capability: 'Labelling', group: 'core', order: 5, defaultSelected: true });
export const INES = makeAgent({ id: 'intel', name: 'Ines', capability: 'Regulatory intelligence', group: 'core', order: 6, defaultSelected: true });
export const OLU = makeAgent({
  id: 'ops',
  name: 'Olu',
  capability: 'Regulatory operations and submissions',
  shortCapability: 'Regulatory operations',
  group: 'core',
  order: 8,
  trigger: 'late',
});
export const OONA = makeAgent({
  id: 'sp-orphan',
  name: 'Oona',
  capability: 'Orphan designation',
  shortCapability: 'Orphan',
  group: 'spec',
  order: 10,
  defaultSelected: true,
  trigger: 'orphan',
});
export const OSKAR = makeAgent({
  id: 'orc',
  name: 'Oskar',
  capability: 'Orchestrator',
  group: 'role',
  kind: 'orchestrator',
  teamRole: 'orchestrator',
  order: 17,
  locked: true,
  routable: false,
});
export const SASKIA = makeAgent({
  id: 'san',
  name: 'Saskia',
  capability: 'Sanitiser',
  group: 'role',
  teamRole: 'sanitiser',
  order: 18,
  autonomyLevel: 1,
  locked: true,
  mentionOnly: true,
  routable: false,
});
export const EMEKA = makeAgent({
  id: 'ev',
  name: 'Emeka',
  capability: 'Evidence checker',
  group: 'role',
  teamRole: 'evidence-checker',
  order: 19,
  locked: true,
  mentionOnly: true,
  routable: false,
});
export const SOFIA = makeAgent({
  id: 'syn',
  name: 'Sofia',
  capability: 'Synthesiser',
  group: 'role',
  teamRole: 'synthesiser',
  order: 21,
  autonomyLevel: 1,
  locked: true,
  routable: false,
});
export const CYRUS = makeAgent({ id: 'o-cmc', name: 'Cyrus', capability: 'CMC and technical development', group: 'other', order: 22 });

export const ROSTER: PublicAgent[] = [ROSA, CARLOS, LENA, INES, OLU, OONA, OSKAR, SASKIA, EMEKA, SOFIA, CYRUS];

export const THREAD: Thread = {
  id: 'th1',
  workspaceId: 'demo',
  roomId: 'team',
  status: 'active',
  createdAt: '2026-10-07T09:00:00.000Z',
  archivedAt: null,
};

let seq = 0;

export function makeMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'turnId' | 'author'>): Message {
  seq += 1;
  const isAgent = overrides.author === 'agent';
  return {
    threadId: THREAD.id,
    seq,
    agentId: null,
    agentName: null,
    agentVersion: isAgent ? '0.1.0' : null,
    promptHash: isAgent ? 'hash' : null,
    model: isAgent ? 'model-a' : null,
    provenance: 'derived',
    status: 'complete',
    truncated: false,
    text: '',
    errorCode: null,
    correlationId: null,
    createdAt: '2026-10-07T09:00:01.000Z',
    ...overrides,
  };
}

export function makeTurn(overrides: Partial<Turn> & Pick<Turn, 'id'>): Turn {
  return {
    threadId: THREAD.id,
    workspaceId: 'demo',
    roomId: 'team',
    clientTurnId: `client-${overrides.id}`,
    status: 'done',
    bootId: 'boot-1',
    trace: null,
    deadlineAt: '2026-10-07T09:03:00.000Z',
    startedAt: '2026-10-07T09:00:00.000Z',
    finishedAt: '2026-10-07T09:00:12.400Z',
    errorCode: null,
    correlationId: null,
    ...overrides,
  };
}

export function roomData(messages: Message[], turns: Turn[], roomId = 'team'): RoomMessagesResponse {
  return {
    roomId,
    thread: { ...THREAD, roomId },
    messages,
    turns,
    runningTurn: turns.find((turn) => turn.status === 'running') ?? null,
  };
}
