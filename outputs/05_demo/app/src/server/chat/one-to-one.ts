import 'server-only';
import type { AgentId, ChatLimits, Message, RouteDecision, Store, TurnTrace } from '@/shared/contracts';
import { runAgent, toAgentOutcome, toReplyMessage, type RunAgentDeps, type RunAgentResult } from './run-agent';
import { toPromptHistory, type PromptHistory } from './store';
import type { RoomExecutor, TurnOutcome } from './turn-runner';

// The 1:1 room: the room's agent answers alone, with the last valid messages of the
// room's active thread as history (the server owns history; the browser sends only the
// question). Runs through runAgent, the one execution path.

export const ONE_TO_ONE_HISTORY_MESSAGES: ChatLimits['oneToOneHistoryMessages'] = 20;

export interface OneToOneDeps extends RunAgentDeps {
  store: Store;
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

/** The executor of one agent's 1:1 room. */
export function oneToOneExecutor(agentId: AgentId, deps: OneToOneDeps): RoomExecutor {
  return async (run): Promise<TurnOutcome> => {
    const { store } = deps;
    const route: RouteDecision = { source: 'direct', primary: agentId, secondaries: [], notConsulted: [], notes: [], synthesis: false };
    run.emit({ type: 'route', route });
    store.saveTurnTrace(run.turn.id, { route, agents: [] });

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
          timeZone: run.timeZone,
          signal: run.signal,
          emit: run.emit,
        },
        deps,
      );
    } finally {
      // Saved whatever happened next, so paid-for text is never lost.
      if (result !== undefined) store.appendAgentMessage(toReplyMessage(run.turn.id, result));
    }

    const trace: TurnTrace = { route, agents: [toAgentOutcome(result)] };
    return {
      status: TURN_STATUS[result.status],
      trace,
      errorCode: result.errorCode,
      correlationId: result.correlationId,
    };
  };
}
