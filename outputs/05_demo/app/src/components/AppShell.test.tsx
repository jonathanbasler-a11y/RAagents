// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';
import { AppShell } from './AppShell';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = '/';
});

const WORKSPACE_FROM_TEAM_CHAT = 'Open the DD workspace (illustrative)';

function renderShell() {
  return render(
    <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
      <p>Page body</p>
    </AppShell>,
  );
}

describe('AppShell navigation to the illustrative workspace', () => {
  it('links the workspace from the app header', () => {
    renderShell();

    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Workspace (illustrative)' })).toHaveAttribute('href', '/workspace');
  });

  it('gives the team chat a small link to the workspace, above the chat', () => {
    pathname.current = '/team';
    renderShell();

    const main = screen.getByRole('main');
    const link = within(main).getByRole('link', { name: WORKSPACE_FROM_TEAM_CHAT });
    expect(link).toHaveAttribute('href', '/workspace');
    expect(link.compareDocumentPosition(within(main).getByText('Page body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['/', '/workspace', '/chat/reglead'])('shows that link only in the team chat, not on %s', (path) => {
    pathname.current = path;
    renderShell();

    expect(within(screen.getByRole('main')).queryByRole('link', { name: WORKSPACE_FROM_TEAM_CHAT })).not.toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('shows the product name, the public-information banner, the rail and the page', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.getByText('Digital Human Hybrid Team')).toBeInTheDocument();
    expect(screen.getByText('Public information only. Do not paste confidential or company information.')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Rooms' })).getByRole('link', { name: /Rosa/ })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Page body');
  });

  it('keeps the page usable when the roster could not be loaded', () => {
    render(
      <AppShell agentsLoad={{ ok: false, title: 'The agent roster could not be loaded', detail: 'See the log.', issues: [] }}>
        <p>Setup message</p>
      </AppShell>,
    );

    expect(within(screen.getByRole('navigation', { name: 'Rooms' })).getByText(/Agents unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Setup message');
    expect(screen.getByText('Public information only. Do not paste confidential or company information.')).toBeInTheDocument();
    // The illustrative workspace needs no agents, so the header still offers it.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Workspace (illustrative)' })).toHaveAttribute('href', '/workspace');
  });
});
