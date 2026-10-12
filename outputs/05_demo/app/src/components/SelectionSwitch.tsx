'use client';

import type { PublicAgent } from '@/shared/contracts';
import { useSelection } from './SelectionProvider';

/**
 * "Selected for this DD" for one agent. Locked team roles show "Always on". While the
 * saved selection is unknown, no switch is shown: unknown is never shown as off.
 */
export function SelectionSwitch({ agent }: { agent: PublicAgent }) {
  const selection = useSelection();

  if (agent.locked) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked="true"
        aria-disabled="true"
        className="switch"
        aria-label={`${agent.name}: always on for this DD`}
      >
        <span className="track" aria-hidden="true" />
        Always on
      </button>
    );
  }

  if (selection.status === 'unavailable') return null;

  if (selection.status === 'error' && !selection.selected) {
    return (
      <span className="switch-unknown">
        Selection unavailable.{' '}
        <button type="button" className="btn btn-quiet btn-sm" onClick={selection.reload}>
          Retry
        </button>
      </span>
    );
  }

  if (!selection.selected) {
    return (
      <span className="switch-unknown" aria-busy="true">
        Loading selection…
      </span>
    );
  }

  const on = selection.selected.has(agent.id);
  const saving = selection.saving.has(agent.id);
  const problem = selection.saveErrors[agent.id];

  return (
    <span className="switch-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-busy={saving}
        disabled={saving}
        className="switch"
        aria-label={`${agent.name}: selected for this DD`}
        onClick={() => void selection.setSelected(agent.id, !on)}
      >
        <span className="track" aria-hidden="true" />
        Selected for this DD
      </button>
      {problem && (
        <span className="switch-error" role="alert">
          Not saved: {problem.message}
          {problem.correlationId && <span className="mono"> Reference {problem.correlationId}</span>}
        </span>
      )}
    </span>
  );
}
