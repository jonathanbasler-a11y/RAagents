import 'server-only';
import { randomUUID } from 'node:crypto';
import type { UntrustedBlock } from '@/server/prompts';
import type {
  AgentId,
  AgentOutcome,
  AgentSpec,
  ChatErrorCode,
  ChatEvent,
  ChatLimits,
  ContributionRole,
  LlmMessage,
  Message,
  Store,
  TurnTrace,
} from '@/shared/contracts';
import { runAgent, toAgentOutcome, toReplyMessage, type RunAgentDeps, type RunAgentResult } from './run-agent';
import { routeTeamTurn } from './team-router';
import type { RoomExecutor, TurnOutcome, TurnRun } from './turn-runner';

// The team chat's turn (BUILD-LEARNINGS Part 6), on the one execution path (runAgent):
//   1. route by code (team-router.ts); the route and its notes are saved before any call;
//   2. the primary answers, streamed; if it has no usable answer the secondaries are skipped;
//   3. the secondaries run in parallel, see the primary's answer fenced, and arrive whole;
//      a NO_ADDITION reply becomes "had nothing to add" (a note, never a reply);
//   4. the synthesiser sums up only after 2 or more substantive contributions.
// At most 4 contributors plus 1 summary: 5 model calls. Every model call gets the turn's
// deadline signal. "Not consulted", "nothing to add", "failed" and "out of time" stay distinct.

/** The exact reply a secondary gives when it has nothing material to add. */
export const NO_ADDITION = 'NO_ADDITION';
export const SYNTHESIS_MIN_CONTRIBUTIONS: ChatLimits['synthesisMinContributions'] = 2;
export const SPECIALIST_CONTEXT_MESSAGES: ChatLimits['specialistContextMessages'] = 8;
/** NO_ADDITION may carry a short reason ("NO_ADDITION: Rosa covered it"); a longer reply is a contribution. */
const NO_ADDITION_MAX_WORDS = 12;

export interface TeamDeps extends RunAgentDeps {
  store: Store;
  /** The active roster, for routing and for the orchestrator's list of who is selected. */
  agents: readonly AgentSpec[];
  /** "Selected for this DD" (locked agents always count as selected). */
  selected: ReadonlySet<AgentId>;
}

/**
 * Whether a reply is the "nothing to add" signal: NO_ADDITION (or the plain phrase "nothing to
 * add") in any case, with spaces or underscores, in quotes, code or emphasis, optionally
 * followed by a short reason.
 */
export function isNoAddition(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > NO_ADDITION_MAX_WORDS) return false;
  // The signal word itself ("NO_ADDITION"), or the plain phrase a model often writes instead.
  const signal = words[0] === 'no' && words[1] === 'addition';
  const plain = words[0] === 'nothing' && words[1] === 'to' && words[2] === 'add';
  return signal || plain;
}

