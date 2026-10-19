'use client';

import Link from 'next/link';
import { useFindings } from './FindingsProvider';

/** A short card on the DD workspace page: how many drafts wait for a person, how many were decided. */
export function FindingsSummary() {
  const register = useFindings();
  if (register.status === 'unavailable') return null;

  let line: string;
  if (register.findings === undefined || register.openQuestions === undefined) {
    line = register.status === 'error' ? 'The findings could not be loaded.' : 'Loading the findings…';
  } else {
    const drafts = register.findings.filter((finding) => finding.status === 'draft').length;
    const decided = register.findings.length - drafts;
    const questions = register.openQuestions.length;
    line =
      register.findings.length === 0 && questions === 0
        ? 'No findings yet. An agent drafts them from the data room when you ask in its room; a person accepts or rejects each one.'
        : `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} waiting for a person, ${decided} decided, ${questions} open ${questions === 1 ? 'question' : 'questions'}.`;
  }

  return (
    <section className="sheet data-room-card" aria-labelledby="findings-card-title">
      <div>
        <h2 id="findings-card-title">Findings</h2>
        <p aria-busy={register.findings === undefined && register.status === 'loading'}>{line}</p>
      </div>
      <Link className="btn" href="/findings">
        Open the findings
      </Link>
    </section>
  );
}
