'use client';

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { createAccountsClient, type AccountsApi } from '@/client/accounts-client';
import type { ApiResult } from '@/client/chat-client';
import { checkUsername, normalizeUsername, type OneTimePasswordResponse, type PersonSummary } from '@/shared/accounts';

// The People page of a hosted copy with sign-in: the admin creates people, resets a password, disables and enables. A
// one-time password is shown once, in a box the admin closes; it lives only in this component's state, never in a URL,
// a provider or storage, so after Done or a reload it is gone and a lost one means another reset.

const defaultClient = createAccountsClient();

function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusText(person: PersonSummary): string {
  switch (person.status) {
    case 'active':
      return 'Active';
    case 'waiting':
      return `Waiting for their own password (until ${formatDate(person.oneTimeExpiresAt)})`;
    case 'expired':
      return 'One-time password expired: reset it';
    case 'disabled':
      return 'Disabled';
  }
}

function roleText(person: PersonSummary): string {
  if (person.managedBy === 'server') return 'Admin, set in the server settings';
  return person.role === 'admin' ? 'Admin' : 'Member';
}

type Pending = { username: string; action: 'reset' | 'disable' } | null;
type Shown = { username: string; oneTimePassword: string; expiresAt: string } | null;
type Failure = { message: string; correlationId: string | null } | null;

