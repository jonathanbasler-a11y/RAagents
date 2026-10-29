import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAccount } from '@/server/accounts/current';

// The root layout renders the app shell, and loads the agent roster for it, only for a valid session when sign-in is on.
// A request that slips past the proxy (an unknown path's not-found page, an .rsc variant of an open path) renders bare.

const state = vi.hoisted(() => ({ current: { signIn: 'off' } as CurrentAccount, rosterLoads: 0 }));

vi.mock('@/server/accounts/current', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/accounts/current')>();
  return { ...actual, currentAccount: async () => state.current };
});
vi.mock('@/components/load-agents', () => ({
  loadPublicAgents: () => {
    state.rosterLoads += 1;
    return { ok: true, agents: [] };
  },
}));
vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children, account }: { children: ReactNode; account?: { username: string } | null }) => (
    <div data-shell={account === undefined ? 'no account line' : account === null ? 'null' : account.username}>{children}</div>
  ),
}));
vi.mock('@/server/demo-mode', () => ({ readDemoMode: () => 'live' }));

import RootLayout from './layout';

const SESSION = { accountId: 'a', username: 'member-one', role: 'member' as const, managedBy: 'app' as const, mustChangePassword: false, expiresAt: 'x' };

async function render(): Promise<string> {
  return renderToStaticMarkup(await RootLayout({ children: <p>Page body</p> }));
}

afterEach(() => {
  state.current = { signIn: 'off' };
  state.rosterLoads = 0;
});

describe('RootLayout', () => {
  it('renders the shell as before when sign-in is off', async () => {
    const html = await render();
    expect(html).toContain('data-shell="no account line"');
    expect(state.rosterLoads).toBe(1);
  });

  it('renders the page alone, and loads no roster, for a request without a valid session when sign-in is on', async () => {
    state.current = { signIn: 'on', session: null };
    const html = await render();
    expect(html).toContain('Page body');
    expect(html).not.toContain('data-shell');
    expect(state.rosterLoads).toBe(0);
  });

  it('names the person in the shell when they signed in', async () => {
    state.current = { signIn: 'on', session: SESSION };
    expect(await render()).toContain('data-shell="member-one"');
  });
});
