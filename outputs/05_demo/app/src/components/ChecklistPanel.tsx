'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CHECKLIST_STATES, LOCAL_PERSON, type ChecklistState } from '@/shared/contracts';
import { CHECKLIST_ITEMS, MAX_STATE_REASON_CHARS } from '@/shared/checklist';
import { useChecklist, type ChecklistItemView } from './ChecklistProvider';
import { CHECKLIST_STATE_LABELS } from './labels';

// The checklist page: the regulatory checklist of the DD playbook. Every item is in exactly one of four states. A person
// sets them (the app has no login, so the change is stamped as a local person); "checked" needs an accepted finding
// tagged to the item, and the two states that say the usual check did not happen need a reason.

const NEEDS_REASON: ReadonlySet<ChecklistState> = new Set(['not_applicable', 'could_not_check']);

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function ItemCard({ entry }: { entry: ChecklistItemView }) {
  const { saving, set, saveError } = useChecklist();
  const [state, setState] = useState<ChecklistState>(entry.state);
  const [reason, setReason] = useState(entry.reason ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = saving !== null;
  const mine = saveError?.item === entry.item ? saveError : null;
  const meta = CHECKLIST_ITEMS[entry.item];
  const needsReason = NEEDS_REASON.has(state);
  const changed = state !== entry.state || (needsReason || state === 'checked' ? reason.trim() !== (entry.reason ?? '') : false);

  const save = () => {
    if (needsReason && reason.trim() === '') {
      setLocalError('Give the reason: one short sentence on why it does not apply, or why it could not be checked.');
      return;
    }
    setLocalError(null);
    void set(entry.item, state, state === 'not_checked' ? undefined : reason.trim());
  };

  return (
    <article className="sheet cl-card" aria-labelledby={`cl-${entry.item}`} data-state={entry.state}>
      <header className="fd-head">
        <h3 id={`cl-${entry.item}`}>{meta.label}</h3>
        <span className={entry.state === 'not_checked' ? 'badge badge-warn' : 'badge'}>{CHECKLIST_STATE_LABELS[entry.state]}</span>
      </header>
      <p className="note">{meta.hint}</p>
      <p className="note">
        {plural(entry.acceptedFindings, 'accepted finding is', 'accepted findings are')} tagged to this item.
        {entry.reason && <> Reason: {entry.reason}</>}
        {entry.changedAt && (
          <>
            {' '}
            Last changed by {entry.changedBy ?? LOCAL_PERSON} on {entry.changedAt.slice(0, 10)}.
          </>
        )}
      </p>
      <div className="cl-controls">
        <label className="dr-field">
          <span>State</span>
          <select
            className="input"
            aria-label={`State of ${meta.label}`}
            value={state}
            disabled={busy}
            onChange={(event) => {
              setState(event.target.value as ChecklistState);
              setLocalError(null);
            }}
          >
            {CHECKLIST_STATES.map((option) => (
              <option key={option} value={option} disabled={option === 'checked' && entry.acceptedFindings < 1}>
                {CHECKLIST_STATE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        {(needsReason || state === 'checked') && (
          <label className="dr-field">
            <span>{needsReason ? 'Reason (required)' : 'Note (optional)'}</span>
            <textarea
              className="input fd-note"
              rows={2}
              maxLength={MAX_STATE_REASON_CHARS}
              aria-label={`Reason for ${meta.label}`}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        <div className="dr-buttons">
          <button type="button" className="btn btn-primary" disabled={busy || !changed} aria-label={`Save ${meta.label}`} onClick={save}>
            {saving === entry.item ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {entry.acceptedFindings < 1 && (
        <p className="note">“Checked” is available once an accepted finding is tagged to this item (accept one on the Findings page).</p>
      )}
      {(localError || mine) && (
        <p className="dr-error" role="alert">
          {localError ?? `Not saved: ${mine?.message}`}
          {!localError && mine?.correlationId && <span className="mono"> Reference {mine.correlationId}</span>}
        </p>
      )}
    </article>
  );
}

/** The checklist page's body. */
export function ChecklistPanel() {
  const checklist = useChecklist();
  const { refresh } = checklist;
  // The accepted findings behind an item change on the Findings page, so read the checklist again when this page opens.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (checklist.status === 'unavailable') return null;

  let body: ReactNode;
  if (checklist.items === undefined) {
    body =
      checklist.status === 'error' ? (
        <p role="alert">
          The checklist could not be loaded. {checklist.loadError?.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={checklist.reload}>
            Retry
          </button>
        </p>
      ) : (
        <p aria-busy="true">Loading the checklist…</p>
      );
  } else {
    const count = (state: ChecklistState) => checklist.items?.filter((entry) => entry.state === state).length ?? 0;
    body = (
      <>
        <p className="note" aria-live="polite">
          {count('checked')} checked · {count('not_applicable')} checked: not applicable · {count('could_not_check')} could not check ·{' '}
          {count('not_checked')} not checked
        </p>
        {/* The key changes when what is saved changes, so a card starts again from what the server holds (another tab, a save). */}
        {checklist.items.map((entry) => (
          <ItemCard key={`${entry.item}|${entry.state}|${entry.reason ?? ''}|${entry.changedAt ?? ''}`} entry={entry} />
        ))}
      </>
    );
  }

  return (
    <section className="checklist" aria-labelledby="checklist-title">
      <div className="screen-head">
        <h1 id="checklist-title">Checklist</h1>
        <p className="lede">
          The regulatory checklist of the due diligence. Every item is in one of four states, so that nothing is skipped silently: not checked, checked, checked:
          not applicable, or could not check. “Checked” needs at least one accepted finding tagged to the item; the other two need a reason.
        </p>
        <p className="note">This app has no login: a change is recorded as “{LOCAL_PERSON}”.</p>
      </div>
      {body}
    </section>
  );
}
