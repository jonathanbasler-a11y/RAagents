'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { DOCUMENT_SOURCE_TYPES, type DataRoomDocumentSummary, type DocumentSourceType } from '@/shared/contracts';
import { SOURCE_TYPE_LABELS, checkAsOf, checkNewDocument, planTurn } from '@/shared/data-room';
import { useDataRoom, type DataRoomProblem } from './DataRoomProvider';
import { DOCUMENT_STATE_LABELS } from './labels';

// The data room page: start a room, read the documents the agents work from, add one, withdraw one. Every action
// is the person's; the agents cannot change the room. A document cannot be edited (withdraw it and add it again).

const todayUtc = () => new Date().toISOString().slice(0, 10);

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Problem({ problem }: { problem: DataRoomProblem }) {
  return (
    <p className="dr-error" role="alert">
      Not saved: {problem.message}
      {problem.correlationId && <span className="mono"> Reference {problem.correlationId}</span>}
    </p>
  );
}

function StartChoices({ today }: { today: string }) {
  const room = useDataRoom();
  const [asOf, setAsOf] = useState(today);
  const [localError, setLocalError] = useState<string | null>(null);

  const startEmpty = () => {
    const checked = checkAsOf(asOf);
    if (!checked.ok) {
      setLocalError(checked.message);
      return;
    }
    setLocalError(null);
    void room.start({ asOf: checked.asOf });
  };

  return (
    <div className="dr-choices">
      <section className="sheet" aria-labelledby="dr-practice-title">
        <h2 id="dr-practice-title">The fictional practice case</h2>
        <p>
          An invented licensing data room for a made-up asset, written for practice. Nothing in it is real. Start here to try the
          team on documents.
        </p>
        <button type="button" className="btn btn-primary" disabled={!room.practiceAvailable || room.saving} onClick={() => void room.start({ practice: true })}>
          Load the practice data room
        </button>
        {!room.practiceAvailable && <p className="note">The practice case is not installed here.</p>}
      </section>
      <section className="sheet" aria-labelledby="dr-empty-title">
        <h2 id="dr-empty-title">An empty data room</h2>
        <p>Start with no documents and add your own. No document dated after the as-of date can be added, and the agents never see one. You cannot change the date later.</p>
        <label className="dr-field">
          <span>As-of date</span>
          <input className="input" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </label>
        <button type="button" className="btn" disabled={room.saving} onClick={startEmpty}>
          Start an empty data room
        </button>
        {localError && (
          <p className="dr-error" role="alert">
            {localError}
          </p>
        )}
      </section>
    </div>
  );
}

type Viewer = { id: string; state: 'loading' | 'ready' | 'error'; text?: string };

