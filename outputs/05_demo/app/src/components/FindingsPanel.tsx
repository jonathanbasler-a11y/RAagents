'use client';

import { useState, type ReactNode } from 'react';
import type { Finding, FindingTag, OpenQuestion } from '@/shared/contracts';
import { LOCAL_PERSON } from '@/shared/contracts';
import { CHECKLIST_ITEMS } from '@/shared/checklist';
import { SOURCE_TYPE_LABELS } from '@/shared/data-room';
import { useDataRoom } from './DataRoomProvider';
import { useFindings } from './FindingsProvider';
import { FINDING_BASIS_LABELS, FINDING_CATEGORY_LABELS, FINDING_CONFIDENCE_LABELS, FINDING_STATUS_LABELS } from './labels';
import { isCompleteChoice, NO_CHOICE, TagPicker, type TagChoice } from './TagPicker';
import { useSignedIn } from './SignIn';

// The findings page: what the agents drafted from the data room, and what a person decided. An agent proposes; code has
// already checked that the quote is in a document the agent was shown; only the buttons here change a status. The app has
// no login, so the page says the decision is recorded as a local, unauthenticated person.

const NOTE_MAX = 300;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function when(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 10);
}

function Decision({ finding, withdrawn }: { finding: Finding; withdrawn: boolean }) {
  const { deciding, decide, decideError } = useFindings();
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState<TagChoice>(NO_CHOICE);
  const busy = deciding !== null;
  const mine = decideError?.findingId === finding.id ? decideError : null;
  const noteId = `fd-note-${finding.id}`;

  return (
    <div className="fd-decision">
      {withdrawn && (
        <p className="note" role="note">
          Its document was withdrawn from the data room, so it cannot be accepted. You can still reject it.
        </p>
      )}
      <label className="dr-field" htmlFor={noteId}>
        <span>Note (optional)</span>
        <textarea
          id={noteId}
          className="input fd-note"
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <TagPicker findingId={finding.id} choice={choice} onChange={setChoice} disabled={busy} />
      {!isCompleteChoice(choice) && (
        <p className="note" aria-live="polite">
          To accept, choose the checklist item it supports and whether it is a positive, a risk or neutral.
        </p>
      )}
      <div className="dr-buttons">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || withdrawn || !isCompleteChoice(choice)}
          aria-label={`Accept ${finding.id}`}
          onClick={() => {
            if (isCompleteChoice(choice)) void decide(finding.id, 'accept', note.trim(), { checklistItem: choice.item, category: choice.category });
          }}
        >
          {deciding === finding.id ? 'Saving…' : 'Accept'}
        </button>
        <button type="button" className="btn" disabled={busy} aria-label={`Reject ${finding.id}`} onClick={() => void decide(finding.id, 'reject', note.trim())}>
          Reject
        </button>
      </div>
      {mine && (
        <p className="dr-error" role="alert">
          Not saved: {mine.message}
          {mine.correlationId && <span className="mono"> Reference {mine.correlationId}</span>}
        </p>
      )}
    </div>
  );
}

/** An accepted finding with no tag: the person can still say what it supports. */
function LateTag({ finding }: { finding: Finding }) {
  const { deciding, tag, decideError } = useFindings();
  const [choice, setChoice] = useState<TagChoice>(NO_CHOICE);
  const busy = deciding !== null;
  const mine = decideError?.findingId === finding.id ? decideError : null;
  return (
    <div className="fd-decision">
      <p className="note">Not tagged yet: it counts for no checklist item and is not sorted into the briefing.</p>
      <TagPicker findingId={finding.id} choice={choice} onChange={setChoice} disabled={busy} />
      <div className="dr-buttons">
        <button
          type="button"
          className="btn"
          disabled={busy || !isCompleteChoice(choice)}
          aria-label={`Save tag for ${finding.id}`}
          onClick={() => {
            if (isCompleteChoice(choice)) void tag(finding.id, { checklistItem: choice.item, category: choice.category });
          }}
        >
          {deciding === finding.id ? 'Saving…' : 'Save tag'}
        </button>
      </div>
      {mine && (
        <p className="dr-error" role="alert">
          Not saved: {mine.message}
          {mine.correlationId && <span className="mono"> Reference {mine.correlationId}</span>}
        </p>
      )}
    </div>
  );
}

