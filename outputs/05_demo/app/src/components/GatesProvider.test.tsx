// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { GatesResponse } from '@/shared/contracts';
import { decision, gateOf, gatesResponse } from '@/shared/gates-fixtures';
import { GatesProvider, useGates } from './GatesProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = (message: string, status = 500, correlationId: string | null = 'corr-1'): ApiResult<never> => ({
  ok: false,
  status,
  error: correlationId === null ? null : { error: 'internal', message, correlationId },
  message,
});

function fakeClient(initial: GatesResponse = gatesResponse()) {
  return {
    getGates: vi.fn<ChatApi['getGates']>().mockResolvedValue(ok(initial)),
    submitGateDecision: vi.fn<ChatApi['submitGateDecision']>(),
    submitGateDissent: vi.fn<ChatApi['submitGateDissent']>(),
  };
}

/** Shows what the provider holds, and exposes its actions as buttons. */
function Probe({ gate = 'scope' as const }) {
  const gates = useGates();
  return (
    <div>
      <p data-testid="status">{gates.status}</p>
      <p data-testid="statuses">{gates.data?.gates.map((entry) => `${entry.id}:${entry.status}`).join(',') ?? 'unknown'}</p>
      <p data-testid="saving">{gates.saving ? `${gates.saving.gate}/${gates.saving.kind}` : 'none'}</p>
      <p data-testid="error">{gates.saveError ? `${gates.saveError.gate}/${gates.saveError.kind}: ${gates.saveError.message} ${gates.saveError.correlationId ?? ''}` : 'none'}</p>
      <p data-testid="load-error">{gates.loadError ? gates.loadError.message : 'none'}</p>
      <button type="button" onClick={() => void gates.decide(gate, { option: 'proceed', factsHash: 'h' })}>
        decide
      </button>
      <button type="button" onClick={() => void gates.dissent(gate, { decisionId: 'GD-1', role: 'Quality', reason: 'No.' })}>
        dissent
      </button>
      <button type="button" onClick={() => void gates.refresh()}>
        refresh
      </button>
      <button type="button" onClick={gates.reload}>
        reload
      </button>
    </div>
  );
}

const renderProbe = (client: ReturnType<typeof fakeClient>) =>
  render(
    <GatesProvider client={client}>
      <Probe />
    </GatesProvider>,
  );

