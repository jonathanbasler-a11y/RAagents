'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { LOCAL_PERSON, type GateDecision, type GateDissent, type GateOption, type GateView } from '@/shared/contracts';
import { GATE_OPTION_LABELS, MAX_DISSENT_ROLE_CHARS, MAX_GATE_REASON_CHARS } from '@/shared/gates';
import { useGates } from './GatesProvider';
import { GATE_STATUS_LABELS } from './labels';

// The gates page: three points of the due diligence where a person decides. The facts and the recommended call are built by
// code from what is in the app (no model); the person may follow the call or not, and gives a reason when not. Every
// decision stays, with the facts as they were shown. A dissent is recorded under a decision and never blocks it. The app
// has no login, so everything is recorded as a local person.

const REASON_PROMPT = 'Give a reason: you chose something other than the recommended call.';
const DISSENT_PROMPT = 'Say which function the dissent speaks for, and give the reason.';

function Facts({ facts }: { facts: GateView['facts'] }) {
  return (
    <dl className="gate-facts">
      {facts.map((fact) => (
        <div key={fact.label} className="gate-fact">
          <dt>{fact.label}</dt>
          <dd>{fact.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function DissentForm({ gate, decisionId }: { gate: GateView['id']; decisionId: string }) {
  const { saving, dissent, saveError } = useGates();
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = saving !== null;
  const mine = attempted && saveError?.kind === 'dissent' && saveError.gate === gate ? saveError : null;

  const submit = () => {
    if (role.trim() === '' || reason.trim() === '') {
      setLocalError(DISSENT_PROMPT);
      return;
    }
    setLocalError(null);
    setAttempted(true);
    void dissent(gate, { decisionId, role: role.trim(), reason: reason.trim() }).then((saved) => {
      if (saved) {
        setRole('');
        setReason('');
      }
    });
  };

  return (
    <details className="gate-dissent-form">
      <summary>Add a dissent</summary>
      <label className="dr-field">
        <span>Function it speaks for</span>
        <input
          className="input"
          aria-label="Function the dissent speaks for"
          placeholder="For example: CMC regulatory agent owner"
          maxLength={MAX_DISSENT_ROLE_CHARS}
          value={role}
          disabled={busy}
          onChange={(event) => setRole(event.target.value)}
        />
      </label>
      <label className="dr-field">
        <span>Reason</span>
        <textarea
          className="input fd-note"
          rows={2}
          aria-label="Reason for the dissent"
          maxLength={MAX_GATE_REASON_CHARS}
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="dr-buttons">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={submit}>
          {busy && saving?.kind === 'dissent' && attempted ? 'Saving…' : 'Record dissent'}
        </button>
      </div>
      {(localError || mine) && (
        <p className="dr-error" role="alert">
          {localError ?? `Not saved: ${mine?.message}`}
          {!localError && mine?.correlationId && <span className="mono"> Reference {mine.correlationId}</span>}
        </p>
      )}
    </details>
  );
}

function DecisionItem({ gate, entry }: { gate: GateView['id']; entry: GateDecision & { dissents: GateDissent[] } }) {
  return (
    <li className="gate-decision" data-decision={entry.id}>
      <p>
        <strong>{`${entry.id} · ${GATE_OPTION_LABELS[entry.option]} · ${entry.createdAt.slice(0, 10)} · ${entry.actor}`}</strong>
      </p>
      <p className="note">
        {entry.option === entry.recommended ? 'Followed the recommended call.' : `Differed from the recommended call (${GATE_OPTION_LABELS[entry.recommended]}).`}
      </p>
      {entry.reason && <p>Reason: {entry.reason}</p>}
      <details>
        <summary>Facts at the time</summary>
        <Facts facts={entry.facts} />
      </details>
      {entry.dissents.map((note) => (
        <p key={note.id} className="gate-dissent">
          {`Dissent from ${note.role}: ${note.reason}`}
        </p>
      ))}
      <DissentForm gate={gate} decisionId={entry.id} />
    </li>
  );
}

function GateCard({ gate }: { gate: GateView }) {
  const { saving, decide, saveError } = useGates();
  const [option, setOption] = useState<GateOption | null>(null);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = saving !== null;
  const needsReason = option !== null && option !== gate.recommended;
  const mine = saveError?.kind === 'decision' && saveError.gate === gate.id ? saveError : null;
  const reasonLabel = needsReason ? 'Reason (required: you chose something other than the recommended call)' : 'Reason (optional)';

  const submit = () => {
    if (option === null) return;
    const text = reason.trim();
    if (needsReason && text === '') {
      setLocalError(REASON_PROMPT);
      return;
    }
    setLocalError(null);
    void decide(gate.id, text === '' ? { option, factsHash: gate.factsHash } : { option, reason: text, factsHash: gate.factsHash });
  };

  return (
    <article className="sheet gate-card" aria-labelledby={`gate-${gate.id}`} data-status={gate.status}>
      <header className="fd-head">
        <h3 id={`gate-${gate.id}`}>{gate.title}</h3>
        <span className={gate.status === 'decided' ? 'badge' : 'badge badge-warn'}>{GATE_STATUS_LABELS[gate.status]}</span>
      </header>
      <p>{gate.question}</p>
      {gate.status === 'outdated' && (
        <p className="note" role="status">
          The facts changed since the latest decision: decide again if it still holds.
        </p>
      )}
      <Facts facts={gate.facts} />
      <p className="gate-call">
        Recommended: <strong>{GATE_OPTION_LABELS[gate.recommended]}</strong>.
      </p>
      <p className="note">{gate.recommendedBecause}</p>
      <p className="note">What would move the call:</p>
      <ul className="gate-change">
        {gate.wouldChange.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <fieldset className="gate-options" disabled={busy}>
        <legend>Your decision</legend>
        {gate.options.map((entry) => (
          <label key={entry.option} className="gate-option">
            <input
              type="radio"
              name={`${gate.id}-option`}
              value={entry.option}
              checked={option === entry.option}
              onChange={() => {
                setOption(entry.option);
                setLocalError(null);
              }}
            />
            <span>
              <strong>{entry.label}</strong>
              {entry.option === gate.recommended ? ' (recommended)' : ''}
            </span>
            <span className="note">{entry.cost}</span>
          </label>
        ))}
      </fieldset>
      <label className="dr-field">
        <span>{reasonLabel}</span>
        <textarea
          className="input fd-note"
          rows={2}
          aria-label={reasonLabel}
          maxLength={MAX_GATE_REASON_CHARS}
          value={reason}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="dr-buttons">
        <button type="button" className="btn btn-primary" disabled={busy || option === null} onClick={submit}>
          {saving?.gate === gate.id && saving.kind === 'decision' ? 'Saving…' : 'Record decision'}
        </button>
      </div>
      {(localError || mine) && (
        <p className="dr-error" role="alert">
          {localError ?? `Not saved: ${mine?.message}`}
          {!localError && mine?.correlationId && <span className="mono"> Reference {mine.correlationId}</span>}
        </p>
      )}
      <h4>Decisions</h4>
      {gate.decisions.length === 0 ? (
        <p className="note">No decision yet.</p>
      ) : (
        <ul className="gate-history">
          {gate.decisions.map((entry) => (
            <DecisionItem key={entry.id} gate={gate.id} entry={entry} />
          ))}
        </ul>
      )}
    </article>
  );
}

/** The gates page's body. */
export function GatesPanel() {
  const gates = useGates();
  const { refresh } = gates;
  // The facts change on the other pages (findings, checklist), so read the gates again when this page opens.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (gates.status === 'unavailable') return null;

  let body: ReactNode;
  if (gates.data === undefined) {
    body =
      gates.status === 'error' ? (
        <p role="alert">
          The gates could not be loaded. {gates.loadError?.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={gates.reload}>
            Retry
          </button>
        </p>
      ) : (
        <p aria-busy="true">Loading the gates…</p>
      );
  } else {
    const { data } = gates;
    body = (
      <>
        <section className="sheet" aria-labelledby="gates-human-title">
          <h2 id="gates-human-title">Only a person decides these</h2>
          <ul>
            {data.alwaysHuman.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="note">{data.disagreementRule}</p>
        </section>
        {/* The key changes when what is true or what is saved changes, so a card starts again from it (a decision, another tab, new facts). */}
        {data.gates.map((gate) => (
          <GateCard key={`${gate.id}|${gate.factsHash}|${gate.status}|${gate.decisions.length}`} gate={gate} />
        ))}
      </>
    );
  }

  return (
    <section className="gates" aria-labelledby="gates-title">
      <div className="screen-head">
        <h1 id="gates-title">Gates</h1>
        <p className="lede">
          Three points of the due diligence where a person decides. The facts and the recommended call are built by code from what is in the app; no model is
          involved. You may follow the call or not: if you do not, you give a reason. Every decision stays, with the facts as they were when you decided.
        </p>
        <p className="note">This app has no login: a decision is recorded as “{LOCAL_PERSON}”.</p>
      </div>
      {body}
    </section>
  );
}
