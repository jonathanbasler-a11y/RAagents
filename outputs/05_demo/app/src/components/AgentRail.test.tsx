// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { ROSTER } from '@/client/test-fixtures';
import type { SelectionResponse } from '@/shared/contracts';
import { AgentRail } from './AgentRail';
import { SelectionProvider } from './SelectionProvider';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

beforeEach(() => {
  pathname.current = '/';
});

describe('AgentRail', () => {
  it('links the team page, the team chat and every agent, grouped as in mockup v2', () => {
    render(<AgentRail agents={ROSTER} />);

    const nav = screen.getByRole('navigation', { name: 'Rooms' });
    expect(within(nav).getByRole('link', { name: 'Team chat' })).toHaveAttribute('href', '/team');
    expect(within(nav).getByRole('link', { name: 'Team overview' })).toHaveAttribute('href', '/');
    for (const heading of ['Regulatory function', 'Specialists by asset', 'Team roles', 'Other functions']) {
      expect(within(nav).getByText(heading)).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole('link', { name: /./ }).filter((link) => link.getAttribute('href')?.startsWith('/chat/'))).toHaveLength(
      ROSTER.length,
    );
  });

  it('shows each agent with avatar, name and short capability', () => {
    render(<AgentRail agents={ROSTER} />);

    const olu = screen.getByRole('link', { name: /Olu/ });
    expect(olu).toHaveAttribute('href', '/chat/ops');
    expect(within(olu).getByText('Regulatory operations')).toBeInTheDocument();
    expect(olu.querySelector('img')).toHaveAttribute('src', '/avatars/ops.svg');
  });

  it('keeps Other functions collapsed unless you are in one of its rooms', () => {
    pathname.current = '/chat/reglead';
    const { unmount } = render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: /Cyrus/ }).closest('details')).not.toHaveAttribute('open');
    unmount();

    pathname.current = '/chat/o-cmc';
    render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: /Cyrus/ }).closest('details')).toHaveAttribute('open');
  });

  it('marks the current room', () => {
    pathname.current = '/chat/reglead';
    const { unmount } = render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: /Rosa/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Team chat' })).not.toHaveAttribute('aria-current');
    unmount();

    pathname.current = '/team';
    render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: 'Team chat' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows who is selected for this DD once the selection is known', async () => {
    const client = {
      getSelection: vi
        .fn<ChatApi['getSelection']>()
        .mockResolvedValue(ok<SelectionResponse>({ workspaceId: 'demo', selected: ['reglead', 'ev'], source: 'saved' })),
      setSelection: vi.fn<ChatApi['setSelection']>(),
    };
    render(
      <SelectionProvider client={client}>
        <AgentRail agents={ROSTER} />
      </SelectionProvider>,
    );

    // Unknown until loaded, never shown as "not selected"; locked team roles are always on.
    expect(screen.getByRole('link', { name: /Rosa/ })).not.toHaveTextContent(/selected/);
    expect(screen.getByRole('link', { name: /Emeka/ })).toHaveTextContent(', selected for this DD');

    expect(await screen.findByRole('link', { name: /Rosa.*, selected for this DD/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lena.*, not selected/ })).toBeInTheDocument();
  });
});
