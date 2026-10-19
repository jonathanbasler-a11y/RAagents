import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AgentId, ChatLimits, Message, ProposalTrace, RouteDecision, Store, TurnIntent, TurnTrace } from '@/shared/contracts';
import { runAgent, toAgentOutcome, toReplyMessage, type RunAgentDeps, type RunAgentResult } from './run-agent';
import { dataRoomMaterial, type DataRoomMaterial } from '@/server/prompts/data-room';
import { PROPOSE_FINDINGS_INSTRUCTIONS, proposalContextFor } from '@/server/prompts/findings';
import { PROPOSAL_MAX_TOKENS, checkProposal } from '@/shared/findings';
import { toPromptHistory, type PromptHistory } from './store';
import type { RoomExecutor, TurnOutcome, TurnRun } from './turn-runner';

// The 1:1 room: the room's agent answers alone, with the last valid messages of the
// room's active thread as history (the server owns history; the browser sends only the
// question). Runs through runAgent, the one execution path. When the workspace has a data room, its index and
// documents go in front of the agent on every turn (read again each time, so an added or withdrawn document counts at once).
//
// A findings proposal is the same turn with one more instruction, asked for by the person with a button: code reads the
// agent's reply, checks every claim against the room, and puts the good ones in the register as drafts and the rest in
// the open questions. The agent's words are never a finding by themselves.

export const ONE_TO_ONE_HISTORY_MESSAGES: ChatLimits['oneToOneHistoryMessages'] = 20;

export interface OneToOneDeps extends RunAgentDeps {
  store: Store;
}

export interface OneToOneOptions {
  /** propose-findings: this turn reads the reply as a findings proposal. */
  intent?: TurnIntent;
}

/**
 * History for this turn: the thread's valid messages up to and including the question
 * (a late reply to an older turn, saved after the question, stays out), the newest
 * `limit`, opening with the person and ending with the question.
 */
export function historyForTurn(
  messages: readonly Message[],
  question: Message,
  limit: number = ONE_TO_ONE_HISTORY_MESSAGES,
): PromptHistory {
  return toPromptHistory(
    messages.filter((message) => message.seq <= question.seq),
    { limit },
  );
}

const TURN_STATUS = { complete: 'done', partial: 'partial', error: 'error' } as const;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function summaryNote(findingIds: readonly string[], questionIds: readonly string[]): string {
  if (findingIds.length === 0 && questionIds.length === 0) return 'No findings were drafted and no claims were kept as open questions.';
  const parts = [];
  if (findingIds.length > 0) parts.push(`${plural(findingIds.length, 'finding', 'findings')} drafted (${findingIds.join(', ')})`);
  if (questionIds.length > 0) parts.push(`${plural(questionIds.length, 'claim', 'claims')} kept as open questions (${questionIds.join(', ')})`);
  return `${parts.join(' and ')}. Nothing is a finding until a person accepts it.`;
}

interface ProposalOutcome {
  trace: ProposalTrace;
  failure: { code: 'internal'; correlationId: string } | null;
}