function DocumentRows({ documents, asOf, turnChars }: { documents: DataRoomDocumentSummary[]; asOf: string; turnChars: number }) {
  const room = useDataRoom();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ id: string; reason: string; error: string | null } | null>(null);

  const states = new Map(
    planTurn(
      documents.map((document) => ({
        id: document.id,
        provided: document.provided,
        publishedAt: document.publishedAt,
        withdrawn: document.withdrawnAt !== null,
        size: document.chars,
      })),
      asOf,
      turnChars,
    ).map((entry) => [entry.id, entry.state]),
  );

  const read = async (id: string) => {
    setWithdrawing(null);
    setViewer({ id, state: 'loading' });
    const result = await room.loadDocument(id);
    setViewer((current) =>
      current?.id !== id ? current : result.ok ? { id, state: 'ready', text: result.data.document.text ?? '' } : { id, state: 'error' },
    );
  };

  const confirmWithdrawal = async () => {
    if (withdrawing === null) return;
    const reason = withdrawing.reason.trim();
    if (reason === '') {
      setWithdrawing({ ...withdrawing, error: 'Give the reason for withdrawing it: one short sentence.' });
      return;
    }
    if (await room.withdraw(withdrawing.id, reason)) setWithdrawing(null);
  };

  return (
    <table className="dr-table">
      <thead>
        <tr>
          <th scope="col">Id</th>
          <th scope="col">Title</th>
          <th scope="col">Source</th>
          <th scope="col">Dated</th>
          <th scope="col">Size</th>
          <th scope="col">Agents</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => {
          const state = states.get(document.id) ?? 'shown';
          const withdrawn = document.withdrawnAt !== null;
          return [
            <tr key={document.id} className={withdrawn ? 'is-withdrawn' : undefined}>
              <th scope="row" className="mono">
                {document.id}
              </th>
              <td>
                {document.title}
                {document.url && <span className="note dr-url"> {document.url}</span>}
              </td>
              <td>{SOURCE_TYPE_LABELS[document.sourceType]}</td>
              <td>{document.publishedAt ?? '—'}</td>
              <td>{document.provided ? `${document.chars.toLocaleString('en')} characters` : '—'}</td>
              <td>
                <span className={state === 'shown' ? 'tag' : 'tag tag-planned'}>{DOCUMENT_STATE_LABELS[state]}</span>
                {withdrawn && <span className="note dr-reason"> Reason: {document.withdrawnReason}</span>}
              </td>
              <td className="dr-actions">
                {document.provided && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-label={viewer?.id === document.id ? `Close ${document.id}` : `Read ${document.id}`}
                    onClick={() => (viewer?.id === document.id ? setViewer(null) : void read(document.id))}
                  >
                    {viewer?.id === document.id ? 'Close' : 'Read'}
                  </button>
                )}
                {!withdrawn && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    aria-label={`Withdraw ${document.id}`}
                    onClick={() => {
                      setViewer(null);
                      setWithdrawing({ id: document.id, reason: '', error: null });
                    }}
                  >
                    Withdraw
                  </button>
                )}
              </td>
            </tr>,
            viewer?.id === document.id && (
              <tr key={`${document.id}-text`} className="dr-detail">
                <td colSpan={7}>
                  {viewer.state === 'loading' && <p aria-busy="true">Loading the text…</p>}
                  {viewer.state === 'error' && <p role="status">The text of {document.id} could not be read. Try again.</p>}
                  {viewer.state === 'ready' && <pre className="dr-text">{viewer.text}</pre>}
                </td>
              </tr>
            ),
            withdrawing?.id === document.id && (
              <tr key={`${document.id}-withdraw`} className="dr-detail">
                <td colSpan={7}>
                  <label className="dr-field">
                    <span>Why is {document.id} being withdrawn?</span>
                    <input
                      className="input"
                      type="text"
                      maxLength={300}
                      value={withdrawing.reason}
                      onChange={(event) => setWithdrawing({ ...withdrawing, reason: event.target.value, error: null })}
                    />
                  </label>
                  <p className="note">The agents stop seeing it at once. The document and your reason stay in the list, and it cannot be put back: add it again if needed.</p>
                  <div className="dr-buttons">
                    <button type="button" className="btn btn-sm" aria-label={`Confirm withdrawal of ${document.id}`} disabled={room.saving} onClick={() => void confirmWithdrawal()}>
                      Withdraw {document.id}
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" aria-label={`Cancel withdrawal of ${document.id}`} onClick={() => setWithdrawing(null)}>
                      Cancel
                    </button>
                  </div>
                  {withdrawing.error && (
                    <p className="dr-error" role="alert">
                      {withdrawing.error}
                    </p>
                  )}
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

function AddDocumentForm({ asOf, documentChars }: { asOf: string; documentChars: number }) {
  const room = useDataRoom();
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<DocumentSourceType>('company-disclosure');
  const [publishedAt, setPublishedAt] = useState('');
  const [url, setUrl] = useState('');
  const [notProvided, setNotProvided] = useState(false);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request = {
      title,
      sourceType,
      publishedAt: notProvided || publishedAt === '' ? null : publishedAt,
      url: url.trim() === '' ? null : url.trim(),
      provided: !notProvided,
      text: notProvided ? null : text,
    };
    const checked = checkNewDocument(request, asOf);
    if (!checked.ok) {
      setFormError(checked.message);
      return;
    }
    setFormError(null);
    if (await room.add(request)) {
      setTitle('');
      setPublishedAt('');
      setUrl('');
      setNotProvided(false);
      setText('');
    }
  };

  return (
    // noValidate: the browser would stop a late date or a bad address with its own tooltip; the rules of the data room say it in words.
    <form className="sheet dr-form" noValidate onSubmit={(event) => void submit(event)} aria-labelledby="dr-add-title">
      <h2 id="dr-add-title">Add a document</h2>
      <p className="note">Paste the text of one document. It cannot be edited afterwards: withdraw it and add it again.</p>
      <div className="dr-form-grid">
        <label className="dr-field">
          <span>Title</span>
          <input className="input" type="text" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="dr-field">
          <span>Source</span>
          <select className="input" value={sourceType} onChange={(event) => setSourceType(event.target.value as DocumentSourceType)}>
            {DOCUMENT_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="dr-field">
          <span>Dated</span>
          <input className="input" type="date" max={asOf} value={publishedAt} disabled={notProvided} onChange={(event) => setPublishedAt(event.target.value)} />
        </label>
        <label className="dr-field">
          <span>Address (optional)</span>
          <input className="input" type="url" maxLength={500} value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
      </div>
      <label className="dr-check">
        <input type="checkbox" checked={notProvided} onChange={(event) => setNotProvided(event.target.checked)} />
        <span>Listed in the index but not provided</span>
      </label>
      <label className="dr-field">
        <span>Text</span>
        <textarea className="input dr-textarea" rows={8} value={text} disabled={notProvided} onChange={(event) => setText(event.target.value)} />
      </label>
      <p className="note" aria-live="polite">
        {text.length.toLocaleString('en')} of {documentChars.toLocaleString('en')} characters
      </p>
      <button type="submit" className="btn btn-primary" disabled={room.saving}>
        {room.saving ? 'Saving…' : 'Add to the data room'}
      </button>
      {formError && (
        <p className="dr-error" role="alert">
          {formError}
        </p>
      )}
    </form>
  );
}

/** The data room page's body. `today` is the as-of date offered for an empty room (the browser's day by default). */
export function DataRoomPanel({ today = todayUtc() }: { today?: string }) {
  const room = useDataRoom();
  if (room.status === 'unavailable') return null;

  let body: ReactNode;
  if (room.dataRoom === undefined) {
    body =
      room.status === 'error' ? (
        <p role="alert">
          The data room could not be loaded. {room.loadError?.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={room.reload}>
            Retry
          </button>
        </p>
      ) : (
        <p aria-busy="true">Loading the data room…</p>
      );
  } else if (room.dataRoom === null) {
    body = <StartChoices today={today} />;
  } else {
    const { asOf, documents } = room.dataRoom;
    const plan = planTurn(
      documents.map((document) => ({ id: document.id, provided: document.provided, publishedAt: document.publishedAt, withdrawn: document.withdrawnAt !== null, size: document.chars })),
      asOf,
      room.limits.turnChars,
    );
    const shown = plan.filter((entry) => entry.state === 'shown').length;
    body = (
      <>
        <p className="dr-asof">
          <strong>As of {asOf}.</strong> No document dated after this day is in the room, and the agents would never see one.
        </p>
        {documents.length === 0 ? (
          <p>No documents yet. Add the first one below.</p>
        ) : (
          <>
            <p className="note">
              {plural(documents.length, 'document', 'documents')}: {shown} shown to the agents, {documents.length - shown} not shown. The agents read up to{' '}
              {room.limits.turnChars.toLocaleString('en')} characters of documents on each turn.
            </p>
            <DocumentRows documents={documents} asOf={asOf} turnChars={room.limits.turnChars} />
          </>
        )}
        <AddDocumentForm asOf={asOf} documentChars={room.limits.documentChars} />
      </>
    );
  }

  return (
    <section className="data-room" aria-labelledby="data-room-title">
      <div className="screen-head">
        <h1 id="data-room-title">Data room</h1>
        <p className="lede">
          The documents the agents work from. They read them on every turn and cite them by id; what is not here is “not found in the data room”.
          Everything in it is sent to your company’s model gateway when an agent answers, and the agents cannot change it.
        </p>
      </div>
      {room.saveError && <Problem problem={room.saveError} />}
      {body}
    </section>
  );
}
