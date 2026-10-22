'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicAgent } from '@/shared/contracts';
import { useSelection } from './SelectionProvider';
import { useAgentSwitch } from './use-agent-switch';

function OfferRow({ agent }: { agent: PublicAgent }) {
  const control = useAgentSwitch(agent);
  /** Whether this offer is the one that was clicked: only it says "Added" and shows a failed save. */
  const [clicked, setClicked] = useState(false);
  const confirmation = useRef<HTMLSpanElement>(null);
  const added = clicked && control.kind === 'ready' && control.on;

  // The button is replaced by the confirmation: keep a keyboard user's place instead of dropping focus to the page.
  useEffect(() => {
    if (added && document.activeElement === document.body) confirmation.current?.focus();
  }, [added]);

  if (control.kind !== 'ready') return null;

  return (
    <li className="offer-row">
      {control.on ? (
        <span ref={confirmation} tabIndex={-1} className="offer-on">
          {added ? `Added: ${agent.name} can join from your next question.` : `${agent.name} is on the team.`}
        </span>
      ) : (
        <button
          type="button"
          className="btn btn-sm"
          aria-busy={control.saving}
          disabled={control.disabled}
          onClick={() => {
            setClicked(true);
            control.set(true);
          }}
        >
          Add {agent.name}
        </button>
      )}
      {clicked && control.problem && (
        <span className="switch-error" role="alert">
          Not saved: {control.problem.message}
          {control.problem.correlationId && <span className="mono"> Reference {control.problem.correlationId}</span>}
        </span>
      )}
    </li>
  );
}

/**
 * Under the notes about agents who are not selected for this DD: a button to add each of them.
 * Adding saves the same selection as the team overview does. Being selected makes an agent eligible
 * from the next question; it does not promise they answer (that depends on mentions and routing).
 * Every offer for an agent shows the current state ("is on the team"); only the offer that was
 * clicked says "Added" and shows a failed save. Locked team roles are never offered. While the
 * selection is unknown no button is shown.
 */
export function AddAgentOffer({ agents }: { agents: PublicAgent[] }) {
  const selection = useSelection();
  const offered = agents.filter((agent) => !agent.locked);
  if (selection.status === 'unavailable' || offered.length === 0) return null;

  if (!selection.selected) {
    return (
      <div className="offer" role="group" aria-label="Add agents to this DD">
        {selection.status === 'error' ? (
          <span className="switch-unknown">
            Selection unavailable.{' '}
            <button type="button" className="btn btn-quiet btn-sm" onClick={selection.reload}>
              Retry
            </button>
          </span>
        ) : (
          <span className="switch-unknown" aria-busy="true">
            Loading selection…
          </span>
        )}
      </div>
    );
  }

  return (
    <ul className="offer" aria-label="Add agents to this DD">
      {offered.map((agent) => (
        <OfferRow key={agent.id} agent={agent} />
      ))}
    </ul>
  );
}
