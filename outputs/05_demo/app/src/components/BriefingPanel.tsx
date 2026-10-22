'use client';

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { chatClient, type ChatApi } from '@/client/chat-client';
import { CHECKLIST_ITEMS, CHECKLIST_STATE_WORDS } from '@/shared/checklist';
import { GATE_DECISIONS_NOTE, gateSentence } from '@/shared/briefing';
import type { Briefing, BriefingFinding, BriefingResponse } from '@/shared/contracts';
import { SOURCE_TYPE_LABELS } from '@/shared/data-room';
import { FINDING_BASIS_WORDS, FINDING_CONFIDENCE_WORDS } from '@/shared/findings';

// The briefing page: what the regulatory lead takes into the cross-functional discussion, built by code from the accepted,
// tagged findings and the checklist (src/shared/briefing.ts). It is not a decision, and no model writes any of it. It is
// built fresh from the register each time it opens, so it always shows the register as it is.

export type BriefingClient = Pick<ChatApi, 'getBriefing'>;

type View = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: BriefingResponse };

const NOT_A_DECISION =
  "This is a briefing, not a decision. Deal-breakers, the overall assessment and the recommendation are reserved for people. Each claim below was drafted by an agent and accepted by a person, and is shown beside the words of the document it rests on. A finding from the seller's own document is what the seller states, not verified fact.";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="bf-section">
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function FindingCard({ entry }: { entry: BriefingFinding }) {
  return (
    <article className="sheet fd-card" aria-labelledby={`bf-${entry.id}`}>
      <header className="fd-head">
        <h3 id={`bf-${entry.id}`} className="mono">
          {entry.id}
        </h3>
        <span className="badge">{entry.checklistItem === null ? 'Not yet tagged' : CHECKLIST_ITEMS[entry.checklistItem].label}</span>
      </header>
      <p className="fd-claim">{entry.claim}</p>
      <blockquote className="fd-quote">{entry.quote}</blockquote>
      <p className="note">
        <span className="mono">{entry.documentId}</span>, {entry.documentTitle} ({SOURCE_TYPE_LABELS[entry.sourceType]}, dated {entry.publishedAt})
      </p>
      <p className="note">
        Basis: {FINDING_BASIS_WORDS[entry.basis]}. Confidence in the quote: {FINDING_CONFIDENCE_WORDS[entry.confidence]}.
      </p>
      {entry.decisionNote && <p className="note">Note from the person who accepted it: {entry.decisionNote}</p>}
      {entry.documentWithdrawn && <p className="note fd-tagline">Its document has been withdrawn from the data room since it was accepted.</p>}
    </article>
  );
}

function FindingsSection({ id, title, findings }: { id: string; title: string; findings: readonly BriefingFinding[] }) {
  return (
    <Section id={id} title={title}>
      {findings.length === 0 ? <p>None accepted and tagged yet.</p> : findings.map((entry) => <FindingCard key={entry.id} entry={entry} />)}
    </Section>
  );
}

