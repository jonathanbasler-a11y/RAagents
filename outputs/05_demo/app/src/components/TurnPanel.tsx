'use client';

import type { SyntheticEvent } from 'react';
import type { AgentOutcome, Turn } from '@/shared/contracts';
import {
  AGENT_STATE_LABELS,
  NOT_CONSULTED_LABELS,
  ROLE_LABELS,
  ROUTE_SOURCE_LABELS,
  TURN_STATUS_LABELS,
  describeChatError,
  formatDuration,
} from './labels';

function turnDurationMs(turn: Turn): number | null {
  if (!turn.finishedAt) return null;
  const ms = Date.parse(turn.finishedAt) - Date.parse(turn.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * The models the gateway reported. With none reported, "no model call" is said only when it
 * is known: the turn finished and no agent was consulted. A call that failed, timed out or
 * was cut by a restart reported no model, but it may well have run.
 */
function modelText(turn: Turn, models: readonly string[]): string {
  if (models.length > 0) return models.join(', ');
  const outcomes = turn.trace?.agents ?? [];
  const noneConsulted = outcomes.length > 0 && outcomes.every((outcome) => outcome.state === 'not_consulted');
  return noneConsulted && turn.status !== 'interrupted' ? 'no model call' : 'not reported (no call completed)';
}

function stateText(outcome: AgentOutcome): string {
  if (outcome.state === 'not_consulted') {
    return outcome.reason ? NOT_CONSULTED_LABELS[outcome.reason] : AGENT_STATE_LABELS.not_consulted;
  }
  const label = AGENT_STATE_LABELS[outcome.state];
  if ((outcome.state === 'failed' || outcome.state === 'out_of_time') && outcome.errorCode) {
    return `${label}: ${describeChatError(outcome.errorCode).text}`;
  }
  return outcome.truncated ? `${label} (cut off)` : label;
}

/** An opened panel would mostly sit below the visible log: scroll just enough to show all of it. */
function showWhenOpened(event: SyntheticEvent<HTMLDetailsElement>) {
  if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: 'nearest' });
}

/**
 * "How this turn ran": rendered by code from the turn's stored trace (route_json), never
 * from model text. Collapsed by default.
 */
export function TurnPanel({ turn }: { turn: Turn }) {
  const trace = turn.trace;
  const durationMs = turnDurationMs(turn);
  const duration = durationMs === null ? 'not finished' : formatDuration(durationMs);
  const models = [...new Set((trace?.agents ?? []).map((outcome) => outcome.model).filter((model): model is string => !!model))];
  const nameOf = (agentId: string) => trace?.agents.find((outcome) => outcome.agentId === agentId)?.agentName ?? agentId;
  const matched = Object.entries(trace?.route.matchedTerms ?? {}).filter(([, terms]) => terms.length > 0);

  return (
    <details className="turn-panel" onToggle={showWhenOpened}>
      <summary>
        How this turn ran
        <span className="turn-panel-sum mono">
          {' '}
          · {TURN_STATUS_LABELS[turn.status]} · {duration}
        </span>
      </summary>
      <dl className="turn-facts">
        <dt>Status</dt>
        <dd>{TURN_STATUS_LABELS[turn.status]}</dd>
        {trace && (
          <>
            <dt>Route</dt>
            <dd>{ROUTE_SOURCE_LABELS[trace.route.source]}</dd>
          </>
        )}
        <dt>Model</dt>
        <dd className="mono">{modelText(turn, models)}</dd>
        <dt>Duration</dt>
        <dd className="mono">{duration}</dd>
        {turn.correlationId && (
          <>
            <dt>Reference</dt>
            <dd className="mono">{turn.correlationId}</dd>
          </>
        )}
      </dl>
      {trace && trace.agents.length > 0 && (
        <table className="turn-agents">
          <caption className="visually-hidden">Agents in this turn</caption>
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Part</th>
              <th scope="col">State</th>
              <th scope="col">Model</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {trace.agents.map((outcome) => (
              <tr key={`${outcome.agentId}-${outcome.role}`} className={`state-${outcome.state}`}>
                <th scope="row">{outcome.agentName}</th>
                <td>{outcome.state === 'not_consulted' ? '–' : ROLE_LABELS[outcome.role]}</td>
                <td>{stateText(outcome)}</td>
                <td className="mono">{outcome.model ?? '–'}</td>
                <td className="mono">{outcome.durationMs === undefined ? '–' : formatDuration(outcome.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {matched.length > 0 && (
        <p className="note">
          Matched terms: {matched.map(([agentId, terms]) => `${nameOf(agentId)}: ${terms.join(', ')}`).join(' · ')}
        </p>
      )}
      {trace && trace.route.notes.length > 0 && (
        <ul className="turn-notes">
          {trace.route.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
