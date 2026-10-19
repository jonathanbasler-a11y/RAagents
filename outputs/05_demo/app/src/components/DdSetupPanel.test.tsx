// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { OLU, ROSTER } from '@/client/test-fixtures';
import type { DdSetup, DdSetupResponse, SelectionResponse } from '@/shared/contracts';
import { DdSetupPanel } from './DdSetupPanel';
import { DdSetupProvider } from './DdSetupProvider';
import { SelectionProvider } from './SelectionProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const DEFAULT_SETUP: DdSetup = { stage: 'Phase 2', classifications: ['orphan', 'paed'] };

function setupReply(setup: DdSetup, selected: string[], source: 'default' | 'saved' = 'saved'): ApiResult<DdSetupResponse> {
  return ok<DdSetupResponse>({ workspaceId: 'demo', setup, source, selection: { workspaceId: 'demo', selected, source: 'saved' } });
}

function clientWith(selected: string[]) {
  return {
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockResolvedValue(ok<SelectionResponse>({ workspaceId: 'demo', selected, source: 'default' })),
    setSelection: vi.fn<ChatApi['setSelection']>(),
    getDdSetup: vi.fn<ChatApi['getDdSetup']>().mockResolvedValue(setupReply(DEFAULT_SETUP, selected, 'default')),
    setDdSetup: vi.fn<ChatApi['setDdSetup']>(),
  };
}

function renderPanel(client: ReturnType<typeof clientWith>) {
  return render(
    <SelectionProvider client={client}>
      <DdSetupProvider client={client}>
        <DdSetupPanel agents={ROSTER} />
      </DdSetupProvider>
    </SelectionProvider>,
  );
}

const stage = (name: string) => screen.findByRole('radio', { name });
const classification = (name: string) => screen.findByRole('checkbox', { name });

describe('DdSetupPanel', () => {
  it('shows no controls while the setup loads: unknown is never shown as the default', () => {
    renderPanel(clientWith(['reglead']));

    expect(screen.getByText('Loading the DD setup…')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the stage and the classifications as saved, and says when it is only the default', async () => {
    renderPanel(clientWith(['reglead']));

    const stages = within(await screen.findByRole('group', { name: 'Stage' }));
    expect(stages.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['Phase 1', 'Phase 2', 'Phase 3', 'Filed']);
    expect(await stage('Phase 2')).toBeChecked();
    expect(await stage('Phase 3')).not.toBeChecked();
    const classes = within(screen.getByRole('group', { name: 'Classification' }));
    expect(classes.getAllByRole('checkbox')).toHaveLength(5);
    expect(await classification('Orphan')).toBeChecked();
    expect(await classification('Paediatric requirements')).toBeChecked();
    expect(await classification('Expedited programme')).not.toBeChecked();
    expect(screen.getByText(/Default setup: nothing saved yet/)).toBeInTheDocument();
  });

  it('saves a stage change as one whole setup, shows who joined, and stops calling it the default', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.setDdSetup.mockResolvedValue(setupReply({ stage: 'Phase 3', classifications: ['orphan', 'paed'] }, ['reglead', OLU.id]));
    renderPanel(client);

    await user.click(await stage('Phase 3'));

    expect(client.setDdSetup).toHaveBeenCalledTimes(1);
    expect(client.setDdSetup).toHaveBeenCalledWith({ stage: 'Phase 3', classifications: ['orphan', 'paed'] });
    expect(await screen.findByText('Saved. Olu joined the team.')).toBeInTheDocument();
    expect(await stage('Phase 3')).toBeChecked();
    expect(screen.queryByText(/Default setup/)).not.toBeInTheDocument();
  });

  it('says the team stays the same when the save changed nobody', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.setDdSetup.mockResolvedValue(setupReply({ stage: 'Phase 1', classifications: ['orphan', 'paed'] }, ['reglead']));
    renderPanel(client);

    await user.click(await stage('Phase 1'));

    expect(await screen.findByText('Saved. The team stays the same.')).toBeInTheDocument();
  });

  it('says only "Saved." when the team before the save was not known', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.getSelection.mockResolvedValue({ ok: false, status: 0, error: null, message: 'Could not reach the server.' });
    client.setDdSetup.mockResolvedValue(setupReply({ stage: 'Phase 3', classifications: ['orphan', 'paed'] }, ['reglead', OLU.id]));
    renderPanel(client);

    await user.click(await stage('Phase 3'));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('sends classifications in the fixed order whichever one was changed', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.getDdSetup.mockResolvedValue(setupReply({ stage: 'Phase 2', classifications: ['paed'] }, ['reglead'], 'saved'));
    client.setDdSetup.mockImplementation(async (setup) => setupReply(setup, ['reglead']));
    renderPanel(client);

    await user.click(await classification('Orphan'));
    await user.click(await classification('Companion diagnostic'));
    await user.click(await classification('Paediatric requirements'));

    expect(client.setDdSetup.mock.calls.map(([setup]) => setup.classifications)).toEqual([
      ['orphan', 'paed'],
      ['orphan', 'paed', 'cdx'],
      ['orphan', 'cdx'],
    ]);
  });

  it('sends one request for a double click, and ignores changes while it saves', async () => {
    const client = clientWith(['reglead']);
    let release: () => void = () => undefined;
    client.setDdSetup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(setupReply({ stage: 'Phase 3', classifications: ['orphan', 'paed'] }, ['reglead']));
        }),
    );
    renderPanel(client);
    const phase3 = await stage('Phase 3');
    const filed = await stage('Filed');

    act(() => {
      phase3.click();
      filed.click();
    });

    expect(client.setDdSetup).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Stage' })).getAllByRole('radio')[0]).toHaveAttribute('aria-disabled', 'true');
    await act(async () => release());
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('keeps the old setup when saving fails, and shows why with a reference', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.setDdSetup.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Could not save the setup.', correlationId: 'corr-p1' },
      message: 'Could not save the setup.',
    });
    renderPanel(client);

    await user.click(await stage('Phase 3'));

    expect(await stage('Phase 2')).toBeChecked();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Not saved: Could not save the setup.');
    expect(alert).toHaveTextContent('corr-p1');
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it('says the setup could not be loaded, and retries', async () => {
    const user = userEvent.setup();
    const client = clientWith(['reglead']);
    client.getDdSetup
      .mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' })
      .mockResolvedValueOnce(setupReply(DEFAULT_SETUP, ['reglead'], 'saved'));
    renderPanel(client);

    expect(await screen.findByRole('alert')).toHaveTextContent('The DD setup could not be loaded');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(await stage('Phase 2')).toBeChecked();
    expect(client.getDdSetup).toHaveBeenCalledTimes(2);
  });

  it('renders nothing outside a provider', () => {
    const { container } = render(<DdSetupPanel agents={ROSTER} />);

    expect(container).toBeEmptyDOMElement();
  });
});