function Body({ briefing, generatedAt }: { briefing: Briefing; generatedAt: string }) {
  const ptrs = briefing.checklist.find((row) => row.item === 'ptrs-inputs');
  return (
    <>
      <p className="note">
        {briefing.asOf === null ? 'No data room' : `Data room as of ${briefing.asOf}`} · prepared {generatedAt} from the findings register and the checklist.{' '}
        <a href="/api/briefing?format=markdown" download>
          Download as Markdown
        </a>
      </p>
      <p className="bf-notice">{NOT_A_DECISION}</p>

      <Section id="bf-warnings" title="Before you read">
        {briefing.warnings.length === 0 ? (
          <p>No warnings.</p>
        ) : (
          <ul className="bf-list">
            {briefing.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        )}
      </Section>

      {briefing.gateDecisions.length > 0 && (
        <Section id="bf-gates" title="Gate decisions">
          <p className="note">{GATE_DECISIONS_NOTE}</p>
          <ul className="bf-list">
            {briefing.gateDecisions.map((row) => (
              <li key={row.gate}>
                <strong>{row.title}</strong>: {gateSentence(row)}
                {row.dissents.map((note) => (
                  <p key={`${note.role}|${note.reason}`} className="gate-dissent">
                    Dissent from {note.role}: {note.reason}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="bf-checked" title="What was checked">
        <ul className="bf-list">
          {briefing.checklist.map((row) => (
            <li key={row.item}>
              <strong>{row.label}</strong>: {CHECKLIST_STATE_WORDS[row.state]}.
              {row.reason !== null && ` ${row.state === 'checked' ? 'Note' : 'Reason'}: ${row.reason}${row.reason.endsWith('.') ? '' : '.'}`}
              {row.findingIds.length > 0 && ` Findings: ${row.findingIds.join(', ')}.`}
            </li>
          ))}
        </ul>
        {briefing.documents.length > 0 && (
          <p className="note">
            Documents in the data room:{' '}
            {briefing.documents
              .map((document) => `${document.id} ${document.title} (${SOURCE_TYPE_LABELS[document.sourceType]}${document.provided ? '' : ', listed, not provided'}${document.withdrawn ? ', withdrawn' : ''})`)
              .join('; ')}
            .
          </p>
        )}
      </Section>

      <FindingsSection id="bf-positives" title="Positives" findings={briefing.positives} />
      <FindingsSection id="bf-risks" title="Risks" findings={briefing.risks} />
      <FindingsSection id="bf-neutral" title="Neutral" findings={briefing.neutral} />
      {briefing.unsorted.length > 0 && (
        <Section id="bf-unsorted" title="Not yet sorted">
          <p className="note">Accepted, but nobody has said which checklist item they support or what kind they are.</p>
          {briefing.unsorted.map((entry) => (
            <FindingCard key={entry.id} entry={entry} />
          ))}
        </Section>
      )}

      <Section id="bf-open" title="Open questions">
        {briefing.openQuestions.length === 0 && briefing.couldNotCheck.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul className="bf-list">
            {briefing.openQuestions.map((question) => (
              <li key={question.id}>
                {question.id}: {question.claim} Not a finding: {question.reason}
              </li>
            ))}
            {briefing.couldNotCheck.map((entry) => (
              <li key={entry.item}>
                Could not check: {entry.label}. {entry.reason}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="bf-ptrs" title="Inputs to the regulatory part of PTRS">
        <p>The app computes no number. These are the accepted findings tagged to this item; check that the right information feeds the calculation.</p>
        <p className="note">State of this item: {CHECKLIST_STATE_WORDS[ptrs?.state ?? 'not_checked']}.</p>
        {briefing.ptrsInputs.length === 0 ? (
          <p>No accepted finding is tagged to this item yet.</p>
        ) : (
          <ul className="bf-list">
            {briefing.ptrsInputs.map((entry) => (
              <li key={entry.id}>
                {entry.id}: {entry.claim} ({entry.documentId})
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="bf-mitigations" title="Possible mitigations">
        <p>For the regulatory lead and the functions to add. The app does not draft mitigations.</p>
      </Section>
    </>
  );
}

/** The briefing page's body. */
export function BriefingPanel({ client = chatClient }: { client?: BriefingClient }) {
  const [view, setView] = useState<View>({ status: 'loading' });
  const [request, setRequest] = useState(0);
  const haveBriefing = useRef(false);

  const read = useEffectEvent(() => client.getBriefing());

  useEffect(() => {
    let cancelled = false;
    read().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        haveBriefing.current = true;
        setView({ status: 'ready', data: result.data });
      } else {
        setView({ status: 'error', message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  // Built fresh whenever the tab comes back, so it never shows a register that was changed elsewhere. A failed read keeps what is shown.
  const refresh = useCallback(async () => {
    const result = await client.getBriefing();
    if (result.ok) setView({ status: 'ready', data: result.data });
  }, [client]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  let body: ReactNode;
  if (view.status === 'loading') {
    body = <p aria-busy="true">Loading the briefing…</p>;
  } else if (view.status === 'error') {
    body = (
      <p role="alert">
        The briefing could not be built. {view.message}{' '}
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => {
            setView({ status: 'loading' });
            setRequest((count) => count + 1);
          }}
        >
          Retry
        </button>
      </p>
    );
  } else {
    body = <Body briefing={view.data.briefing} generatedAt={view.data.generatedAt} />;
  }

  return (
    <section className="briefing" aria-labelledby="briefing-title">
      <div className="screen-head">
        <h1 id="briefing-title">Briefing</h1>
        <p className="lede">What the regulatory lead takes into the cross-functional discussion: what was checked, what was found, and what is still open. Built from accepted, tagged findings and the checklist.</p>
      </div>
      {body}
    </section>
  );
}
