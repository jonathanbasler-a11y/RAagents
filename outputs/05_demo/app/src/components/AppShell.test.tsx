// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';
import type { TimelineItem } from '@/client/timeline';
import { AppShell } from './AppShell';
import { AgentBubble } from './MessageBubble';

const AGENT_ITEM = {
  kind: 'agent',
  key: 'reply-1',
  agentId: 'reglead',
  agentName: 'Rosa',
  text: 'A short reply.',
  state: 'complete',
  truncated: false,
  errorCode: null,
  correlationId: null,
  unsaved: false,
} as unknown as Extract<TimelineItem, { kind: 'agent' }>;

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = '/';
});

function renderShell() {
  return render(
    <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
      <p>Page body</p>
    </AppShell>,
  );
}

describe('AppShell navigation', () => {
  it('has the product link home in the header and no second workspace entry', () => {
    renderShell();

    const header = within(screen.getByRole('banner'));
    expect(header.getAllByRole('link')).toHaveLength(1);
    expect(header.getByRole('link', { name: /Digital Human Hybrid Team/ })).toHaveAttribute('href', '/');
  });

  it.each(['/', '/team', '/chat/reglead'])('adds no link above the page on %s', (path) => {
    pathname.current = path;
    renderShell();

    const main = within(screen.getByRole('main'));
    expect(main.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText(/illustrative/i)).not.toBeInTheDocument();
  });

  it('shows one banner above the page, not two', () => {
    renderShell();

    expect(screen.getAllByRole('note')).toHaveLength(1);
  });
});

describe('AppShell in practice mode', () => {
  const PRACTICE_BANNER = 'Practice mode: replies come from a stand-in model, not AI. Do not present them as real answers.';

  it('shows the practice banner on the page, right under the confidential-workspace banner', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} mode="practice">
        <p>Page body</p>
      </AppShell>,
    );

    const confidentialBanner = screen.getByText('Confidential workspace. Chats stay on this computer and go to your company\'s model gateway; agents cannot promise secrecy or deletion.');
    const practiceBanner = screen.getByText(PRACTICE_BANNER);
    expect(confidentialBanner.compareDocumentPosition(practiceBanner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(practiceBanner.compareDocumentPosition(screen.getByRole('banner')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stops calling replies model output in the header line', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} mode="practice">
        <p>Page body</p>
      </AppShell>,
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('In this phase no documents and no tools are connected. Replies in practice mode are stand-in text, not model output and not sources.');
    expect(header).not.toHaveTextContent('Agent replies are model output');
  });

  it.each([undefined, 'live' as const])('shows nothing about practice mode when the mode is %s', (mode) => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} mode={mode}>
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.queryByText(/Practice mode/)).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Agent replies are model output, not sources.');
  });

  it('gives replies below the shell the practice label', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} mode="practice">
        <AgentBubble item={AGENT_ITEM} agent={ROSTER[0]} />
      </AppShell>,
    );

    expect(screen.getByText('Practice reply · not AI · not sourced')).toBeInTheDocument();
    expect(screen.queryByText('Model output · not sourced')).not.toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('shows the product name, the confidential-workspace banner, the rail and the page', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.getByText('Digital Human Hybrid Team')).toBeInTheDocument();
    expect(screen.getByText('Confidential workspace. Chats stay on this computer and go to your company\'s model gateway; agents cannot promise secrecy or deletion.')).toBeInTheDocument();
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
    expect(screen.getByText('Confidential workspace. Chats stay on this computer and go to your company\'s model gateway; agents cannot promise secrecy or deletion.')).toBeInTheDocument();
  });
});