function FindingCard({ finding, withdrawn, tag }: { finding: Finding; withdrawn: boolean; tag: FindingTag | undefined }) {
  const decided = finding.status !== 'draft';
  return (
    <article className="sheet fd-card" aria-labelledby={`fd-${finding.id}`} data-status={finding.status}>
      <header className="fd-head">
        <h3 id={`fd-${finding.id}`} className="mono">
          {finding.id}
        </h3>
        <span className={finding.status === 'draft' ? 'badge badge-warn' : 'badge'}>{FINDING_STATUS_LABELS[finding.status]}</span>
        <span className="badge">{FINDING_BASIS_LABELS[finding.basis]}</span>
      </header>
      <p className="fd-claim">{finding.claim}</p>
      <blockquote className="fd-quote">{finding.quote}</blockquote>
      <p className="note">
        <span className="mono">{finding.documentId}</span>, {finding.documentTitle} ({SOURCE_TYPE_LABELS[finding.sourceType]}, dated {finding.publishedAt}
        ; data room as of {finding.asOf})
        {withdrawn && <> · document withdrawn</>}
      </p>
      <p className="note">
        Confidence in the quote: {FINDING_CONFIDENCE_LABELS[finding.confidence]}. {finding.confidenceReason}
      </p>
      {finding.assumptions.length > 0 && (
        <div className="note">
          Assumes:
          <ul className="fd-assumptions">
            {finding.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="note">
        Drafted by {finding.draftedBy.agentName} (version {finding.draftedBy.agentVersion}); agent output, not evidence. Human owner: {finding.owner}.
      </p>
      {decided ? (
        <>
          <p className="fd-stamp">
            {finding.status === 'accepted' ? 'Accepted' : 'Rejected'} by {finding.decidedBy ?? 'someone not recorded'} on {when(finding.decidedAt)}.
            {finding.decisionNote && <> Note: {finding.decisionNote}</>}
          </p>
          {finding.status === 'accepted' &&
            (tag ? (
              <p className="note fd-tagline">
                Supports: {CHECKLIST_ITEMS[tag.checklistItem].label} · {FINDING_CATEGORY_LABELS[tag.category]}
              </p>
            ) : (
              <LateTag finding={finding} />
            ))}
        </>
      ) : (
        <Decision finding={finding} withdrawn={withdrawn} />
      )}
    </article>
  );
}

function QuestionRow({ question }: { question: OpenQuestion }) {
  return (
    <li className="fd-question">
      <span className="mono">{question.id}</span> {question.claim}
      <span className="note">
        {' '}
        Not a finding: {question.reason} Raised by {question.raisedBy.agentName}.
      </span>
    </li>
  );
}

/** The findings page's body. */
export function FindingsPanel() {
  const register = useFindings();
  const dataRoom = useDataRoom();
  const signedIn = useSignedIn();
  if (register.status === 'unavailable') return null;

  const tagOf = new Map((register.tags ?? []).map((entry) => [entry.findingId, entry]));
  const withdrawnIds = new Set((dataRoom.dataRoom?.documents ?? []).filter((document) => document.withdrawnAt !== null).map((document) => document.id));

  let body: ReactNode;
  if (register.findings === undefined || register.openQuestions === undefined) {
    body =
      register.status === 'error' ? (
        <p role="alert">
          The findings could not be loaded. {register.loadError?.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={register.reload}>
            Retry
          </button>
        </p>
      ) : (
        <p aria-busy="true">Loading the findings…</p>
      );
  } else {
    const { findings, openQuestions } = register;
    const drafts = findings.filter((finding) => finding.status === 'draft');
    const decided = findings.filter((finding) => finding.status !== 'draft');
    body = (
      <>
        <p className="note" aria-live="polite">
          {plural(drafts.length, 'draft', 'drafts')} waiting for a person · {plural(decided.length, 'decided finding', 'decided findings')} ·{' '}
          {plural(openQuestions.length, 'open question', 'open questions')}
        </p>
        {findings.length === 0 && openQuestions.length === 0 && (
          <p>
            Nothing yet. Open an agent’s room, ask a question about the data room, then use “Propose findings from this answer”. Nothing
            appears here until you do.
          </p>
        )}
        {drafts.length > 0 && (
          <section aria-labelledby="fd-drafts-title">
            <h2 id="fd-drafts-title">Drafts waiting for a person</h2>
            {drafts.map((finding) => (
              <FindingCard key={finding.id} finding={finding} withdrawn={withdrawnIds.has(finding.documentId)} tag={tagOf.get(finding.id)} />
            ))}
          </section>
        )}
        {decided.length > 0 && (
          <section aria-labelledby="fd-decided-title">
            <h2 id="fd-decided-title">Decided</h2>
            {decided.map((finding) => (
              <FindingCard key={finding.id} finding={finding} withdrawn={withdrawnIds.has(finding.documentId)} tag={tagOf.get(finding.id)} />
            ))}
          </section>
        )}
        {openQuestions.length > 0 && (
          <section aria-labelledby="fd-questions-title">
            <h2 id="fd-questions-title">Open questions</h2>
            <p className="note">Claims that no document in the data room supports, or that the checks refused. They are not findings and not evidence.</p>
            <ul className="fd-questions">
              {openQuestions.map((question) => (
                <QuestionRow key={question.id} question={question} />
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <section className="findings" aria-labelledby="findings-title">
      <div className="screen-head">
        <h1 id="findings-title">Findings</h1>
        <p className="lede">
          What the agents drafted from the data room. An agent proposes; code checks that each quote is word for word in a document the agent was
          shown; a person accepts or rejects. A draft is not a finding until a person accepts it, and a finding says only what its document says.
          For a seller’s own document, that is what the seller states.
        </p>
        {signedIn ? (
          <p className="note">A decision is still recorded as “{LOCAL_PERSON}”, not under your name; names on decisions come in a later step.</p>
        ) : (
          <p className="note">This app has no login: a decision is recorded as “{LOCAL_PERSON}”.</p>
        )}
      </div>
      {body}
    </section>
  );
}
