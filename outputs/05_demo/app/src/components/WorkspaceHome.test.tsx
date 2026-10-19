// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { ROSTER } from '@/client/test-fixtures';
import type { DdSetup, DdSetupResponse, HealthResponse, SelectionResponse } from '@/shared/contracts';
import { selectionAfterSetupChange } from '@/shared/dd-setup';
import { DataRoomProvider } from './DataRoomProvider';
import { DdSetupProvider } from './DdSetupProvider';
import { SelectionProvider } from './SelectionProvider';
import { WorkspaceHome } from './WorkspaceHome';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

const SETUP: DdSetup = { stage: 'Phase 2', classifications: ['orphan'] };
const SELECTED = ['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn'];

/** A fake server that applies the shared rule, so the page is tested against the real behaviour. */
function api(selected: string[], setup: DdSetup = SETUP) {
  let current = { setup, selected };
  const reply = (source: 'default' | 'saved'): ApiResult<DdSetupResponse> =>
    ok<DdSetupResponse>({
      workspaceId: 'demo',
      setup: current.setup,
      source,
      selection: { workspaceId: 'demo', selected: current.selected, source },
    });
  return {
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockImplementation(async () => ok<SelectionResponse>({ workspaceId: 'demo', selected: current.selected, source: 'saved' })),
    setSelection: vi.fn<ChatApi['setSelection']>().mockImplementation(async (agentId, on) => {
      const without = current.selected.filter((id) => id !== agentId);
      current = { ...current, selected: on ? [...without, agentId] : without };
      return ok<SelectionResponse>({ workspaceId: 'demo', selected: current.selected, source: 'saved' });
    }),
    getDdSetup: vi.fn<ChatApi['getDdSetup']>().mockImplementation(async () => reply('saved')),
    setDdSetup: vi.fn<ChatApi['setDdSetup']>().mockImplementation(async (next) => {
      current = { setup: next, selected: selectionAfterSetupChange(ROSTER, current.setup, next, current.selected) };
      return reply('saved');
    }),
    getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>({ status: 'stub' })),
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(ok({ workspaceId: 'demo', dataRoom: null, practiceAvailable: true, limits: { documentChars: 12000, turnChars: 48000 } })),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
}

function renderHome(selected: string[] = SELECTED) {
  const client = api(selected);
  render(
    <DataRoomProvider client={client}>
      <SelectionProvider client={client}>
        <DdSetupProvider client={client}>
          <WorkspaceHome agents={ROSTER} client={client} />
        </DdSetupProvider>
      </SelectionProvider>
    </DataRoomProvider>,
  );
  return client;
}

