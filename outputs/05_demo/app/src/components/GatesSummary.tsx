'use client';

import Link from 'next/link';
import { GATE_OPTION_LABELS } from '@/shared/gates';
import { useGates } from './GatesProvider';
import { GATE_STATUS_LABELS } from './labels';

/** A short card on the DD workspace page: the three gates, whether a person has decided each, and what the code recommends. */
export function GatesSummary() {
  const gates = useGates();
  if (gates.status === 'unavailable') return null;

  let body;
  if (gates.data === undefined) {
    body = <p aria-busy={gates.status === 'loading'}>{gates.status === 'error' ? 'The gates could not be loaded.' : 'Loading the gates…'}</p>;
  } else {
    body = (
      <>
        <ul className="gate-summary">
          {gates.data.gates.map((gate) => (
            <li key={gate.id}>{`${gate.title}: ${GATE_STATUS_LABELS[gate.status]} · recommended: ${GATE_OPTION_LABELS[gate.recommended]}.`}</li>
          ))}
        </ul>
        <p className="note">The recommended call is advice, built by code from the facts. A person decides at each.</p>
      </>
    );
  }

  return (
    <section className="sheet data-room-card" aria-labelledby="gates-card-title" aria-label="Gates">
      <div>
        <h2 id="gates-card-title">Gates</h2>
        {body}
      </div>
      <Link className="btn" href="/gates">
        Open the gates
      </Link>
    </section>
  );
}
