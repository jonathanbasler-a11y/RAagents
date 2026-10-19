'use client';

import Link from 'next/link';
import { useChecklist } from './ChecklistProvider';

/** A short card on the DD workspace page: how far the regulatory checklist is, with the states kept apart. */
export function ChecklistSummary() {
  const checklist = useChecklist();
  if (checklist.status === 'unavailable') return null;

  let line: string;
  if (checklist.items === undefined) {
    line = checklist.status === 'error' ? 'The checklist could not be loaded.' : 'Loading the checklist…';
  } else {
    const count = (state: string) => checklist.items?.filter((entry) => entry.state === state).length ?? 0;
    line = `${count('checked')} checked, ${count('not_applicable')} not applicable, ${count('could_not_check')} could not check, ${count('not_checked')} not checked (of ${checklist.items.length}).`;
  }

  return (
    <section className="sheet data-room-card" aria-labelledby="checklist-card-title">
      <div>
        <h2 id="checklist-card-title">Checklist</h2>
        <p aria-busy={checklist.items === undefined && checklist.status === 'loading'}>{line}</p>
      </div>
      <Link className="btn" href="/checklist">
        Open the checklist
      </Link>
    </section>
  );
}
