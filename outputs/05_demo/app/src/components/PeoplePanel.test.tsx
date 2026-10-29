// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsApi } from '@/client/accounts-client';
import type { PersonSummary } from '@/shared/accounts';
import { PeoplePanel } from './PeoplePanel';

const ADMIN: PersonSummary = {
  username: 'admin',
  role: 'admin',
  managedBy: 'server',
  status: 'active',
  oneTimeExpiresAt: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  createdBy: 'server',
  lastSignInAt: '2026-10-29T09:00:00.000Z',
  openSessions: 1,
};
const MEMBER: PersonSummary = {
  ...ADMIN,
  username: 'member-one',
  role: 'member',
  managedBy: 'app',
  status: 'waiting',
  oneTimeExpiresAt: '2026-11-05T08:00:00.000Z',
  createdBy: 'admin',
  lastSignInAt: null,
  openSessions: 0,
};

const ok = <T,>(data: T) => ({ ok: true as const, data });

function fakeClient(people: PersonSummary[] = [ADMIN, MEMBER]) {
  return {
    listPeople: vi.fn<AccountsApi['listPeople']>().mockResolvedValue(ok({ people })),
    createPerson: vi.fn<AccountsApi['createPerson']>(),
    resetPerson: vi.fn<AccountsApi['resetPerson']>(),
    disablePerson: vi.fn<AccountsApi['disablePerson']>(),
    enablePerson: vi.fn<AccountsApi['enablePerson']>(),
  };
}

const row = async (username: string) => (await screen.findByRole('cell', { name: username })).closest('tr') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PeoplePanel', () => {
  it('lists everyone with their status; the admin from the server settings has no actions', async () => {
    render(<PeoplePanel client={fakeClient()} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'People' })).toBeInTheDocument();
    const admin = await row('admin');
    expect(admin).toHaveTextContent('Admin, set in the server settings');
    expect(within(admin).queryAllByRole('button')).toHaveLength(0);
    const member = await row('member-one');
    expect(member).toHaveTextContent(/Waiting for their own password \(until/);
    expect(within(member).getByRole('button', { name: 'Reset password for member-one' })).toBeInTheDocument();
    expect(within(member).getByRole('button', { name: 'Disable member-one' })).toBeInTheDocument();
  });

  it('creates a person and shows their one-time password once; Done removes it from the page', async () => {
    const client = fakeClient();
    const created = { ...MEMBER, username: 'member-two' };
    client.createPerson.mockResolvedValue(ok({ person: created, oneTimePassword: 'k7qm-2xvd-9hpt-4wcn', expiresAt: '2026-11-05T08:00:00.000Z' }));
    client.listPeople.mockResolvedValueOnce(ok({ people: [ADMIN, MEMBER] })).mockResolvedValue(ok({ people: [ADMIN, MEMBER, created] }));
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.type(await screen.findByLabelText('Username of the new person'), 'Member-Two');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(client.createPerson).toHaveBeenCalledWith('member-two');
    const dialog = await screen.findByRole('dialog', { name: 'One-time password for member-two' });
    expect(dialog).toHaveTextContent('k7qm-2xvd-9hpt-4wcn');
    expect(dialog).toHaveTextContent(/Shown only now/);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('k7qm-2xvd-9hpt-4wcn');
    expect(await row('member-two')).toBeInTheDocument();
  });

  it('copies the one-time password and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient();
    client.createPerson.mockResolvedValue(ok({ person: { ...MEMBER, username: 'member-two' }, oneTimePassword: 'k7qm-2xvd-9hpt-4wcn', expiresAt: 'x' }));
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PeoplePanel client={client} />);

    await user.type(await screen.findByLabelText('Username of the new person'), 'member-two');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('k7qm-2xvd-9hpt-4wcn');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('checks the username as typed and sends nothing the server would refuse', async () => {
    const client = fakeClient();
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.type(await screen.findByLabelText('Username of the new person'), 'with space');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText(/2 to 32 characters/)).toBeInTheDocument();
    expect(client.createPerson).not.toHaveBeenCalled();
  });

  it('asks before a reset, then shows the new one-time password', async () => {
    const client = fakeClient();
    client.resetPerson.mockResolvedValue(ok({ person: MEMBER, oneTimePassword: 'zzzz-yyyy-xxxx-wwww', expiresAt: 'x' }));
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.click(within(await row('member-one')).getByRole('button', { name: 'Reset password for member-one' }));
    expect(client.resetPerson).not.toHaveBeenCalled();
    expect(screen.getByText(/current password stops working and they are signed out everywhere/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));

    expect(client.resetPerson).toHaveBeenCalledWith('member-one');
    expect(await screen.findByRole('dialog', { name: 'One-time password for member-one' })).toHaveTextContent('zzzz-yyyy-xxxx-wwww');
  });

  it('asks before disabling, then shows the person disabled with a way to enable them again', async () => {
    const client = fakeClient();
    client.disablePerson.mockResolvedValue(ok({ person: { ...MEMBER, status: 'disabled' } }));
    client.listPeople.mockResolvedValueOnce(ok({ people: [ADMIN, MEMBER] })).mockResolvedValue(ok({ people: [ADMIN, { ...MEMBER, status: 'disabled' }] }));
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.click(within(await row('member-one')).getByRole('button', { name: 'Disable member-one' }));
    await user.click(screen.getByRole('button', { name: 'Confirm disable' }));

    expect(client.disablePerson).toHaveBeenCalledWith('member-one');
    await waitFor(async () => expect(within(await row('member-one')).getByRole('button', { name: 'Enable member-one' })).toBeInTheDocument());
  });

  it('moves focus to the confirmation, then to the box with the one-time password, so neither appears unnoticed', async () => {
    const client = fakeClient();
    client.resetPerson.mockResolvedValue(ok({ person: MEMBER, oneTimePassword: 'zzzz-yyyy-xxxx-wwww', expiresAt: 'x' }));
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.click(within(await row('member-one')).getByRole('button', { name: 'Reset password for member-one' }));
    expect(screen.getByRole('button', { name: 'Confirm reset' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));
    const dialog = await screen.findByRole('dialog', { name: 'One-time password for member-one' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByLabelText('Username of the new person')).toHaveFocus();
  });

  it('says so when the list cannot be refreshed after an action, instead of showing the old rows as current', async () => {
    const client = fakeClient();
    client.disablePerson.mockResolvedValue(ok({ person: { ...MEMBER, status: 'disabled' } }));
    client.listPeople
      .mockResolvedValueOnce(ok({ people: [ADMIN, MEMBER] }))
      .mockResolvedValueOnce({ ok: false, status: 401, error: null, message: 'Sign in first.' });
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.click(within(await row('member-one')).getByRole('button', { name: 'Disable member-one' }));
    await user.click(screen.getByRole('button', { name: 'Confirm disable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The list of people could not be refreshed. Sign in first.');
  });

  it('shows the server message and its correlation id when an action fails', async () => {
    const client = fakeClient();
    client.createPerson.mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: 'username_taken', message: 'That username is taken. Choose another.', correlationId: 'corr-9' },
      message: 'That username is taken. Choose another.',
    });
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    await user.type(await screen.findByLabelText('Username of the new person'), 'member-one');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken. Choose another. (correlation corr-9)');
  });

  it('offers a retry when the list cannot be read', async () => {
    const client = fakeClient();
    client.listPeople.mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' });
    const user = userEvent.setup();
    render(<PeoplePanel client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The list of people could not be loaded. Could not reach the server.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await row('member-one')).toBeInTheDocument();
  });
});
