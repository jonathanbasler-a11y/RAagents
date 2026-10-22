// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { ROSTER } from '@/client/test-fixtures';
import type { SelectionResponse } from '@/shared/contracts';
import { SelectionProvider } from './SelectionProvider';
import { TeamPicker } from './TeamPicker';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function selectionClient(initial: string[]) {
  return {
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockResolvedValue(ok<SelectionResponse>({ workspaceId: 'demo', selected: initial, source: 'default' })),
    setSelection: vi.fn<ChatApi['setSelection']>(async (agentId, selected) =>
      ok<SelectionResponse>({
        workspaceId: 'demo',
        selected: selected ? [...initial, agentId] : initial.filter((id) => id !== agentId),
        source: 'saved',
      }),
    ),
  };
}

function renderPicker(client: ReturnType<typeof selectionClient>, agents = ROSTER) {
  return render(
    <SelectionProvider client={client}>
      <TeamPicker agents={agents} />
    </SelectionProvider>,
  );
}

// ROSTER: 11 agents. Locked: Oskar, Saskia, Emeka, Sofia (4). Optional: 7.
const SELECTED = ['reglead', 'cmcreg', 'sp-orphan'];

describe('TeamPicker', () => {
  it('is closed at first and says how many agents are on, counting the team roles that are always on', async () => {
    renderPicker(selectionClient(SELECTED));

    const toggle = await screen.findByRole('button', { name: /Team for this DD/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('7 of 11 on');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('opens a list with a switch for every optional agent, grouped, and the always-on roles named without a switch, in roster order whatever order it arrives in', async () => {
    const user = userEvent.setup();
    renderPicker(selectionClient(SELECTED), [...ROSTER].reverse());

    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    const panel = screen.getByRole('group', { name: 'Team for this DD' });
    expect(within(panel).getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
      'Rosa: selected for this DD',
      'Carlos: selected for this DD',
      'Lena: selected for this DD',
      'Ines: selected for this DD',
      'Olu: selected for this DD',
      'Oona: selected for this DD',
      'Cyrus: selected for this DD',
    ]);
    expect(within(panel).getByText('Regulatory function')).toBeInTheDocument();
    expect(within(panel).getByText('Specialists by asset')).toBeInTheDocument();
    expect(within(panel).getByText('Other functions')).toBeInTheDocument();
    expect(within(panel).getByText(/Always on: Oskar, Saskia, Emeka and Sofia/)).toBeInTheDocument();
    expect(within(panel).getByText(/applies from your next question/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Team for this DD/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists no heading for a group with nothing to switch, and no always-on line when no role is locked', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPicker(selectionClient(SELECTED));
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));
    expect(screen.queryByText('Team roles')).not.toBeInTheDocument();

    rerender(
      <SelectionProvider client={selectionClient(SELECTED)}>
        <TeamPicker agents={ROSTER.filter((agent) => !agent.locked)} />
      </SelectionProvider>,
    );

    expect(screen.queryByText(/Always on/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(7);
  });

  it('switches an agent on through POST /api/selection and updates the count', async () => {
    const user = userEvent.setup();
    const client = selectionClient(SELECTED);
    renderPicker(client);
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    await user.click(screen.getByRole('switch', { name: /Cyrus/ }));

    expect(client.setSelection).toHaveBeenCalledWith('o-cmc', true);
    expect(screen.getByRole('switch', { name: /Cyrus/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Team for this DD/ })).toHaveTextContent('8 of 11 on');
  });

  it('switches an agent off', async () => {
    const user = userEvent.setup();
    const client = selectionClient(SELECTED);
    renderPicker(client);
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    await user.click(screen.getByRole('switch', { name: /Oona/ }));

    expect(client.setSelection).toHaveBeenCalledWith('sp-orphan', false);
    expect(screen.getByRole('switch', { name: /Oona/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: /Team for this DD/ })).toHaveTextContent('6 of 11 on');
  });

  it('keeps the count and the switch as they were when saving fails, and says why with a reference', async () => {
    const user = userEvent.setup();
    const client = selectionClient(SELECTED);
    client.setSelection.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Could not save the selection.', correlationId: 'corr-p1' },
      message: 'Could not save the selection.',
    });
    renderPicker(client);
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    await user.click(screen.getByRole('switch', { name: /Cyrus/ }));

    expect(screen.getByRole('switch', { name: /Cyrus/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent('corr-p1');
    expect(screen.getByRole('button', { name: /Team for this DD/ })).toHaveTextContent('7 of 11 on');
  });

  it('closes again from the same button', async () => {
    const user = userEvent.setup();
    renderPicker(selectionClient(SELECTED));
    const toggle = await screen.findByRole('button', { name: /Team for this DD/ });
    await user.click(toggle);

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('does not show a count or any switch while the selection is unknown: unknown is never shown as off', async () => {
    const user = userEvent.setup();
    const client = selectionClient(SELECTED);
    let release: () => void = () => undefined;
    client.getSelection.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok<SelectionResponse>({ workspaceId: 'demo', selected: SELECTED, source: 'saved' }));
        }),
    );
    renderPicker(client);

    const toggle = screen.getByRole('button', { name: /Team for this DD/ });
    expect(toggle).not.toHaveTextContent(/ of \d+ on/);
    expect(toggle).not.toHaveTextContent('·');
    await user.click(toggle);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Loading the selection…')).toBeInTheDocument();

    await act(async () => release());
    expect(await screen.findAllByRole('switch')).not.toHaveLength(0);
    expect(toggle).toHaveTextContent('7 of 11 on');
  });

  it('says the selection could not be loaded, shows no switch, and retries', async () => {
    const user = userEvent.setup();
    const client = selectionClient(SELECTED);
    client.getSelection
      .mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' })
      .mockResolvedValueOnce(ok<SelectionResponse>({ workspaceId: 'demo', selected: SELECTED, source: 'saved' }));
    renderPicker(client);
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findAllByRole('switch')).not.toHaveLength(0);
    expect(client.getSelection).toHaveBeenCalledTimes(2);
  });

  it('shows nothing without a selection provider', () => {
    const { container } = render(<TeamPicker agents={ROSTER} />);

    expect(container).toBeEmptyDOMElement();
  });
});
