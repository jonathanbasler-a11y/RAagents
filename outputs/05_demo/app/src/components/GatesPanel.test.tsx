// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { LOCAL_PERSON, type GatesResponse } from '@/shared/contracts';
import { decision, dissent, gateOf, gatesResponse } from '@/shared/gates-fixtures';
import { GatesPanel } from './GatesPanel';
import { GatesProvider } from './GatesProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function fakeClient(initial: GatesResponse = gatesResponse()) {
  return {
    getGates: vi.fn<ChatApi['getGates']>().mockResolvedValue(ok(initial)),
    submitGateDecision: vi.fn<ChatApi['submitGateDecision']>(),
    submitGateDissent: vi.fn<ChatApi['submitGateDissent']>(),
  };
}

const renderPanel = (client: ReturnType<typeof fakeClient>) =>
  render(
    <GatesProvider client={client}>
      <GatesPanel />
    </GatesProvider>,
  );

const card = async (title: RegExp) => screen.findByRole('article', { name: title });
const SCOPE = /Scope and activation/;
const EVIDENCE = /The evidence is enough/;
const RELEASE = /Release the briefing/;

describe('GatesPanel: reading', () => {
  it('shows nothing without a provider', () => {
    const { container } = render(<GatesPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says it is loading, and never shows a gate as decided or not decided before it knows', async () => {
    const client = fakeClient();
    let finish: (value: ApiResult<GatesResponse>) => void = () => undefined;
    client.getGates.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderPanel(client);

    expect(screen.getByText('Loading the gates…')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('Not decided yet')).not.toBeInTheDocument();
    await act(async () => finish(ok(gatesResponse())));
    expect(await card(SCOPE)).toBeInTheDocument();
  });

  it('says the gates could not be loaded, and loads them on retry', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    // Every read fails (the provider's first read and the panel's own refresh on opening), then the server is back.
    client.getGates.mockResolvedValue({ ok: false, status: 0, error: null, message: 'Could not reach the server.' });
    renderPanel(client);

    expect(await screen.findByRole('alert')).toHaveTextContent('The gates could not be loaded. Could not reach the server.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    client.getGates.mockResolvedValue(ok(gatesResponse()));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await card(SCOPE)).toBeInTheDocument();
  });

  it('says what the page is, that no model is involved, and that there is no login', async () => {
    renderPanel(fakeClient());

    expect(await screen.findByRole('heading', { level: 1, name: 'Gates' })).toBeInTheDocument();
    expect(screen.getByText(/built by code from what is in the app; no model is involved/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`This app has no login: a decision is recorded as “${LOCAL_PERSON.replace(/[()]/g, '\\$&')}”`))).toBeInTheDocument();
  });

  it('lists the decisions only a person makes, and the disagreement rule', async () => {
    const data = gatesResponse();
    renderPanel(fakeClient(data));

    const box = await screen.findByRole('region', { name: 'Only a person decides these' });
    for (const line of data.alwaysHuman) expect(within(box).getByText(line)).toBeInTheDocument();
    expect(within(box).getByText(data.disagreementRule)).toBeInTheDocument();
  });

  it('shows the three gates in order, each with its question, facts, recommended call and what would move it', async () => {
    renderPanel(fakeClient(gatesResponse({ drafts: 3, states: { regions: 'not_checked' } })));

    const evidence = await card(EVIDENCE);
    const all = screen.getAllByRole('article').map((entry) => entry.getAttribute('aria-labelledby'));
    expect(all).toEqual(['gate-scope', 'gate-evidence', 'gate-release']);
    expect(within(evidence).getByText('Is the evidence enough to build the briefing on, or must more be decided, checked or provided first?')).toBeInTheDocument();
    expect(within(evidence).getByText('Drafts not decided')).toBeInTheDocument();
    expect(within(evidence).getByText('3')).toBeInTheDocument();
    expect(within(evidence).getByText(/Recommended:/)).toHaveTextContent('Recommended: Ask for more information.');
    expect(within(evidence).getByText(/3 draft findings are not decided\./)).toBeInTheDocument();
    expect(within(evidence).getByText('Deciding the 3 draft findings.')).toBeInTheDocument();
    expect(within(evidence).getByText('Setting the 1 checklist item that is not checked.')).toBeInTheDocument();
  });

  it('offers the four options with their cost, marks the recommended one, and preselects nothing', async () => {
    renderPanel(fakeClient());

    const scope = await card(SCOPE);
    const radios = within(scope).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['proceed', 'pause', 'seek_more', 'stop']);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(within(scope).getByRole('radio', { name: /^Go ahead \(recommended\)/ })).toBeInTheDocument();
    expect(within(scope).getByRole('radio', { name: /^Pause/ })).not.toHaveAccessibleName(/recommended/);
    expect(within(scope).getByText(/The team starts on this setup and these documents\./)).toBeInTheDocument();
    expect(within(scope).getByRole('button', { name: 'Record decision' })).toBeDisabled();
  });

  it('shows the release gate\'s own words: going ahead is not a view on the deal', async () => {
    renderPanel(fakeClient());

    const release = await card(RELEASE);

    expect(within(release).getAllByText(/not a view on the deal/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows each gate\'s status in words', async () => {
    const first = gatesResponse();
    const scopeDecision = decision(gateOf(first.gates, 'scope'), 'proceed');
    const stale = decision(gateOf(first.gates, 'evidence'), 'seek_more', { factsHash: 'older-facts' });
    renderPanel(fakeClient(gatesResponse({}, { decisions: [scopeDecision, stale] })));

    expect(within(await card(SCOPE)).getByText('Decided')).toBeInTheDocument();
    expect(within(await card(EVIDENCE)).getByText('Decided on earlier facts')).toBeInTheDocument();
    expect(within(await card(RELEASE)).getByText('Not decided yet')).toBeInTheDocument();
  });

  it('warns on a gate decided on earlier facts and says to decide again', async () => {
    const first = gatesResponse();
    const stale = decision(gateOf(first.gates, 'scope'), 'proceed', { factsHash: 'older-facts' });
    renderPanel(fakeClient(gatesResponse({}, { decisions: [stale] })));

    const scope = await card(SCOPE);

    expect(within(scope).getByRole('status')).toHaveTextContent('The facts changed since the latest decision: decide again if it still holds.');
  });
});

describe('GatesPanel: deciding', () => {
  it('records the recommended call without a reason, sending the choice and the facts hash only', async () => {
    const user = userEvent.setup();
    const data = gatesResponse();
    const client = fakeClient(data);
    client.submitGateDecision.mockResolvedValue(ok(gatesResponse({}, { decisions: [decision(gateOf(data.gates, 'scope'), 'proceed')] })));
    renderPanel(client);
    const scope = await card(SCOPE);

    await user.click(within(scope).getByRole('radio', { name: /^Go ahead/ }));
    expect(within(scope).getByRole('textbox', { name: 'Reason (optional)' })).toBeInTheDocument();
    await user.click(within(scope).getByRole('button', { name: 'Record decision' }));

    expect(client.submitGateDecision).toHaveBeenCalledTimes(1);
    const [gate, request] = client.submitGateDecision.mock.calls[0];
    expect(gate).toBe('scope');
    expect(request).toEqual({ option: 'proceed', factsHash: gateOf(data.gates, 'scope').factsHash });
    expect(Object.keys(request)).toEqual(['option', 'factsHash']);
    expect(await within(await card(SCOPE)).findByText('Decided')).toBeInTheDocument();
  });

  it('asks for a reason, in its label, when the choice differs from the recommended call, and sends nothing without one', async () => {
    const user = userEvent.setup();
    const client = fakeClient(gatesResponse({ drafts: 2 })); // open drafts: the evidence gate recommends asking for more information
    renderPanel(client);
    const evidence = await card(EVIDENCE);
    expect(within(evidence).getByText(/Recommended:/)).toHaveTextContent('Recommended: Ask for more information.');

    await user.click(within(evidence).getByRole('radio', { name: /^Go ahead/ }));

    expect(within(evidence).getByRole('textbox', { name: 'Reason (required: you chose something other than the recommended call)' })).toBeInTheDocument();
    await user.click(within(evidence).getByRole('button', { name: 'Record decision' }));
    expect(within(evidence).getByRole('alert')).toHaveTextContent('Give a reason: you chose something other than the recommended call.');
    expect(client.submitGateDecision).not.toHaveBeenCalled();
  });

  it('sends the reason, trimmed, when one is given for a different choice', async () => {
    const user = userEvent.setup();
    const data = gatesResponse({ drafts: 2 });
    const client = fakeClient(data);
    client.submitGateDecision.mockResolvedValue(ok(data));
    renderPanel(client);
    const evidence = await card(EVIDENCE);

    await user.click(within(evidence).getByRole('radio', { name: /^Go ahead/ }));
    await user.type(within(evidence).getByRole('textbox', { name: /^Reason \(required/ }), '  The seller sends the rest on Friday.  ');
    await user.click(within(evidence).getByRole('button', { name: 'Record decision' }));

    expect(client.submitGateDecision).toHaveBeenCalledWith('evidence', {
      option: 'proceed',
      reason: 'The seller sends the rest on Friday.',
      factsHash: gateOf(data.gates, 'evidence').factsHash,
    });
  });

  it('takes the reason requirement away when the person goes back to the recommended call', async () => {
    const user = userEvent.setup();
    renderPanel(fakeClient(gatesResponse({ drafts: 2 })));
    const evidence = await card(EVIDENCE);

    await user.click(within(evidence).getByRole('radio', { name: /^Go ahead/ }));
    expect(within(evidence).getByRole('textbox', { name: /^Reason \(required/ })).toBeInTheDocument();
    await user.click(within(evidence).getByRole('radio', { name: /^Ask for more information/ }));

    expect(within(evidence).getByRole('textbox', { name: 'Reason (optional)' })).toBeInTheDocument();
  });

  it('is busy while a decision is saved: no second click, and the button says so', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    let finish: (value: ApiResult<GatesResponse>) => void = () => undefined;
    client.submitGateDecision.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderPanel(client);
    const scope = await card(SCOPE);
    await user.click(within(scope).getByRole('radio', { name: /^Go ahead/ }));

    await user.click(within(scope).getByRole('button', { name: 'Record decision' }));

    expect(within(scope).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    for (const other of screen.getAllByRole('button', { name: 'Record decision' })) expect(other).toBeDisabled();
    await act(async () => finish(ok(gatesResponse())));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument());
  });

  it('says a decision was not saved, under that gate only, with the reference', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.submitGateDecision.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Something went wrong on the server.', correlationId: 'corr-5' },
      message: 'Something went wrong on the server.',
    });
    renderPanel(client);
    const scope = await card(SCOPE);
    await user.click(within(scope).getByRole('radio', { name: /^Go ahead/ }));

    await user.click(within(scope).getByRole('button', { name: 'Record decision' }));

    expect(within(scope).getByRole('alert')).toHaveTextContent('Not saved: Something went wrong on the server. Reference corr-5');
    expect(within(await card(EVIDENCE)).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(scope).getByText('Not decided yet')).toBeInTheDocument();
  });

  it('starts the form again from what is true when the facts change under it', async () => {
    const user = userEvent.setup();
    const client = fakeClient(gatesResponse({ drafts: 3 }));
    renderPanel(client);
    const evidence = await card(EVIDENCE);
    await user.click(within(evidence).getByRole('radio', { name: /^Go ahead/ }));
    await user.type(within(evidence).getByRole('textbox', { name: /^Reason \(required/ }), 'half written');

    client.getGates.mockResolvedValue(ok(gatesResponse({ drafts: 0 })));
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const fresh = await card(EVIDENCE);
    await waitFor(() => expect(within(fresh).getByText('Every draft is decided, every accepted finding is tagged, and every checklist item is set to checked or not applicable.')).toBeInTheDocument());
    expect(within(fresh).getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });
});

describe('GatesPanel: history and dissent', () => {
  function withHistory() {
    const first = gatesResponse();
    const scope = gateOf(first.gates, 'scope');
    const earlier = decision(scope, 'pause', { id: 'GD-1', createdAt: '2026-10-21T09:00:00.000Z', reason: 'The licensor asked for a week.' });
    const later = decision(scope, 'proceed', { id: 'GD-2', createdAt: '2026-10-22T09:00:00.000Z' });
    const note = dissent(later, { role: 'CMC regulatory agent owner', reason: 'The site data is not in yet.' });
    return gatesResponse({}, { decisions: [earlier, later], dissents: [note] });
  }

  it('lists the decisions, newest first, with the choice, the date, the person and whether it followed the recommendation', async () => {
    renderPanel(fakeClient(withHistory()));
    const scope = await card(SCOPE);

    const items = within(scope).getAllByRole('listitem').filter((item) => item.getAttribute('data-decision') !== null);

    expect(items.map((item) => item.getAttribute('data-decision'))).toEqual(['GD-2', 'GD-1']);
    expect(items[0]).toHaveTextContent('GD-2 · Go ahead · 2026-10-22 · person (local, not authenticated)');
    expect(items[0]).toHaveTextContent('Followed the recommended call.');
    expect(items[1]).toHaveTextContent('GD-1 · Pause · 2026-10-21');
    expect(items[1]).toHaveTextContent('Differed from the recommended call (Go ahead).');
    expect(items[1]).toHaveTextContent('The licensor asked for a week.');
  });

  it('shows the facts as they were when the decision was taken', async () => {
    renderPanel(fakeClient(withHistory()));
    const scope = await card(SCOPE);

    const first = within(scope).getAllByText('Facts at the time')[0].closest('details') as HTMLElement;

    expect(within(first).getByText('Stage')).toBeInTheDocument();
    expect(within(first).getByText('Phase 2')).toBeInTheDocument();
  });

  it('shows the dissents under their decision, with the function and the reason', async () => {
    renderPanel(fakeClient(withHistory()));
    const scope = await card(SCOPE);

    const latest = within(scope).getAllByRole('listitem').find((item) => item.getAttribute('data-decision') === 'GD-2') as HTMLElement;

    expect(latest).toHaveTextContent('Dissent from CMC regulatory agent owner: The site data is not in yet.');
  });

  it('records a dissent under a decision: the decision, the function and the reason', async () => {
    const user = userEvent.setup();
    const data = withHistory();
    const client = fakeClient(data);
    client.submitGateDissent.mockResolvedValue(ok(data));
    renderPanel(client);
    const scope = await card(SCOPE);
    const latest = within(scope).getAllByRole('listitem').find((item) => item.getAttribute('data-decision') === 'GD-2') as HTMLElement;

    await user.click(within(latest).getByText('Add a dissent'));
    await user.type(within(latest).getByRole('textbox', { name: 'Function the dissent speaks for' }), '  Quality agent owner ');
    await user.type(within(latest).getByRole('textbox', { name: 'Reason for the dissent' }), ' Inspection history is missing. ');
    await user.click(within(latest).getByRole('button', { name: 'Record dissent' }));

    expect(client.submitGateDissent).toHaveBeenCalledWith('scope', { decisionId: 'GD-2', role: 'Quality agent owner', reason: 'Inspection history is missing.' });
  });

  it('asks for both the function and the reason, and sends nothing without them', async () => {
    const user = userEvent.setup();
    const data = withHistory();
    const client = fakeClient(data);
    renderPanel(client);
    const scope = await card(SCOPE);
    const latest = within(scope).getAllByRole('listitem').find((item) => item.getAttribute('data-decision') === 'GD-2') as HTMLElement;
    await user.click(within(latest).getByText('Add a dissent'));

    await user.click(within(latest).getByRole('button', { name: 'Record dissent' }));
    expect(within(latest).getByRole('alert')).toHaveTextContent('Say which function the dissent speaks for, and give the reason.');

    await user.type(within(latest).getByRole('textbox', { name: 'Function the dissent speaks for' }), 'Quality');
    await user.click(within(latest).getByRole('button', { name: 'Record dissent' }));
    expect(within(latest).getByRole('alert')).toHaveTextContent('Say which function the dissent speaks for, and give the reason.');
    expect(client.submitGateDissent).not.toHaveBeenCalled();
  });

  it('says a dissent was not saved, under its decision, with the reference', async () => {
    const user = userEvent.setup();
    const data = withHistory();
    const client = fakeClient(data);
    client.submitGateDissent.mockResolvedValue({
      ok: false,
      status: 404,
      error: { error: 'gate_decision_not_found', message: 'There is no such decision at this gate.', correlationId: 'corr-8' },
      message: 'There is no such decision at this gate.',
    });
    renderPanel(client);
    const scope = await card(SCOPE);
    const latest = within(scope).getAllByRole('listitem').find((item) => item.getAttribute('data-decision') === 'GD-2') as HTMLElement;
    await user.click(within(latest).getByText('Add a dissent'));
    await user.type(within(latest).getByRole('textbox', { name: 'Function the dissent speaks for' }), 'Quality');
    await user.type(within(latest).getByRole('textbox', { name: 'Reason for the dissent' }), 'No.');

    await user.click(within(latest).getByRole('button', { name: 'Record dissent' }));

    expect(within(latest).getByRole('alert')).toHaveTextContent('Not saved: There is no such decision at this gate. Reference corr-8');
  });
});