describe('GatesProvider', () => {
  it('has nothing to show without a provider', () => {
    render(<Probe />);

    expect(screen.getByTestId('status')).toHaveTextContent('unavailable');
    expect(screen.getByTestId('statuses')).toHaveTextContent('unknown');
  });

  it('is loading, then ready with the gates; unknown is never shown as decided', async () => {
    const client = fakeClient();
    renderProbe(client);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('statuses')).toHaveTextContent('unknown');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('statuses')).toHaveTextContent('scope:not_decided,evidence:not_decided,release:not_decided');
  });

  it('says the gates could not be loaded, and loads them on retry', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.getGates.mockResolvedValueOnce(failure('Could not reach the server.', 0, null));
    renderProbe(client);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(screen.getByTestId('load-error')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByTestId('statuses')).toHaveTextContent('unknown');

    await user.click(screen.getByRole('button', { name: 'reload' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('load-error')).toHaveTextContent('none');
    expect(client.getGates).toHaveBeenCalledTimes(2);
  });

  it('records a decision: sends it, takes the new state of every gate from the reply, and says it saved', async () => {
    const user = userEvent.setup();
    const before = gatesResponse();
    const decided = gatesResponse({}, { decisions: [decision(gateOf(before.gates, 'scope'), 'seek_more')] });
    const client = fakeClient(before);
    client.submitGateDecision.mockResolvedValue(ok(decided));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'decide' }));

    expect(client.submitGateDecision).toHaveBeenCalledWith('scope', { option: 'proceed', factsHash: 'h' });
    await waitFor(() => expect(screen.getByTestId('statuses')).toHaveTextContent('scope:decided'));
    expect(screen.getByTestId('saving')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('is busy while saving and sends one request for a double click', async () => {
    const client = fakeClient();
    let finish: (value: ApiResult<GatesResponse>) => void = () => undefined;
    client.submitGateDecision.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    const button = screen.getByRole('button', { name: 'decide' });

    act(() => {
      button.click();
      button.click();
    });

    expect(client.submitGateDecision).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('saving')).toHaveTextContent('scope/decision');
    await act(async () => finish(ok(gatesResponse())));
    expect(screen.getByTestId('saving')).toHaveTextContent('none');
  });

  it('refuses a dissent while a decision is being saved (one write at a time)', async () => {
    const client = fakeClient();
    let finish: (value: ApiResult<GatesResponse>) => void = () => undefined;
    client.submitGateDecision.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    act(() => {
      screen.getByRole('button', { name: 'decide' }).click();
      screen.getByRole('button', { name: 'dissent' }).click();
    });

    expect(client.submitGateDissent).not.toHaveBeenCalled();
    await act(async () => finish(ok(gatesResponse())));
  });

  it('keeps what it showed when a decision is not saved, and says why with a reference', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDecision.mockResolvedValue(failure('Give a reason: you chose something other than the recommended call.', 400, 'corr-7'));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'decide' }));

    expect(screen.getByTestId('error')).toHaveTextContent('scope/decision: Give a reason: you chose something other than the recommended call. corr-7');
    expect(screen.getByTestId('statuses')).toHaveTextContent('scope:not_decided');
    expect(client.getGates).toHaveBeenCalledTimes(1);
  });

  it('reads the gates again when the facts changed (409), and keeps the message so the person knows why', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDecision.mockResolvedValue({
      ok: false,
      status: 409,
      error: { error: 'gate_facts_changed', message: 'The facts changed since you opened this gate. Reload and look again.', correlationId: 'corr-9' },
      message: 'The facts changed since you opened this gate. Reload and look again.',
    });
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'decide' }));

    await waitFor(() => expect(client.getGates).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('error')).toHaveTextContent('The facts changed since you opened this gate.');
  });

  it('records a dissent the same way', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDissent.mockResolvedValue(ok(gatesResponse()));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'dissent' }));

    expect(client.submitGateDissent).toHaveBeenCalledWith('scope', { decisionId: 'GD-1', role: 'Quality', reason: 'No.' });
    await waitFor(() => expect(screen.getByTestId('saving')).toHaveTextContent('none'));
  });

  it('says a dissent was not saved, with the gate and the kind', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDissent.mockResolvedValue(failure('There is no such decision at this gate.', 404, 'corr-3'));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'dissent' }));

    expect(screen.getByTestId('error')).toHaveTextContent('scope/dissent: There is no such decision at this gate. corr-3');
  });

  it('clears an earlier save error when the next save starts', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDecision.mockResolvedValueOnce(failure('Not saved.', 500, 'corr-1')).mockResolvedValueOnce(ok(gatesResponse()));
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await user.click(screen.getByRole('button', { name: 'decide' }));
    expect(screen.getByTestId('error')).not.toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'decide' }));

    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('refresh reads again without showing loading, and a failed read changes nothing', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    client.getGates.mockResolvedValueOnce(failure('Offline.', 0, null));

    await user.click(screen.getByRole('button', { name: 'refresh' }));

    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('statuses')).toHaveTextContent('scope:not_decided');
    expect(screen.getByTestId('load-error')).toHaveTextContent('none');
  });

  it('a read that started before a save and finished after it does not overwrite the saved state', async () => {
    const user = userEvent.setup();
    const before = gatesResponse();
    const decided = gatesResponse({}, { decisions: [decision(gateOf(before.gates, 'scope'), 'seek_more')] });
    const client = fakeClient(before);
    let finishRead: (value: ApiResult<GatesResponse>) => void = () => undefined;
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    client.getGates.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    client.submitGateDecision.mockResolvedValue(ok(decided));

    act(() => screen.getByRole('button', { name: 'refresh' }).click());
    await user.click(screen.getByRole('button', { name: 'decide' }));
    await waitFor(() => expect(screen.getByTestId('statuses')).toHaveTextContent('scope:decided'));
    await act(async () => finishRead(ok(before)));

    expect(screen.getByTestId('statuses')).toHaveTextContent('scope:decided');
  });

  it('reads again when the tab becomes visible', async () => {
    const client = fakeClient();
    renderProbe(client);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(client.getGates).toHaveBeenCalledTimes(2);
  });
});
