// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { GatesResponse } from '@/shared/contracts';
import { decision, gateOf, gatesResponse } from '@/shared/gates-fixtures';
import { GatesProvider } from './GatesProvider';
import { GatesSummary } from './GatesSummary';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function fakeClient(initial: GatesResponse = gatesResponse()) {
  return {
    getGates: vi.fn<ChatApi['getGates']>().mockResolvedValue(ok(initial)),
    submitGateDecision: vi.fn<ChatApi['submitGateDecision']>(),
    submitGateDissent: vi.fn<ChatApi['submitGateDissent']>(),
  };
}

const renderCard = (client: ReturnType<typeof fakeClient>) =>
  render(
    <GatesProvider client={client}>
      <GatesSummary />
    </GatesProvider>,
  );

describe('GatesSummary', () => {
  it('shows nothing without a provider', () => {
    const { container } = render(<GatesSummary />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says it is loading, and shows no gate as decided or not decided, before it knows', () => {
    const client = fakeClient();
    client.getGates.mockImplementation(() => new Promise(() => undefined));
    renderCard(client);

    expect(screen.getByText('Loading the gates…')).toBeInTheDocument();
    expect(screen.queryByText(/Not decided yet|Decided/)).not.toBeInTheDocument();
  });

  it('says the gates could not be loaded', async () => {
    const client = fakeClient();
    client.getGates.mockResolvedValue({ ok: false, status: 0, error: null, message: 'Could not reach the server.' });
    renderCard(client);

    expect(await screen.findByText('The gates could not be loaded.')).toBeInTheDocument();
  });

  it('lists the three gates with their status and the recommended call, and says a person decides', async () => {
    const first = gatesResponse();
    const decided = decision(gateOf(first.gates, 'scope'), 'proceed');
    renderCard(fakeClient(gatesResponse({}, { decisions: [decided] })));

    const card = await screen.findByRole('region', { name: 'Gates' });
    const rows = within(card).getAllByRole('listitem').map((row) => row.textContent);

    expect(rows).toEqual([
      'Scope and activation: Decided · recommended: Go ahead.',
      'The evidence is enough: Not decided yet · recommended: Go ahead.',
      'Release the briefing: Not decided yet · recommended: Ask for more information.',
    ]);
    expect(within(card).getByText(/A person decides at each\./)).toBeInTheDocument();
  });

  it('marks a gate decided on earlier facts', async () => {
    const first = gatesResponse();
    const stale = decision(gateOf(first.gates, 'scope'), 'proceed', { factsHash: 'older-facts' });
    renderCard(fakeClient(gatesResponse({}, { decisions: [stale] })));

    expect(await screen.findByText(/Scope and activation: Decided on earlier facts/)).toBeInTheDocument();
  });

  it('links to the gates page', async () => {
    renderCard(fakeClient());

    expect(await screen.findByRole('link', { name: 'Open the gates' })).toHaveAttribute('href', '/gates');
    await waitFor(() => expect(screen.queryByText('Loading the gates…')).not.toBeInTheDocument());
  });
});
