import 'server-only';
import type { AgentId, AgentSpec, ChatLimits, NotConsulted, RouteDecision, RouteSource } from '@/shared/contracts';

// The team chat's router: who answers a team question, decided by code before any model
// call (BUILD-LEARNINGS Part 6: explicit activation first, then keyword routing; router
// order is policy). Turn logic keys off kind and team_role, never off an agent id.
//
//   1. @Name mentions bring in exactly those agents (up to 4; the rest are "matched, not
//      consulted"). A bare name summons nobody. Mentioning an agent who is not selected,
//      or a team role that joins by rule (orchestrator, synthesiser), adds a code-written note.
//   2. Otherwise routing terms pick selected routable agents, ranked by how many of their
//      terms match (ties by spec order), up to 3.
//   3. Otherwise the orchestrator answers and names who fits.
// The red team is never the first answer when anyone else is named. The synthesiser may
// follow when 2 or more agents are consulted (it still needs 2 substantive contributions).

export const MENTION_CAP: ChatLimits['mentionCap'] = 4;
export const KEYWORD_CAP: ChatLimits['keywordCap'] = 3;

export interface TeamRouteInput {
  /** The question as saved (trimmed). */
  question: string;
  /** The active roster, in any order. */
  agents: readonly AgentSpec[];
  /** "Selected for this DD". Locked agents count as selected whether listed or not. */
  selected: ReadonlySet<AgentId>;
}

const NOT_A_WORD_CHARACTER = '(?![\\p{L}\\p{M}\\p{N}])';
const NO_WORD_CHARACTER_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
/** An "@" that starts a mention: not inside a word or an e-mail address. */
const MENTION_SIGN = /(?<![\p{L}\p{M}\p{N}_])@/gu;
const MENTION_TOKEN = /^[\p{L}\p{M}]+/u;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Mention {
  agent?: AgentSpec;
  /** The word after "@" when it names no agent. */
  token: string;
}

/** Every @mention in the question, in the order written. */
function findMentions(question: string, agents: readonly AgentSpec[]): Mention[] {
  // A longer name wins over a shorter one that starts the same way.
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  const patterns = byLength.map((agent) => ({ agent, pattern: new RegExp(`^${escapeRegExp(agent.name)}${NOT_A_WORD_CHARACTER}`, 'iu') }));
  const mentions: Mention[] = [];
  for (const sign of question.matchAll(MENTION_SIGN)) {
    const rest = question.slice(sign.index + 1);
    const named = patterns.find(({ pattern }) => pattern.test(rest));
    if (named) {
      mentions.push({ agent: named.agent, token: named.agent.name });
      continue;
    }
    const token = MENTION_TOKEN.exec(rest)?.[0];
    if (token) mentions.push({ token });
  }
  return mentions;
}

/** A whole-word (or whole-phrase) pattern; spaces in a phrase match any run of whitespace. */
function termPattern(term: string, caseSensitive: boolean): RegExp {
  const body = term.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(`${NO_WORD_CHARACTER_BEFORE}${body}${NOT_A_WORD_CHARACTER}`, caseSensitive ? 'u' : 'iu');
}

/** The agent's routing terms found in the question, in spec order: keywords (any case), then acronyms (exact case). */
export function matchingTerms(agent: AgentSpec, question: string): string[] {
  return [
    ...agent.routing.keywords.filter((term) => termPattern(term, false).test(question)),
    ...agent.routing.acronyms.filter((term) => termPattern(term, true).test(question)),
  ];
}

/** Can be brought in with @Name: domain agents and the team roles that join only when mentioned. */
function isMentionable(agent: AgentSpec): boolean {
  return agent.kind === 'domain' || agent.mentionOnly;
}

/** Lower is a better first answer: a domain agent, then a team role, the red team last. */
function primaryRank(agent: AgentSpec): number {
  if (agent.kind === 'domain') return 0;
  return agent.teamRole === 'red-team' ? 2 : 1;
}

function joinsByRuleNote(agent: AgentSpec): string {
  return agent.teamRole === 'synthesiser'
    ? `${agent.name} joins by rule, not by mention: ${agent.name} sums up when 2 or more teammates have contributed.`
    : `${agent.name} joins by rule, not by mention: ${agent.name} answers only when nobody else is brought in.`;
}

