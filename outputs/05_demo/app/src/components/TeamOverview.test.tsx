// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { ROSTER } from '@/client/test-fixtures';
import type { HealthResponse, SelectionResponse } from '@/shared/contracts';
import { SelectionProvider } from './SelectionProvider';
import { TeamOverview } from './TeamOverview';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function api(selected: string[]) {
  return {
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockResolvedValue(ok<SelectionResponse>({ workspaceId: 'demo', selected, source: 'saved' })),
    setSelection: vi.fn<ChatApi['setSelection']>(),
    getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>({ status: 'stub' })),
  };
}

function renderOverview(selected: string[] = ['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn']) {
  const client = api(selected);
  render(
    <SelectionProvider client={client}>
      <TeamOverview agents={ROSTER} client={client} />
    </SelectionProvider>,
  );
  return client;
}

describe('TeamOverview', () => {
  it('shows a profile card with avatar, capability, group tag, autonomy, owner and the planned remit', () => {
    renderOverview();

    const card = screen.getByRole('article', { name: 'Rosa' });
    expect(card.querySelector('img')).toHaveAttribute('src', '/avatars/reglead.svg');
    expect(within(card).getByText('Regulatory lead')).toBeInTheDocument();
    expect(within(card).getByText('Regulatory')).toBeInTheDocument();
    expect(within(card).getByText('L2 Collaborate')).toBeInTheDocument();
    expect(within(card).getByText('Regulatory lead agent owner')).toBeInTheDocument();
    expect(within(card).getByText('planned')).toBeInTheDocument();
    expect(within(card).getByText('Planned remit of the regulatory lead agent.')).toBeInTheDocument();
  });

  it('links each card to its 1:1 room', () => {
    renderOverview();

    expect(screen.getByRole('link', { name: 'Chat with Rosa' })).toHaveAttribute('href', '/chat/reglead');
    expect(screen.getByRole('link', { name: 'Chat with Emeka' })).toHaveAttribute('href', '/chat/ev');
  });

  it('has a prominent entry to the team chat', () => {
    renderOverview();

    expect(screen.getByRole('link', { name: 'Open the team chat' })).toHaveAttribute('href', '/team');
  });

  it('groups the cards as in mockup v2, with Other functions collapsed', () => {
    renderOverview();

    for (const heading of ['Regulatory function', 'Specialists by asset', 'Team roles', 'Other functions']) {
      expect(screen.getByRole('heading', { name: new RegExp(heading) })).toBeInTheDocument();
    }
    expect(screen.getByRole('article', { name: 'Cyrus' }).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('article', { name: 'Rosa' }).closest('details')).toBeNull();
  });

  it('says what usually brings a specialist in', () => {
    renderOverview();

    expect(
      within(screen.getByRole('article', { name: 'Oona' })).getByText('Usually switched on by the asset classification: Orphan.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Olu' })).getByText('Usually joins when a filing is near (Phase 3 or filed).'),
    ).toBeInTheDocument();
  });

  it('puts a "Selected for this DD" switch on each card; team roles are always on', async () => {
    renderOverview();

    expect(within(screen.getByRole('article', { name: 'Emeka' })).getByRole('switch')).toHaveTextContent('Always on');
    const rosaSwitch = await within(screen.getByRole('article', { name: 'Rosa' })).findByRole('switch');
    expect(rosaSwitch).toHaveAttribute('aria-checked', 'true');
    const lenaSwitch = await within(screen.getByRole('article', { name: 'Lena' })).findByRole('switch');
    expect(lenaSwitch).toHaveAttribute('aria-checked', 'false');
  });

  it('counts the agents selected for this DD', async () => {
    renderOverview(['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn']);

    expect(await screen.findByText('6 of 11 agents selected for this DD.')).toBeInTheDocument();
  });

  it('keeps each agent’s profile sections in a collapsed panel', () => {
    renderOverview();

    const card = screen.getByRole('article', { name: 'Rosa' });
    const details = within(card).getByText('Profile').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(card).getByText('Rosa covers regulatory lead.')).toBeInTheDocument();
  });
});
