import 'server-only';
import { createHash } from 'node:crypto';
import type { AgentSpec, ContributionRole, LlmMessage } from '@/shared/contracts';
import { formatTurnDate } from './date';
import { fenceUntrusted, type UntrustedBlock } from './fence';
import { SHARED_RULES } from './rules';

/** Rough reply lengths: a secondary adds a bounded reply to a teammate's answer. */
const DEFAULT_LENGTH_WORDS: Record<ContributionRole, number> = {
  solo: 250,
  primary: 250,
  secondary: 120,
  synthesis: 250,
};

const ROOM_LINES = {
  'one-to-one': 'Room: your 1:1 room with the person. Only you answer here.',
  team: 'Room: the team chat, where the person can bring several teammates in.',
} as const;

const PART_LINES: Record<ContributionRole, string> = {
  solo: 'Your part: you answer the person directly.',
  primary: 'Your part: you answer first; teammates may add to your answer after you.',
  secondary:
    'Your part: a teammate has answered first (in a fenced block below). Add only what your remit adds: a correction, a concrete consequence or a missed risk.',
  synthesis:
    'Your part: teammates have answered (in fenced blocks below), and the person has already read them. Summarise their views as unverified: agreements, conflicts, and two to four open checks, each with the role that owns it. Add no new facts and make no call.',
};

export interface AgentPromptInput {
  agent: AgentSpec;
  /** The teammates the agent may name (its handoffs, narrowed to the active roster). */
  teammates: readonly Pick<AgentSpec, 'name' | 'capability'>[];
  room: keyof typeof ROOM_LINES;
  role: ContributionRole;
  /** The turn's clock: the date line uses it. */
  now: Date;
  /** The browser's IANA time zone, already checked with resolveTimeZone. */
  timeZone: string;
  /** Validated history: starts with the person, alternates, ends with the question. */
  history: readonly LlmMessage[];
  /** Valid messages left out of history; adds an "earlier messages not included" note. */
  omitted?: number;
  /** Text not written by the person asking (e.g. teammates' replies). Fenced. */
  roomContext?: readonly UntrustedBlock[];
  /** Extra lines for this turn, written by code. */
  instructions?: readonly string[];
  /** Overrides the role's default length. */
  lengthWords?: number;
  /** Fence marker source (tests). */
  random?: () => string;
}

export interface AgentPrompt {
  messages: LlmMessage[];
  /** sha256 of the exact messages sent to the model. */
  promptHash: string;
}

/** sha256 (hex) of the messages exactly as they are sent. */
export function hashPrompt(messages: readonly LlmMessage[]): string {
  const canonical = JSON.stringify(messages.map(({ role, content }) => ({ role, content })));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Throws a TypeError unless history starts with the person, alternates between the person
 * and the agent, has no empty message and ends with the question. One bad message in a
 * replayed history can make the gateway refuse every later request (BUILD-LEARNINGS Part 8).
 */
function assertValidHistory(history: readonly LlmMessage[]): void {
  if (history.length === 0) throw new TypeError('history must hold at least the question');
  history.forEach((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new TypeError(`history message ${index + 1} has role "${String(message.role)}"; only user and assistant belong in history`);
    }
    if (typeof message.content !== 'string' || message.content.trim() === '') {
      throw new TypeError(`history message ${index + 1} is empty`);
    }
    const expected = index % 2 === 0 ? 'user' : 'assistant';
    if (message.role !== expected) {
      throw new TypeError(`history message ${index + 1} should come from the ${expected === 'user' ? 'person' : 'agent'}; history alternates and starts with the person`);
    }
  });
  if (history[history.length - 1].role !== 'user') throw new TypeError('history must end with the question');
}

/** The persona brief: who the agent is, from the spec's prompt sections. Planned sources and starter prompts stay out. */
function personaBrief(agent: AgentSpec, teammates: AgentPromptInput['teammates']): string {
  const { sections } = agent;
  const parts = [
    '## Your brief',
    `You are ${agent.name}. Your capability: ${agent.capability}.`,
    `Role:\n${sections.role}`,
    `In this phase:\n${sections.inThisPhase}`,
    `Persona and voice:\n${sections.personaAndVoice}`,
    `Tools:\n${sections.tools}`,
    `Guardrails:\n${sections.guardrails}`,
    `Escalation lines (use the one that fits, word for word, when an item needs a human reviewer or owner):\n${sections.escalationLines}`,
    `Human owner:\n${sections.humanOwner}`,
    `Autonomy level:\n${sections.autonomyLevel}`,
  ];
  if (teammates.length > 0) {
    parts.push(
      `Teammates you can name (first name: capability):\n${teammates.map((mate) => `- ${mate.name}: ${mate.capability}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

function thisTurn(input: AgentPromptInput): string {
  const words = input.lengthWords ?? DEFAULT_LENGTH_WORDS[input.role];
  const lines = [
    '## This turn',
    `- Date: ${formatTurnDate(input.now, input.timeZone)}.`,
    `- ${ROOM_LINES[input.room]}`,
    `- ${PART_LINES[input.role]}`,
    `- Length: about ${words} words, unless the person asks for a different length.`,
  ];
  const omitted = input.omitted ?? 0;
  if (omitted > 0) lines.push(`- Earlier messages in this conversation are not included (${omitted} left out).`);
  for (const instruction of input.instructions ?? []) lines.push(`- ${instruction}`);
  return lines.join('\n');
}

/**
 * The messages for one agent call, in this order: shared rules, the persona brief, the
 * date and time zone, the fenced room context (all in the system message), then the
 * validated history, which ends with the question.
 */
export function buildAgentPrompt(input: AgentPromptInput): AgentPrompt {
  assertValidHistory(input.history);
  const blocks = [SHARED_RULES, personaBrief(input.agent, input.teammates), thisTurn(input)];
  if (input.roomContext && input.roomContext.length > 0) {
    blocks.push(`## Room context\n${fenceUntrusted(input.roomContext, { random: input.random }).text}`);
  }
  const messages: LlmMessage[] = [
    { role: 'system', content: blocks.join('\n\n') },
    ...input.history.map(({ role, content }) => ({ role, content })),
  ];
  return { messages, promptHash: hashPrompt(messages) };
}