const notSelectedNote = (agent: AgentSpec) =>
  `${agent.name} is not selected for this DD; switch them on in the team overview to bring them in.`;
const notSelectedMatchNote = (agent: AgentSpec) =>
  `${agent.name} matches this question but is not selected for this DD; switch them on in the team overview to bring them in.`;
const unknownMentionNote = (token: string) => `@${token} is not the name of an agent, so it brought nobody in.`;

/** Decides who answers a team question. Pure: the same input always gives the same route. */
export function routeTeamTurn(input: TeamRouteInput): RouteDecision {
  const roster = [...input.agents].sort((a, b) => a.order - b.order);
  const isSelected = (agent: AgentSpec) => agent.locked || input.selected.has(agent.id);
  const notConsulted: NotConsulted[] = [];
  const notes: string[] = [];
  const named = new Set<AgentId>();
  const unknownTokens = new Set<string>();
  const explicit: AgentSpec[] = [];

  for (const mention of findMentions(input.question, roster)) {
    const { agent } = mention;
    if (!agent) {
      const key = mention.token.toLowerCase();
      if (!unknownTokens.has(key)) notes.push(unknownMentionNote(mention.token));
      unknownTokens.add(key);
      continue;
    }
    if (named.has(agent.id)) continue;
    named.add(agent.id);
    if (!isMentionable(agent)) {
      notConsulted.push({ agentId: agent.id, reason: 'joins_by_rule' });
      notes.push(joinsByRuleNote(agent));
    } else if (!isSelected(agent)) {
      notConsulted.push({ agentId: agent.id, reason: 'not_selected' });
      notes.push(notSelectedNote(agent));
    } else {
      explicit.push(agent);
    }
  }

  const finish = (source: RouteSource, consulted: readonly AgentSpec[], matchedTerms?: Record<AgentId, string[]>): RouteDecision => {
    const primary = consulted.length === 0 ? undefined : consulted.reduce((best, agent) => (primaryRank(agent) < primaryRank(best) ? agent : best));
    const secondaries = consulted.filter((agent) => agent !== primary).map((agent) => agent.id);
    const synthesiser = roster.find((agent) => agent.teamRole === 'synthesiser');
    return {
      source,
      ...(primary === undefined ? {} : { primary: primary.id }),
      secondaries,
      // The orchestrator answering is consulted, whatever a mention said.
      notConsulted: notConsulted.filter((entry) => entry.agentId !== primary?.id),
      notes,
      synthesis: synthesiser !== undefined && isSelected(synthesiser) && consulted.length >= 2,
      ...(matchedTerms === undefined ? {} : { matchedTerms }),
    };
  };

  if (explicit.length > 0) {
    for (const agent of explicit.slice(MENTION_CAP)) notConsulted.push({ agentId: agent.id, reason: 'over_cap' });
    return finish('explicit', explicit.slice(0, MENTION_CAP));
  }

  const matches = roster
    .filter((agent) => agent.routable)
    .map((agent) => ({ agent, terms: matchingTerms(agent, input.question) }))
    .filter((match) => match.terms.length > 0);
  const ranked = matches
    .filter((match) => isSelected(match.agent))
    .sort((a, b) => b.terms.length - a.terms.length || a.agent.order - b.agent.order);
  const matchedTerms =
    matches.length === 0
      ? undefined
      : Object.fromEntries([...ranked, ...matches.filter((match) => !isSelected(match.agent))].map((match) => [match.agent.id, match.terms]));
  for (const match of ranked.slice(KEYWORD_CAP)) notConsulted.push({ agentId: match.agent.id, reason: 'over_cap' });
  for (const match of matches) {
    if (isSelected(match.agent) || named.has(match.agent.id)) continue;
    notConsulted.push({ agentId: match.agent.id, reason: 'not_selected' });
    notes.push(notSelectedMatchNote(match.agent));
  }
  if (ranked.length > 0) {
    return finish(
      'keyword',
      ranked.slice(0, KEYWORD_CAP).map((match) => match.agent),
      matchedTerms,
    );
  }

  const orchestrator = roster.find((agent) => agent.kind === 'orchestrator');
  return finish('none', orchestrator ? [orchestrator] : [], matchedTerms);
}