function andList(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

const isMentionable = (agent: AgentSpec) => agent.kind === 'domain' || agent.mentionOnly;

/** A substantive contribution: a complete reply with text that is not "nothing to add". */
const isSubstantive = (result: RunAgentResult) => result.state === 'answered' && result.text.trim() !== '' && !isNoAddition(result.text);

/**
 * Earlier text in the team thread a team agent sees: the last 8 questions and specialist
 * replies before this question. Summaries, the orchestrator's answers, notes, failed and
 * empty replies stay out. Fenced in the prompt: it may come from other people.
 */
function specialistContext(messages: readonly Message[], question: Message, getAgent: RunAgentDeps['getAgent']): UntrustedBlock[] {
  const counts = (message: Message) => {
    if (message.author === 'human') return true;
    if (message.author !== 'agent') return false;
    const agent = message.agentId === null ? undefined : getAgent(message.agentId);
    return agent?.teamRole !== 'synthesiser' && agent?.kind !== 'orchestrator';
  };
  return messages
    .filter((message) => message.seq < question.seq && message.status !== 'error' && message.text.trim() !== '' && counts(message))
    .slice(-SPECIALIST_CONTEXT_MESSAGES)
    .map((message) => ({
      label: message.author === 'human' ? 'a person in the team chat, earlier' : `${message.agentName ?? 'an agent'}, teammate, earlier in the team chat`,
      text: message.text,
    }));
}

/** The part a not-consulted agent would have had, for the trace. */
function partOf(agent: AgentSpec | undefined): ContributionRole {
  if (agent?.kind === 'orchestrator') return 'primary';
  return agent?.teamRole === 'synthesiser' ? 'synthesis' : 'secondary';
}

function failureWord(result: RunAgentResult): string {
  if (result.state === 'out_of_time') return 'ran out of time';
  return result.text === '' ? 'failed' : 'broke off';
}

type SecondaryRun =
  | { kind: 'ran'; result: RunAgentResult; noAddition: boolean }
  | { kind: 'could_not_run'; agentId: AgentId; error: unknown };

/** The executor of the team chat. */
export function teamExecutor(deps: TeamDeps): RoomExecutor {
  return async (run: TurnRun): Promise<TurnOutcome> => {
    const { store } = deps;
    const newId = deps.newId ?? randomUUID;
    const log = deps.log ?? console;
    const rosterAgent = (id: AgentId) => deps.getAgent(id) ?? deps.agents.find((agent) => agent.id === id);
    const nameOf = (id: AgentId) => rosterAgent(id)?.name ?? id;

    const route = routeTeamTurn({ question: run.question, agents: deps.agents, selected: deps.selected });
    run.emit({ type: 'route', route });

    // The synthesiser, when it may run, is traced by what it did, not by a mention.
    const synthesiser = route.synthesis ? deps.agents.find((agent) => agent.teamRole === 'synthesiser') : undefined;
    const notConsulted: AgentOutcome[] = route.notConsulted
      .filter((entry) => entry.agentId !== synthesiser?.id)
      .map((entry) => ({
        agentId: entry.agentId,
        agentName: nameOf(entry.agentId),
        role: partOf(rosterAgent(entry.agentId)),
        state: 'not_consulted',
        reason: entry.reason,
      }));
    const consulted: AgentOutcome[] = [];
    let summary: AgentOutcome | undefined;
    const trace = (): TurnTrace => ({ route, agents: [...consulted, ...notConsulted, ...(summary ? [summary] : [])] });
    const saveProgress = () => store.saveTurnTrace(run.turn.id, trace());
    saveProgress();
    /** Every missing piece of planned text, in the order it happened: the turn reports the first. */
    const failures: Array<{ code: ChatErrorCode; correlationId: string | null }> = [];
    const recordFailure = (result: RunAgentResult) => {
      if (result.errorCode !== null) failures.push({ code: result.errorCode, correlationId: result.correlationId });
    };

    const note = (text: string) => {
      const id = newId();
      store.appendNote({ id, turnId: run.turn.id, text });
      run.emit({ type: 'note', text, messageId: id });
    };
    /** A call that could not even start (the agent left the roster, a bug): logged, traced and said in the thread. */
    const couldNotRun = (agentId: AgentId, what: string, error: unknown) => {
      const correlationId = newId();
      log.error(`[team] ${agentId} could not run in turn ${run.turn.id} (correlation ${correlationId}): ${describeError(error)}`);
      failures.push({ code: 'internal', correlationId });
      note(`${nameOf(agentId)} ${what}: something went wrong in the app (reference ${correlationId}).`);
    };
    for (const text of route.notes) note(text);

    if (route.primary === undefined) {
      const correlationId = newId();
      log.error(`[team] turn ${run.turn.id}: no agent can answer (correlation ${correlationId}); the roster has no orchestrator`);
      run.emit({ type: 'error', code: 'internal', correlationId });
      return { status: 'error', trace: trace(), errorCode: 'internal', correlationId };
    }

    const history: LlmMessage[] = [{ role: 'user', content: run.question }];
    const earlier = specialistContext(store.listMessages(run.thread.id), run.userMessage, deps.getAgent);
    const common = { room: 'team' as const, history, timeZone: run.timeZone, signal: run.signal };

    // 1. The primary answers first, streamed.
    const primaryInstructions: string[] = [];
    if (route.source === 'none') {
      const selectedMates = deps.agents
        .filter((agent) => agent.id !== route.primary && isMentionable(agent) && (agent.locked || deps.selected.has(agent.id)))
        .sort((a, b) => a.order - b.order)
        .map((agent) => `${agent.name} (${agent.capability})`);
      primaryInstructions.push(
        'Nobody was brought in for this question: there was no @mention and no routing term matched. Give a short, usable answer, then name the teammates who fit best, by first name, so the person can @mention them.',
      );
      if (selectedMates.length > 0) primaryInstructions.push(`Selected for this DD: ${selectedMates.join(', ')}.`);
    } else if (route.secondaries.length > 0) {
      const mates = route.secondaries.map((id) => `${nameOf(id)} (${rosterAgent(id)?.capability ?? 'teammate'})`);
      primaryInstructions.push(`Teammates who add to your answer in this turn: ${mates.join(', ')}. Leave their remits to them.`);
    }
    const primary = await runAgent(route.primary, { ...common, role: 'primary', roomContext: earlier, instructions: primaryInstructions, emit: run.emit }, deps);
    store.appendAgentMessage(toReplyMessage(run.turn.id, primary));
    consulted.push(toAgentOutcome(primary));
    recordFailure(primary);
    saveProgress();

    // 2. The secondaries, only after a usable first answer.
    const secondaries: RunAgentResult[] = [];
    if (primary.state !== 'answered') {
      for (const id of route.secondaries) consulted.push({ agentId: id, agentName: nameOf(id), role: 'secondary', state: 'not_consulted', reason: 'primary_failed' });
      if (route.secondaries.length > 0) {
        const names = route.secondaries.map(nameOf);
        note(`${andList(names)} ${names.length === 1 ? 'was' : 'were'} not asked: ${primary.agentName}’s reply ${failureWord(primary)}.`);
      }
    } else if (route.secondaries.length > 0) {
      const primaryBlock: UntrustedBlock = { label: `${primary.agentName}, teammate, answered first in this turn`, text: primary.text };
      const runSecondary = async (agentId: AgentId): Promise<SecondaryRun> => {
        const held: ChatEvent[] = [];
        const instructions = [
          `If you have nothing material to add to the teammate's answer, reply with exactly ${NO_ADDITION} and nothing else.`,
        ];
        const role = rosterAgent(agentId)?.teamRole;
        if (role === 'red-team' || role === 'evidence-checker') {
          instructions.push("Answer as a list keyed by claim in the teammate's answer: the claim in a few words, then your point.");
        }
        try {
          const result = await runAgent(
            agentId,
            {
              ...common,
              role: 'secondary',
              roomContext: [...earlier, primaryBlock],
              instructions,
              // A secondary arrives whole: its start shows at once, its text when it is complete.
              emit: (event) => {
                if (event.type === 'agent_start') run.emit(event);
                else if (event.type !== 'delta') held.push(event);
              },
            },
            deps,
          );
          const noAddition = result.state === 'answered' && isNoAddition(result.text);
          if (noAddition) {
            run.emit({ type: 'no_addition', agentId: result.agentId, messageId: result.messageId });
          } else {
            if (result.text !== '') run.emit({ type: 'delta', messageId: result.messageId, text: result.text });
            for (const event of held) run.emit(event);
          }
          return { kind: 'ran', result, noAddition };
        } catch (error) {
          return { kind: 'could_not_run', agentId, error };
        }
      };

      // Saved in route order once all have settled, so a reload shows them in the order they were placed.
      for (const outcome of await Promise.all(route.secondaries.map(runSecondary))) {
        if (outcome.kind === 'could_not_run') {
          couldNotRun(outcome.agentId, 'could not be asked', outcome.error);
          consulted.push({ agentId: outcome.agentId, agentName: nameOf(outcome.agentId), role: 'secondary', state: 'failed', errorCode: 'internal' });
          continue;
        }
        const { result } = outcome;
        if (outcome.noAddition) {
          store.appendNote({ id: result.messageId, turnId: run.turn.id, text: `${result.agentName} had nothing to add.` });
          consulted.push({ ...toAgentOutcome(result), state: 'no_addition' });
        } else {
          store.appendAgentMessage(toReplyMessage(run.turn.id, result));
          consulted.push(toAgentOutcome(result));
          recordFailure(result);
          secondaries.push(result);
        }
      }
      saveProgress();
    }

    // 3. The summary, after 2 or more substantive contributions.
    if (synthesiser) {
      const contributions = [primary, ...secondaries].filter(isSubstantive);
      const base = { agentId: synthesiser.id, agentName: synthesiser.name, role: 'synthesis' as const };
      if (contributions.length < SYNTHESIS_MIN_CONTRIBUTIONS) {
        summary = { ...base, state: 'not_consulted', reason: 'too_few_contributions' };
      } else if (run.signal.aborted) {
        summary = { ...base, state: 'out_of_time', errorCode: 'out_of_time' };
        failures.push({ code: 'out_of_time', correlationId: null });
        note(`${synthesiser.name} did not sum up: the turn ran out of time.`);
      } else {
        try {
          const synthesis = await runAgent(
            synthesiser.id,
            {
              ...common,
              role: 'synthesis',
              roomContext: contributions.map((result) => ({
                label: `${result.agentName}, teammate, ${rosterAgent(result.agentId)?.capability ?? 'answered in this turn'}`,
                text: result.text,
              })),
              instructions: [`Contributions to sum up, in the fenced blocks: ${andList(contributions.map((result) => result.agentName))}.`],
              emit: run.emit,
            },
            deps,
          );
          store.appendAgentMessage(toReplyMessage(run.turn.id, synthesis));
          summary = toAgentOutcome(synthesis);
          recordFailure(synthesis);
        } catch (error) {
          couldNotRun(synthesiser.id, 'could not sum up', error);
          summary = { ...base, state: 'failed', errorCode: 'internal' };
        }
      }
    }

    // How the turn ended: no usable first answer is an error; any missing planned text is partial.
    if (primary.status === 'error') {
      return { status: 'error', trace: trace(), errorCode: primary.errorCode, correlationId: primary.correlationId };
    }
    const [first] = failures;
    return first === undefined
      ? { status: 'done', trace: trace(), errorCode: null, correlationId: null }
      : { status: 'partial', trace: trace(), errorCode: first.code, correlationId: first.correlationId };
  };
}
