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
  it('links the DD workspace, the data room, the team chat and every agent, grouped as in mockup v2', () => {
    render(<AgentRail agents={ROSTER} />);

    const nav = screen.getByRole('navigation', { name: 'Rooms' });
    expect(within(nav).getByRole('link', { name: 'Team chat' })).toHaveAttribute('href', '/team');
    expect(within(nav).getByRole('link', { name: 'DD workspace' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Data room' })).toHaveAttribute('href', '/data-room');
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
    expect(screen.getByRole('link', { name: 'DD workspace' })).not.toHaveAttribute('aria-current');
  });

  it('has five entries above the agents, the DD workspace, the data room, the findings, the checklist and the team chat, and marks the one you are on', () => {
    const { unmount } = render(<AgentRail agents={ROSTER} />);
    const top = screen.getByRole('link', { name: 'Team chat' }).closest('ul');
    expect(top).not.toBeNull();
    expect(within(top as HTMLElement).getAllByRole('link').map((link) => link.textContent)).toEqual(['DD workspace', 'Data room', 'Findings', 'Checklist', 'Team chat']);
    expect(screen.getByRole('link', { name: 'DD workspace' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Team chat' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: /illustrative/i })).not.toBeInTheDocument();
    unmount();

    pathname.current = '/data-room';
    const second = render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: 'Data room' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'DD workspace' })).not.toHaveAttribute('aria-current');
    second.unmount();

    pathname.current = '/findings';
    const third = render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: 'Findings' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Data room' })).not.toHaveAttribute('aria-current');
    third.unmount();

    pathname.current = '/checklist';
    const fourth = render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: 'Checklist' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Findings' })).not.toHaveAttribute('aria-current');
    fourth.unmount();

    pathname.current = '/chat/reglead';
    render(<AgentRail agents={ROSTER} />);
    expect(screen.getByRole('link', { name: 'DD workspace' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Data room' })).not.toHaveAttribute('aria-current');
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
