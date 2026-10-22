// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { CYRUS, EMEKA, OONA } from '@/client/test-fixtures';
import type { DdSetupResponse, PublicAgent, SelectionResponse } from '@/shared/contracts';
import { AddAgentOffer } from './AddAgentOffer';
import { DdSetupProvider, useDdSetup } from './DdSetupProvider';
import { SelectionProvider } from './SelectionProvider';

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

function renderOffer(client: ReturnType<typeof selectionClient>, agents: PublicAgent[] = [OONA]) {
  return render(
    <SelectionProvider client={client}>
      <AddAgentOffer agents={agents} />
    </SelectionProvider>,
  );
}

describe('AddAgentOffer', () => {
  it('offers a button for an agent who is not selected, and adds them through POST /api/selection', async () => {
    const user = userEvent.setup();
    const client = selectionClient(['reglead']);
    renderOffer(client);

    await user.click(await screen.findByRole('button', { name: /Add Oona/ }));

    expect(client.setSelection).toHaveBeenCalledWith('sp-orphan', true);
    expect(await screen.findByText('Added: Oona can join from your next question.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Oona/ })).not.toBeInTheDocument();
  });

  it('says only that an agent is on the team, with no button, no request and no promise, when they were already selected', async () => {
    const client = selectionClient(['sp-orphan']);
    renderOffer(client);

    expect(await screen.findByText('Oona is on the team.')).toBeInTheDocument();
    expect(screen.queryByText(/Added|join/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Oona/ })).not.toBeInTheDocument();
    expect(client.setSelection).not.toHaveBeenCalled();
  });

  it('says "Added" only in the offer that was clicked: another offer for the same agent just says they are on the team', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    render(
      <SelectionProvider client={client}>
        <div data-testid="first">
          <AddAgentOffer agents={[OONA]} />
        </div>
        <div data-testid="second">
          <AddAgentOffer agents={[OONA]} />
        </div>
      </SelectionProvider>,
    );

    await user.click(await within(await screen.findByTestId('first')).findByRole('button', { name: /Add Oona/ }));

    expect(await within(screen.getByTestId('first')).findByText('Added: Oona can join from your next question.')).toBeInTheDocument();
    expect(within(screen.getByTestId('second')).getByText('Oona is on the team.')).toBeInTheDocument();
  });

  it('keeps keyboard focus in place after adding: it moves to the confirmation instead of falling to the page', async () => {
    const user = userEvent.setup();
    renderOffer(selectionClient([]));
    await screen.findByRole('button', { name: /Add Oona/ });

    await user.tab();
    expect(screen.getByRole('button', { name: /Add Oona/ })).toHaveFocus();
    await user.keyboard('{Enter}');

    const confirmation = await screen.findByText('Added: Oona can join from your next question.');
    expect(confirmation).toHaveFocus();
  });

  it('does not pull focus back when the person moved on to something else while it saved', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    let release: () => void = () => undefined;
    client.setSelection.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok<SelectionResponse>({ workspaceId: 'demo', selected: ['sp-orphan'], source: 'saved' }));
        }),
    );
    render(
      <SelectionProvider client={client}>
        <AddAgentOffer agents={[OONA]} />
        <input aria-label="elsewhere" />
      </SelectionProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /Add Oona/ }));
    await user.click(screen.getByRole('textbox', { name: 'elsewhere' }));
    expect(screen.getByRole('textbox', { name: 'elsewhere' })).toHaveFocus();

    await act(async () => release());

    expect(await screen.findByText('Added: Oona can join from your next question.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'elsewhere' })).toHaveFocus();
  });

  it('does not take focus when the agent was already on the team', async () => {
    renderOffer(selectionClient(['sp-orphan']));

    await screen.findByText('Oona is on the team.');

    expect(document.body).toHaveFocus();
  });

  it('offers one button per agent, and adding one leaves the other as it was', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    renderOffer(client, [OONA, CYRUS]);

    await user.click(await screen.findByRole('button', { name: /Add Cyrus/ }));

    expect(client.setSelection).toHaveBeenCalledTimes(1);
    expect(client.setSelection).toHaveBeenCalledWith('o-cmc', true);
    expect(screen.getByRole('button', { name: /Add Oona/ })).toBeEnabled();
    expect(screen.getByText(/Added: Cyrus/)).toBeInTheDocument();
  });

  it('is busy while saving and sends one request for a double click', async () => {
    const client = selectionClient([]);
    let release: () => void = () => undefined;
    client.setSelection.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok<SelectionResponse>({ workspaceId: 'demo', selected: ['sp-orphan'], source: 'saved' }));
        }),
    );
    renderOffer(client);
    const button = await screen.findByRole('button', { name: /Add Oona/ });

    act(() => {
      button.click();
      button.click();
    });

    expect(client.setSelection).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    expect(await screen.findByText(/Added: Oona/)).toBeInTheDocument();
  });

  it('keeps the button when saving fails, and says why with a reference', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    client.setSelection.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Could not save the selection.', correlationId: 'corr-o1' },
      message: 'Could not save the selection.',
    });
    renderOffer(client);

    await user.click(await screen.findByRole('button', { name: /Add Oona/ }));

    expect(screen.getByRole('button', { name: /Add Oona/ })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: Could not save the selection.');
    expect(screen.getByRole('alert')).toHaveTextContent('corr-o1');
    expect(screen.queryByText(/Added|is on the team/)).not.toBeInTheDocument();
  });

  it('shows one failed save once, in the offer that made the attempt, not in every offer for that agent', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    client.setSelection.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Could not save the selection.', correlationId: 'corr-o2' },
      message: 'Could not save the selection.',
    });
    render(
      <SelectionProvider client={client}>
        <div data-testid="first">
          <AddAgentOffer agents={[OONA]} />
        </div>
        <div data-testid="second">
          <AddAgentOffer agents={[OONA]} />
        </div>
        <div data-testid="third">
          <AddAgentOffer agents={[OONA]} />
        </div>
      </SelectionProvider>,
    );

    await user.click(await within(await screen.findByTestId('second')).findByRole('button', { name: /Add Oona/ }));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(screen.getByTestId('second')).getByRole('alert')).toHaveTextContent('corr-o2');
    expect(within(screen.getByTestId('first')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no button while the selection is unknown, then the buttons once it is known', async () => {
    const client = selectionClient([]);
    renderOffer(client);

    expect(screen.queryByRole('button', { name: /Add Oona/ })).not.toBeInTheDocument();
    expect(screen.getByText('Loading selection…')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Add Oona/ })).toBeInTheDocument();
  });

  it('says the selection could not be loaded, offers no button, and retries', async () => {
    const user = userEvent.setup();
    const client = selectionClient([]);
    client.getSelection
      .mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' })
      .mockResolvedValueOnce(ok<SelectionResponse>({ workspaceId: 'demo', selected: [], source: 'saved' }));
    renderOffer(client);

    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(screen.queryByRole('button', { name: /Add Oona/ })).not.toBeInTheDocument();
    await user.click(retry);

    expect(await screen.findByRole('button', { name: /Add Oona/ })).toBeInTheDocument();
    expect(client.getSelection).toHaveBeenCalledTimes(2);
  });

  it('shows nothing without a selection provider', () => {
    const { container } = render(<AddAgentOffer agents={[OONA]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('never offers a team role who is always on', async () => {
    const client = selectionClient(['ev']);
    const { container } = renderOffer(client, [EMEKA]);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /Add Emeka/ })).not.toBeInTheDocument();
    expect(within(container).queryByRole('button')).not.toBeInTheDocument();
    expect(client.setSelection).not.toHaveBeenCalled();
  });

  it('waits while the DD setup is being saved, because that save rewrites the selection', async () => {
    const client = {
      ...selectionClient([]),
      getDdSetup: vi.fn<ChatApi['getDdSetup']>().mockResolvedValue(
        ok<DdSetupResponse>({
          workspaceId: 'demo',
          setup: { stage: 'Phase 2', classifications: [] },
          source: 'default',
          selection: { workspaceId: 'demo', selected: [], source: 'default' },
        }),
      ),
      setDdSetup: vi.fn<ChatApi['setDdSetup']>(),
    };
    let release: () => void = () => undefined;
    client.setDdSetup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              ok<DdSetupResponse>({
                workspaceId: 'demo',
                setup: { stage: 'Phase 3', classifications: [] },
                source: 'saved',
                selection: { workspaceId: 'demo', selected: [], source: 'saved' },
              }),
            );
        }),
    );
    function Change() {
      const setup = useDdSetup();
      return (
        <button type="button" onClick={() => void setup.change({ stage: 'Phase 3', classifications: [] })}>
          change setup
        </button>
      );
    }
    render(
      <SelectionProvider client={client}>
        <DdSetupProvider client={client}>
          <Change />
          <AddAgentOffer agents={[OONA]} />
        </DdSetupProvider>
      </SelectionProvider>,
    );
    const button = await screen.findByRole('button', { name: /Add Oona/ });
    expect(button).toBeEnabled();

    act(() => screen.getByRole('button', { name: 'change setup' }).click());
    expect(button).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByRole('button', { name: /Add Oona/ })).toBeEnabled();
  });
});
