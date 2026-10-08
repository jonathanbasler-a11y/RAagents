'use client';

import type { PublicAgent } from '@/shared/contracts';
import { useSelection } from './SelectionProvider';

/** "6 of 25 agents selected for this DD." Locked team roles always count. */
export function SelectionSummary({ agents }: { agents: PublicAgent[] }) {
  const selection = useSelection();
  if (selection.status === 'unavailable') return null;

  let content;
  if (selection.selected) {
    const selected = selection.selected;
    const count = agents.filter((agent) => agent.locked || selected.has(agent.id)).length;
    content = (
      <>
        <strong>
          {count} of {agents.length} agents selected for this DD.
        </strong>{' '}
        Team roles are always on. Switch the others on or off below; routing in the team chat only picks selected agents.
      </>
    );
  } else if (selection.status === 'error') {
    content = (
      <>
        The selection could not be loaded.{' '}
        <button type="button" className="btn btn-quiet btn-sm" onClick={selection.reload}>
          Retry
        </button>
      </>
    );
  } else {
    content = 'Loading the selection…';
  }

  return (
    <p className="team-sum" aria-live="polite">
      {content}
    </p>
  );
}
