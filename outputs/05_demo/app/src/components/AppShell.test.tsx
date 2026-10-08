// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';
import { AppShell } from './AppShell';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

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
  });
});
