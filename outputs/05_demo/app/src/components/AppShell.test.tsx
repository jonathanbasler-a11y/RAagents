// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';
import type { TimelineItem } from '@/client/timeline';
import { gatesResponse } from '@/shared/gates-fixtures';
import { AppShell } from './AppShell';
import { DataRoomPanel } from './DataRoomPanel';
import { DdSetupPanel } from './DdSetupPanel';
import { GatesPanel } from './GatesPanel';
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

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const LIMITS = { documentChars: 12_000, turnChars: 48_000 };
const SETUP = { stage: 'Phase 2', classifications: ['orphan'] };
const SELECTION = { workspaceId: 'demo', selected: ['reglead'], source: 'saved' };

/** The server as the shell's providers see it: a DD setup, a selection and a data room (null: none started). */
function stubServer(dataRoom: { asOf: string; documents: unknown[] } | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/api/gates')) return json(gatesResponse());
      if (path.includes('dd-setup')) return json({ workspaceId: 'demo', setup: SETUP, source: 'saved', selection: SELECTION });
      if (path.includes('data-room')) {
        return json({ workspaceId: 'demo', dataRoom: dataRoom && { createdAt: 'x', ...dataRoom }, practiceAvailable: true, limits: LIMITS });
      }
      return json(SELECTION);
    }),
  );
}

const DOC = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, title: id, sourceType: 'company-disclosure', publishedAt: '2026-07-01', url: null, provided: true, origin: 'added', addedAt: 'x',
  withdrawnAt: null, withdrawnReason: null, chars: 100, ...overrides,
});

beforeEach(() => {
  pathname.current = '/';
  stubServer(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('AppShell DD setup', () => {
  it('mounts the DD setup for the pages below it', async () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
        <DdSetupPanel agents={ROSTER} />
      </AppShell>,
    );

    expect(await screen.findByRole('radio', { name: 'Phase 2' })).toBeChecked();
  });
});

describe('AppShell gates', () => {
  it('mounts the gates for the pages below it', async () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
        <GatesPanel />
      </AppShell>,
    );

    expect(await screen.findByRole('article', { name: /Scope and activation/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gates' })).toHaveAttribute('href', '/gates');
  });
});

describe('AppShell data room', () => {
  it('mounts the data room for the pages below it', async () => {
    stubServer({ asOf: '2026-10-12', documents: [DOC('DR-01')] });

    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }}>
        <DataRoomPanel />
      </AppShell>,
    );

    expect(await screen.findByRole('row', { name: /^DR-01/ })).toBeInTheDocument();
  });

  it('says in the header that no documents are connected when there is no data room', async () => {
    renderShell();

    expect(await within(screen.getByRole('banner')).findByText('In this phase no documents and no tools are connected. Agent replies are model output, not sources.')).toBeInTheDocument();
  });

  it('says in the header that a data room is connected once there is one', async () => {
    stubServer({ asOf: '2026-10-12', documents: [DOC('DR-01'), DOC('DR-02')] });
    renderShell();

    expect(await within(screen.getByRole('banner')).findByText('A data room is connected (2 documents shown to the agents). No tools are. Agent replies are model output, not sources.')).toBeInTheDocument();
  });

  it('claims nothing about documents before it knows', () => {
    renderShell();

    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('No tools are connected. Agent replies are model output, not sources.');
    expect(header).not.toHaveTextContent(/no documents/i);
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

  it('stops calling replies model output in the header line', async () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} mode="practice">
        <p>Page body</p>
      </AppShell>,
    );

    const header = screen.getByRole('banner');
    await waitFor(() =>
      expect(header).toHaveTextContent('In this phase no documents and no tools are connected. Replies in practice mode are stand-in text, not model output and not sources.'),
    );
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

describe('AppShell on a hosted copy', () => {
  it('shows the confidential-workspace banner by default and no sign-out', () => {
    renderShell();

    expect(screen.getByRole('note')).toHaveTextContent(/Chats stay on this computer/);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('shows the hosted notice in place of the confidential-workspace banner', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} notice="Hosted practice copy: fictional material only.">
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByRole('note')).toHaveTextContent('Hosted practice copy: fictional material only.');
    expect(screen.queryByText(/Chats stay on this computer/)).not.toBeInTheDocument();
  });

  it('names the person signed in, with their password page and sign-out as a form that posts to the sign-out route', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} account={{ username: 'member-one', isAdmin: false, canChangePassword: true }}>
        <p>Page body</p>
      </AppShell>,
    );

    const header = within(screen.getByRole('banner'));
    expect(header.getByText(/Signed in as/)).toHaveTextContent('Signed in as member-one');
    expect(header.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/account/password');
    expect(header.queryByRole('link', { name: 'People' })).not.toBeInTheDocument();
    const form = header.getByRole('button', { name: 'Sign out' }).closest('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/api/logout');
  });

  it('gives the admin the People page, and no password page for an admin set in the server settings', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} account={{ username: 'admin', isAdmin: true, canChangePassword: false }}>
        <p>Page body</p>
      </AppShell>,
    );

    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: 'People' })).toHaveAttribute('href', '/admin');
    expect(header.queryByRole('link', { name: 'Change password' })).not.toBeInTheDocument();
  });

  it('offers sign-out alone when sign-in is on but no account could be read', () => {
    render(
      <AppShell agentsLoad={{ ok: true, agents: ROSTER }} account={null}>
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