export function PeoplePanel({ client = defaultClient }: { client?: AccountsApi }) {
  const [people, setPeople] = useState<PersonSummary[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [shown, setShown] = useState<Shown>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadRequest, setLoadRequest] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const shownRef = useRef<HTMLDivElement>(null);

  const fetchPeople = useEffectEvent(() => client.listPeople());

  useEffect(() => {
    let cancelled = false;
    void fetchPeople().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPeople(result.data.people);
        setLoadError(null);
      } else {
        setLoadError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  const reload = () => setLoadRequest((count) => count + 1);

  // The confirmation and the one-time password appear above the table, perhaps out of view: move focus (and the view)
  // to them, so a click on a row's button never seems to do nothing and a screen reader announces them.
  useEffect(() => {
    if (pending === null) return;
    confirmRef.current?.focus();
    confirmRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [pending]);
  useEffect(() => {
    if (shown === null) return;
    shownRef.current?.focus();
    shownRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shown]);

  const closeShown = () => {
    setShown(null);
    nameRef.current?.focus();
  };

  const fail = (result: Extract<ApiResult<unknown>, { ok: false }>) =>
    setFailure({ message: result.message, correlationId: result.error?.correlationId ?? null });

  const show = (data: OneTimePasswordResponse) => {
    setCopied(false);
    setShown({ username: data.person.username, oneTimePassword: data.oneTimePassword, expiresAt: data.expiresAt });
  };

  async function create(event: FormEvent) {
    event.preventDefault();
    const username = normalizeUsername(name);
    const check = checkUsername(username);
    if (!check.ok) {
      setNameError(check.message);
      return;
    }
    setNameError(null);
    setFailure(null);
    setBusy(true);
    const result = await client.createPerson(username);
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setName('');
    show(result.data);
    reload();
  }

  async function confirm() {
    if (pending === null) return;
    const { username, action } = pending;
    setPending(null);
    setFailure(null);
    setBusy(true);
    if (action === 'reset') {
      const result = await client.resetPerson(username);
      setBusy(false);
      if (!result.ok) {
        fail(result);
        return;
      }
      show(result.data);
    } else {
      const result = await client.disablePerson(username);
      setBusy(false);
      if (!result.ok) {
        fail(result);
        return;
      }
    }
    reload();
  }

  async function enable(username: string) {
    setFailure(null);
    setBusy(true);
    const result = await client.enablePerson(username);
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    reload();
  }

  async function copy() {
    if (shown === null) return;
    try {
      await navigator.clipboard.writeText(shown.oneTimePassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  let list;
  if (people === undefined) {
    list =
      loadError !== null ? (
        <p role="alert">
          The list of people could not be loaded. {loadError}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={reload}>
            Retry
          </button>
        </p>
      ) : (
        <p aria-busy="true">Loading the people…</p>
      );
  } else {
    list = (
      <table className="people-table">
        <caption>Everyone with an account on this copy</caption>
        <thead>
          <tr>
            <th scope="col">Username</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Last sign-in</th>
            <th scope="col">Signed in now</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.username}>
              <td>{person.username}</td>
              <td>{roleText(person)}</td>
              <td>{statusText(person)}</td>
              <td>
                {formatDate(person.createdAt)} by {person.createdBy}
              </td>
              <td>{formatDate(person.lastSignInAt)}</td>
              <td>{person.openSessions}</td>
              <td>
                {person.managedBy === 'server' ? null : (
                  <>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      aria-label={`Reset password for ${person.username}`}
                      disabled={busy}
                      onClick={() => setPending({ username: person.username, action: 'reset' })}
                    >
                      Reset password
                    </button>{' '}
                    {person.status === 'disabled' ? (
                      <button type="button" className="btn btn-quiet btn-sm" aria-label={`Enable ${person.username}`} disabled={busy} onClick={() => void enable(person.username)}>
                        Enable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        aria-label={`Disable ${person.username}`}
                        disabled={busy}
                        onClick={() => setPending({ username: person.username, action: 'disable' })}
                      >
                        Disable
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section className="people" aria-labelledby="people-title">
      <div className="screen-head">
        <h1 id="people-title">People</h1>
        <p className="lede">
          Everyone who can sign in to this copy. Create a person here and send them their one-time password privately; at the first sign-in they choose their
          own. Resetting a password or disabling a person signs them out everywhere at once.
        </p>
        <p className="note">Everyone signed in works in the same workspace and sees all of its chats.</p>
      </div>
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure.correlationId === null ? '' : ` (correlation ${failure.correlationId})`}
        </p>
      )}
      <form className="people-add" onSubmit={(event) => void create(event)}>
        <label htmlFor="new-person">Username of the new person</label>
        <input
          id="new-person"
          ref={nameRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={nameError !== null}
          aria-describedby={nameError === null ? undefined : 'new-person-error'}
        />
        <button type="submit" className="btn btn-sm" disabled={busy}>
          Create
        </button>
        {nameError === null ? null : (
          <p id="new-person-error" className="field-error">
            {nameError}
          </p>
        )}
      </form>
      {pending === null ? null : (
        <div className="people-confirm" role="group" aria-label={pending.action === 'reset' ? `Reset the password of ${pending.username}` : `Disable ${pending.username}`}>
          <p>
            {pending.action === 'reset'
              ? `Reset the password of ${pending.username}? Their current password stops working and they are signed out everywhere.`
              : `Disable ${pending.username}? They are signed out everywhere and cannot sign in until you enable them again.`}
          </p>
          <button type="button" className="btn btn-sm" ref={confirmRef} onClick={() => void confirm()}>
            {pending.action === 'reset' ? 'Confirm reset' : 'Confirm disable'}
          </button>{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {shown === null ? null : (
        <div className="people-dialog" role="dialog" aria-labelledby="one-time-title" aria-describedby="one-time-text" tabIndex={-1} ref={shownRef}>
          <h2 id="one-time-title">One-time password for {shown.username}</h2>
          <p className="one-time-password">{shown.oneTimePassword}</p>
          <p id="one-time-text">
            Shown only now. Send it to {shown.username} privately. It works until {formatDate(shown.expiresAt)}; at the first sign-in they choose their own
            password.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            Copy
          </button>{' '}
          <span aria-live="polite">{copied ? 'Copied' : ''}</span>{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={closeShown}>
            Done
          </button>
        </div>
      )}
      {people !== undefined && loadError !== null ? (
        <p role="alert">
          The list of people could not be refreshed. {loadError}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={reload}>
            Retry
          </button>
        </p>
      ) : null}
      {list}
    </section>
  );
}