/** Reads the reply of a proposal turn and writes what it can into the register, saying so in a note. Never throws. */
function proposeFromReply(deps: OneToOneDeps, run: TurnRun, result: RunAgentResult, material: DataRoomMaterial): ProposalOutcome | null {
  const { store } = deps;
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? console;
  const note = (text: string) => {
    const id = newId();
    store.appendNote({ id, turnId: run.turn.id, text });
    run.emit({ type: 'note', text, messageId: id });
  };
  const nothing = (problem: string, text: string): ProposalOutcome => {
    note(text);
    return { trace: { findingIds: [], questionIds: [], problem }, failure: null };
  };

  // A reply that failed has its own error bubble; there is nothing to read.
  if (result.state !== 'answered') return null;
  if (result.truncated || result.status !== 'complete') return nothing('the reply was cut off', 'Nothing was added to the register: the reply was cut off.');

  try {
    const room = store.getDataRoom(run.turn.workspaceId);
    if (room === null || material.trace === null) return nothing('no data room', 'Nothing was added to the register: there is no data room.');
    const checked = checkProposal(result.text, proposalContextFor(room, material.trace.shown));
    if (checked.parseError !== null) {
      return nothing(checked.parseError, `Nothing was added to the register: the reply held no findings I could read. ${checked.parseError}`);
    }
    const owner = deps.getAgent(result.agentId)?.humanOwner ?? 'Unassigned';
    const saved = store.proposeFindings(run.turn.workspaceId, {
      turnId: run.turn.id,
      agent: { agentId: result.agentId, agentName: result.agentName, agentVersion: result.agentVersion, model: result.model, promptHash: result.promptHash },
      owner,
      findings: checked.checked,
      refused: checked.refused,
    });
    const findingIds = saved.findings.map((finding) => finding.id);
    const questionIds = saved.openQuestions.map((question) => question.id);
    note(summaryNote(findingIds, questionIds));
    return { trace: { findingIds, questionIds, problem: null }, failure: null };
  } catch (error) {
    const correlationId = newId();
    log.error(`[findings] could not write the proposal of turn ${run.turn.id} (correlation ${correlationId}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    note(`The reply could not be added to the register: something went wrong in the app (reference ${correlationId}).`);
    return { trace: { findingIds: [], questionIds: [], problem: 'the register could not be written' }, failure: { code: 'internal', correlationId } };
  }
}

/** The executor of one agent's 1:1 room. */
export function oneToOneExecutor(agentId: AgentId, deps: OneToOneDeps, options: OneToOneOptions = {}): RoomExecutor {
  return async (run): Promise<TurnOutcome> => {
    const { store } = deps;
    const proposing = options.intent === 'propose-findings';
    const route: RouteDecision = { source: 'direct', primary: agentId, secondaries: [], notConsulted: [], notes: [], synthesis: false };
    const material = dataRoomMaterial(store.getDataRoom(run.turn.workspaceId));
    const dataRoom = material.trace === null ? {} : { dataRoom: material.trace };
    const intent = proposing ? { intent: 'propose-findings' as const } : {};
    run.emit({ type: 'route', route });
    store.saveTurnTrace(run.turn.id, { route, agents: [], ...dataRoom, ...intent });

    const history = historyForTurn(store.listMessages(run.thread.id), run.userMessage);
    let result: RunAgentResult | undefined;
    try {
      // Throws AgentUnavailableError before any model call if the agent left the roster;
      // the runner then ends the turn as error with a correlation id.
      result = await runAgent(
        agentId,
        {
          room: 'one-to-one',
          role: 'solo',
          history: history.messages,
          omitted: history.omitted,
          roomContext: material.roomContext,
          instructions: proposing ? [...material.instructions, ...PROPOSE_FINDINGS_INSTRUCTIONS] : material.instructions,
          timeZone: run.timeZone,
          signal: run.signal,
          emit: run.emit,
          ...(proposing ? { maxTokens: PROPOSAL_MAX_TOKENS } : {}),
        },
        deps,
      );
    } finally {
      // Saved whatever happened next, so paid-for text is never lost.
      if (result !== undefined) store.appendAgentMessage(toReplyMessage(run.turn.id, result));
    }

    const proposal = proposing ? proposeFromReply(deps, run, result, material) : null;
    const trace: TurnTrace = { route, agents: [toAgentOutcome(result)], ...dataRoom, ...intent, ...(proposal ? { proposal: proposal.trace } : {}) };
    if (proposal?.failure && result.status === 'complete') {
      return { status: 'partial', trace, errorCode: proposal.failure.code, correlationId: proposal.failure.correlationId };
    }
    return {
      status: TURN_STATUS[result.status],
      trace,
      errorCode: result.errorCode,
      correlationId: result.correlationId,
    };
  };
}
