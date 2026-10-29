// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAccount } from '@/server/accounts/current';

const current = vi.hoisted(() => ({ value: { signIn: 'off' } as CurrentAccount }));
vi.mock('@/server/accounts/current', () => ({ currentAccount: async () => current.value }));
vi.mock('@/components/PeoplePanel', () => ({ PeoplePanel: () => <p>People panel</p> }));
const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
}));
vi.mock('next/navigation', () => ({ notFound }));

import AdminPage from './page';

const session = { accountId: 'a', username: 'member-one', role: 'member' as const, managedBy: 'app' as const, mustChangePassword: false, expiresAt: 'x' };

afterEach(() => {
  current.value = { signIn: 'off' };
  notFound.mockClear();
});

describe('/admin', () => {
  it('does not exist without sign-in', async () => {
    await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the People page to the admin only', async () => {
    current.value = { signIn: 'on', session };
    render(await AdminPage());
    expect(screen.getByText('Only the admin can see this page.')).toBeInTheDocument();
    expect(screen.queryByText('People panel')).not.toBeInTheDocument();

    current.value = { signIn: 'on', session: { ...session, username: 'admin', role: 'admin', managedBy: 'server' } };
    render(await AdminPage());
    expect(screen.getByText('People panel')).toBeInTheDocument();
  });
});