describe('WorkspaceHome', () => {
  it('has one heading, one place to set up the DD, and no illustrative screens or tab row', () => {
    renderHome();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('DD workspace');
    expect(screen.getByRole('heading', { name: 'DD setup' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText(/illustrative/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /workspace/i })).not.toBeInTheDocument();
  });

  it('says what the agents can read: no documents while there is no data room, and not a word about it before it is known', async () => {
    renderHome();

    expect(screen.getByText(/The agents have no tools\./)).toBeInTheDocument();
    expect(await screen.findByText(/the agents have no documents and no tools/)).toBeInTheDocument();
    expect(await screen.findByText(/No data room yet\. The agents have no documents to work from\./)).toBeInTheDocument();
  });

  it('orders the page: DD setup, the data room, the team chat entry, the status, then the team overview with every card', () => {
    renderHome();

    const before = (first: HTMLElement, second: HTMLElement) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    const setup = screen.getByRole('heading', { name: 'DD setup' });
    const dataRoom = screen.getByRole('heading', { name: 'Data room' });
    const chat = screen.getByRole('heading', { name: 'Team chat' });
    const overview = screen.getByRole('heading', { name: 'Team overview' });
    const firstGroup = screen.getByRole('heading', { name: /Regulatory function/ });
    expect(before(setup, dataRoom)).toBe(true);
    expect(before(dataRoom, chat)).toBe(true);
    expect(before(chat, overview)).toBe(true);
    expect(before(overview, firstGroup)).toBe(true);
    expect(screen.getAllByRole('article')).toHaveLength(ROSTER.length);
  });

  it('shows a profile card with avatar, capability, group tag, autonomy, owner and the planned remit', () => {
    renderHome();

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
    renderHome();

    expect(screen.getByRole('link', { name: 'Chat with Rosa' })).toHaveAttribute('href', '/chat/reglead');
    expect(screen.getByRole('link', { name: 'Chat with Emeka' })).toHaveAttribute('href', '/chat/ev');
  });

  it('has a prominent entry to the team chat', () => {
    renderHome();

    expect(screen.getByRole('link', { name: 'Open the team chat' })).toHaveAttribute('href', '/team');
  });

  it('groups the cards as in mockup v2, with Other functions collapsed', () => {
    renderHome();

    for (const heading of ['Regulatory function', 'Specialists by asset', 'Team roles', 'Other functions']) {
      expect(screen.getByRole('heading', { name: new RegExp(heading) })).toBeInTheDocument();
    }
    expect(screen.getByRole('article', { name: 'Cyrus' }).closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('article', { name: 'Rosa' }).closest('details')).toBeNull();
  });

  it('puts a "Selected for this DD" switch on each card; team roles are always on', async () => {
    renderHome();

    expect(within(screen.getByRole('article', { name: 'Emeka' })).getByRole('switch')).toHaveTextContent('Always on');
    const rosaSwitch = await within(screen.getByRole('article', { name: 'Rosa' })).findByRole('switch');
    expect(rosaSwitch).toHaveAttribute('aria-checked', 'true');
    const lenaSwitch = await within(screen.getByRole('article', { name: 'Lena' })).findByRole('switch');
    expect(lenaSwitch).toHaveAttribute('aria-checked', 'false');
  });

  it('counts the agents selected for this DD', async () => {
    renderHome(['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn']);

    expect(await screen.findByText('6 of 11 agents selected for this DD.')).toBeInTheDocument();
  });

  it('keeps each agent’s profile sections in a collapsed panel', () => {
    renderHome();

    const card = screen.getByRole('article', { name: 'Rosa' });
    const details = within(card).getByText('Profile').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(card).getByText('Rosa covers regulatory lead.')).toBeInTheDocument();
  });

  it('says what usually brings a specialist in while the setup is still unknown', () => {
    renderHome();

    expect(
      within(screen.getByRole('article', { name: 'Oona' })).getByText('Usually switched on by the asset classification: Orphan.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Olu' })).getByText('Usually joins when a filing is near (Phase 3 or filed).'),
    ).toBeInTheDocument();
  });

  it('says why each agent is on or off once the setup is known', async () => {
    renderHome(['reglead', 'cmcreg', 'sp-orphan', 'orc', 'san', 'ev', 'syn']);

    const oona = within(screen.getByRole('article', { name: 'Oona' }));
    expect(await oona.findByText('On because the asset is classified: Orphan.')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Olu' })).getByText('Joins when a filing is near (Phase 3 or filed).')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Lena' })).getByText('Switched off by you (on by default).')).toBeInTheDocument();
  });

  it('moves the team when the stage changes: the card, the switch, the count and the note all follow from one save', async () => {
    const user = userEvent.setup();
    const client = renderHome(['reglead', 'cmcreg', 'label', 'intel', 'sp-orphan', 'orc', 'san', 'ev', 'syn']);
    const olu = within(screen.getByRole('article', { name: 'Olu' }));
    expect(await screen.findByText('9 of 11 agents selected for this DD.')).toBeInTheDocument();
    expect(await olu.findByRole('switch')).toHaveAttribute('aria-checked', 'false');

    await user.click(await screen.findByRole('radio', { name: 'Phase 3' }));

    expect(client.setDdSetup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Saved. Olu joined the team.')).toBeInTheDocument();
    expect(olu.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(olu.getByText('On because a filing is near (Phase 3 or filed).')).toBeInTheDocument();
    expect(screen.getByText('10 of 11 agents selected for this DD.')).toBeInTheDocument();
    expect(client.getSelection).toHaveBeenCalledTimes(1);
  });

  it('keeps a hand switch when the setup changes elsewhere, and says it was switched by hand', async () => {
    const user = userEvent.setup();
    renderHome(['reglead', 'cmcreg', 'label', 'intel', 'sp-orphan', 'orc', 'san', 'ev', 'syn']);
    const lena = within(screen.getByRole('article', { name: 'Lena' }));
    await user.click(await lena.findByRole('switch'));

    await user.click(await screen.findByRole('radio', { name: 'Filed' }));

    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
    expect(lena.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(lena.getByText('Switched off by you (on by default).')).toBeInTheDocument();
  });
});
