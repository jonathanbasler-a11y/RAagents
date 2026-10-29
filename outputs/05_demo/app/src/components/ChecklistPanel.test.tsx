// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { CHECKLIST_ITEM_IDS, LOCAL_PERSON, type ChecklistResponse, type ChecklistState } from '@/shared/contracts';
import { ChecklistPanel } from './ChecklistPanel';
import { SignInProvider } from './SignIn';
import { ChecklistProvider, useChecklist } from './ChecklistProvider';
import { ChecklistSummary } from './ChecklistSummary';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = <T,>(message: string, status = 400, correlationId: string | null = null): ApiResult<T> => ({
  ok: false,
  status,
  error: correlationId ? { error: 'invalid_request', message, correlationId } : null,
  message,
});

type Patch = Partial<Record<(typeof CHECKLIST_ITEM_IDS)[number], { state: ChecklistState; reason?: string | null; accepted?: number }>>;

function checklist(patch: Patch = {}): ChecklistResponse {
  return {
    workspaceId: 'demo',
    items: CHECKLIST_ITEM_IDS.map((item) => {
      const entry = patch[item];
      return {
        item,
        state: entry?.state ?? 'not_checked',
        reason: entry?.reason ?? null,
        changedAt: entry ? '2026-10-12T09:00:00.000Z' : null,
        changedBy: entry ? LOCAL_PERSON : null,
        acceptedFindings: entry?.accepted ?? 0,
      };
    }),
  };
}

function clientWith(initial: ChecklistResponse = checklist()) {
  return {
    getChecklist: vi.fn<ChatApi['getChecklist']>().mockResolvedValue(ok(initial)),
    getBriefing: vi.fn<ChatApi['getBriefing']>(),
    submitChecklistState: vi.fn<ChatApi['submitChecklistState']>(),
    getGates: vi.fn<ChatApi['getGates']>(),
    submitGateDecision: vi.fn<ChatApi['submitGateDecision']>(),
    submitGateDissent: vi.fn<ChatApi['submitGateDissent']>(),
  };
}

function mountPanel(client: ReturnType<typeof clientWith>, options: { signedIn?: boolean } = {}) {
  render(
    <SignInProvider signedIn={options.signedIn ?? false}>
      <ChecklistProvider client={client}>
        <ChecklistPanel />
      </ChecklistProvider>
    </SignInProvider>,
  );
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('ChecklistProvider', () => {
  const wrapperFor = (client: ReturnType<typeof clientWith>) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <ChecklistProvider client={client}>{children}</ChecklistProvider>;
    };

  it('knows nothing while it loads, then holds the six items', async () => {
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(clientWith()) });

    expect(result.current.status).toBe('loading');
    expect(result.current.items).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(6);
  });

  it('says it could not load, and keeps unknown unknown', async () => {
    const client = clientWith();
    client.getChecklist.mockResolvedValue(failure('Could not reach the server.', 0, 'c-1'));
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toBeUndefined();
    expect(result.current.loadError).toEqual({ message: 'Could not reach the server.', correlationId: 'c-1' });
  });

  it('shows what the server saved after a change, and sends the item, the state and the reason', async () => {
    const client = clientWith();
    client.submitChecklistState.mockResolvedValue(ok(checklist({ designations: { state: 'not_applicable', reason: 'Not an orphan product.' } })));
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let saved = false;
    await act(async () => {
      saved = await result.current.set('designations', 'not_applicable', 'Not an orphan product.');
    });

    expect(saved).toBe(true);
    expect(client.submitChecklistState).toHaveBeenCalledWith('designations', 'not_applicable', 'Not an orphan product.');
    expect(result.current.items?.find((entry) => entry.item === 'designations')).toMatchObject({ state: 'not_applicable', reason: 'Not an orphan product.' });
    expect(result.current.saving).toBeNull();
  });

  it('ignores a second change while one is being saved', async () => {
    const client = clientWith();
    let finish: (value: ApiResult<ChecklistResponse>) => void = () => undefined;
    client.submitChecklistState.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.set('regions', 'could_not_check', 'Plan not provided.');
    });
    expect(result.current.saving).toBe('regions');
    let second = true;
    await act(async () => {
      second = await result.current.set('guidance', 'not_checked');
    });

    expect(second).toBe(false);
    expect(client.submitChecklistState).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(ok(checklist()));
      await first;
    });
    expect(result.current.saving).toBeNull();
  });

  it('reports a refusal against its item, keeps what is shown, and reads the checklist again after a 409', async () => {
    const client = clientWith(checklist());
    client.submitChecklistState.mockResolvedValue({ ok: false, status: 409, error: { error: 'checklist_needs_finding', message: 'An item can be marked checked only when at least one accepted finding is tagged to it.', correlationId: 'c-9' }, message: 'An item can be marked checked only when at least one accepted finding is tagged to it.' });
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.set('regions', 'checked');
    });

    expect(result.current.saveError).toMatchObject({ item: 'regions', correlationId: 'c-9' });
    expect(result.current.items?.find((entry) => entry.item === 'regions')?.state).toBe('not_checked');
    await waitFor(() => expect(client.getChecklist).toHaveBeenCalledTimes(2));
  });

  it('clears an old error when the next change starts', async () => {
    const client = clientWith();
    client.submitChecklistState.mockResolvedValueOnce(failure('Could not reach the server.', 0));
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.set('regions', 'could_not_check', 'Plan not provided.');
    });
    expect(result.current.saveError).not.toBeNull();

    client.submitChecklistState.mockResolvedValueOnce(ok(checklist({ regions: { state: 'could_not_check', reason: 'Plan not provided.' } })));
    await act(async () => {
      await result.current.set('regions', 'could_not_check', 'Plan not provided.');
    });

    expect(result.current.saveError).toBeNull();
  });

  it('does not let an older read overwrite a newer change', async () => {
    const client = clientWith();
    client.submitChecklistState.mockResolvedValue(ok(checklist({ regions: { state: 'could_not_check', reason: 'Plan not provided.' } })));
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let finishRead: (value: ApiResult<ChecklistResponse>) => void = () => undefined;
    client.getChecklist.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    let reading: Promise<void> = Promise.resolve();
    act(() => {
      reading = result.current.refresh();
    });

    await act(async () => {
      await result.current.set('regions', 'could_not_check', 'Plan not provided.');
    });
    await act(async () => {
      finishRead(ok(checklist()));
      await reading;
    });

    expect(result.current.items?.find((entry) => entry.item === 'regions')?.state).toBe('could_not_check');
  });

  it('reads again when the tab becomes visible, and not while it is hidden', async () => {
    const client = clientWith();
    const { result } = renderHook(() => useChecklist(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(client.getChecklist).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(client.getChecklist).toHaveBeenCalledTimes(2));
  });
});

describe('ChecklistPanel', () => {
  it('renders nothing without a provider', () => {
    const { container } = render(<ChecklistPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says it is loading, not that nothing is checked, until it has the items', async () => {
    const client = clientWith();
    client.getChecklist.mockReturnValue(new Promise(() => undefined));
    mountPanel(client);

    expect(await screen.findByText('Loading the checklist…')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ checked ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('offers a retry when it cannot be read', async () => {
    const client = clientWith();
    client.getChecklist.mockResolvedValue(failure('Could not reach the server.', 0));
    mountPanel(client);

    expect(await screen.findByRole('alert')).toHaveTextContent('The checklist could not be loaded. Could not reach the server.');
    client.getChecklist.mockResolvedValue(ok(checklist()));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('article', { name: 'Applicable guidance' })).toBeInTheDocument();
  });

  it('lists the six items with their hints, the page says there is no login, and the four states are counted apart', async () => {
    mountPanel(clientWith(checklist({ guidance: { state: 'checked', accepted: 2 }, designations: { state: 'not_applicable', reason: 'Not an orphan product.' }, regions: { state: 'could_not_check', reason: 'Plan not provided.' } })));

    expect(await screen.findByRole('heading', { level: 1, name: 'Checklist' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.getByText(/recorded as “person \(local, not authenticated\)”/)).toBeInTheDocument();
    expect(screen.getByText('1 checked · 1 checked: not applicable · 1 could not check · 3 not checked')).toBeInTheDocument();
    expect(screen.getByText('Flag them and hand them to HEOR. Do not assess them.')).toBeInTheDocument();
  });

  it('says a change is still recorded under the local stamp, not under the person, once they signed in', async () => {
    mountPanel(clientWith(checklist({})), { signedIn: true });

    expect(await screen.findByRole('heading', { level: 1, name: 'Checklist' })).toBeInTheDocument();
    expect(screen.getByText(/A change is still recorded as “person \(local, not authenticated\)”, not under your name/)).toBeInTheDocument();
    expect(screen.queryByText(/This app has no login/)).not.toBeInTheDocument();
  });

  it('shows each item’s state in words, its reason and how many accepted findings back it', async () => {
    mountPanel(clientWith(checklist({ guidance: { state: 'checked', accepted: 2 }, designations: { state: 'not_applicable', reason: 'Not an orphan product.' } })));

    const guidance = await screen.findByRole('article', { name: 'Applicable guidance' });
    expect(guidance.querySelector('.badge')).toHaveTextContent(/^Checked$/);
    expect(guidance).toHaveTextContent('2 accepted findings are tagged to this item.');
    const designations = screen.getByRole('article', { name: 'Special designations' });
    expect(designations.querySelector('.badge')).toHaveTextContent(/^Checked: not applicable$/);
    expect(designations).toHaveTextContent('Reason: Not an orphan product.');
    expect(screen.getByRole('article', { name: 'Bottleneck hunt' })).toHaveTextContent('0 accepted findings are tagged to this item.');
  });

  it('keeps "Checked" off an item that no accepted finding backs, and says how to get there', async () => {
    mountPanel(clientWith(checklist({ guidance: { state: 'not_checked', accepted: 1 } })));

    const bare = await screen.findByRole('article', { name: 'Regional differences' });
    const checkedOption = within(bare).getByRole('option', { name: 'Checked' }) as HTMLOptionElement;
    expect(checkedOption.disabled).toBe(true);
    expect(bare).toHaveTextContent('“Checked” is available once an accepted finding is tagged to this item');
    const backed = screen.getByRole('article', { name: 'Applicable guidance' });
    expect((within(backed).getByRole('option', { name: 'Checked' }) as HTMLOptionElement).disabled).toBe(false);
    expect(backed).not.toHaveTextContent('“Checked” is available once');
  });

  it('asks for a reason for "not applicable" and "could not check", and does not send without one', async () => {
    const client = clientWith();
    mountPanel(client);
    const card = await screen.findByRole('article', { name: 'Special designations' });
    expect(within(card).queryByLabelText('Reason for Special designations')).not.toBeInTheDocument();

    await userEvent.selectOptions(within(card).getByLabelText('State of Special designations'), 'not_applicable');
    expect(within(card).getByLabelText('Reason for Special designations')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Save Special designations' }));

    expect(await within(card).findByRole('alert')).toHaveTextContent('Give the reason');
    expect(client.submitChecklistState).not.toHaveBeenCalled();
  });

  it('saves a state with its reason, and the card shows what the server saved', async () => {
    const client = clientWith();
    client.submitChecklistState.mockResolvedValue(ok(checklist({ designations: { state: 'not_applicable', reason: 'Not an orphan product.' } })));
    mountPanel(client);
    const card = await screen.findByRole('article', { name: 'Special designations' });

    await userEvent.selectOptions(within(card).getByLabelText('State of Special designations'), 'not_applicable');
    await userEvent.type(within(card).getByLabelText('Reason for Special designations'), 'Not an orphan product.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save Special designations' }));

    await waitFor(() => expect(client.submitChecklistState).toHaveBeenCalledWith('designations', 'not_applicable', 'Not an orphan product.'));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Special designations' })).toHaveTextContent('Reason: Not an orphan product.'));
    expect(screen.getByRole('button', { name: 'Save Special designations' })).toBeDisabled();
  });

  it('limits the reason to 300 characters, as the server does', async () => {
    mountPanel(clientWith(checklist({ regions: { state: 'could_not_check', reason: 'Plan not provided.' } })));

    expect(await screen.findByLabelText('Reason for Regional differences')).toHaveAttribute('maxlength', '300');
  });

  it('can mark an item "could not check", with its reason, and saves it', async () => {
    const client = clientWith();
    client.submitChecklistState.mockResolvedValue(ok(checklist({ bottlenecks: { state: 'could_not_check', reason: 'The filing plan was not provided.' } })));
    mountPanel(client);
    const card = await screen.findByRole('article', { name: 'Bottleneck hunt' });
    expect(within(card).getByRole('option', { name: 'Could not check' })).toBeInTheDocument();

    await userEvent.selectOptions(within(card).getByLabelText('State of Bottleneck hunt'), 'could_not_check');
    expect(within(card).getByLabelText('Reason for Bottleneck hunt')).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText('Reason for Bottleneck hunt'), 'The filing plan was not provided.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save Bottleneck hunt' }));

    await waitFor(() => expect(client.submitChecklistState).toHaveBeenCalledWith('bottlenecks', 'could_not_check', 'The filing plan was not provided.'));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Bottleneck hunt' }).querySelector('.badge')).toHaveTextContent(/^Could not check$/));
  });

  it('takes a mark back with no reason sent', async () => {
    const client = clientWith(checklist({ regions: { state: 'could_not_check', reason: 'Plan not provided.' } }));
    client.submitChecklistState.mockResolvedValue(ok(checklist()));
    mountPanel(client);
    const card = await screen.findByRole('article', { name: 'Regional differences' });

    await userEvent.selectOptions(within(card).getByLabelText('State of Regional differences'), 'not_checked');
    await userEvent.click(within(card).getByRole('button', { name: 'Save Regional differences' }));

    await waitFor(() => expect(client.submitChecklistState).toHaveBeenCalledWith('regions', 'not_checked', undefined));
  });

  it('keeps Save off until something changed', async () => {
    mountPanel(clientWith(checklist({ regions: { state: 'could_not_check', reason: 'Plan not provided.' } })));
    const card = await screen.findByRole('article', { name: 'Regional differences' });

    expect(within(card).getByRole('button', { name: 'Save Regional differences' })).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('Reason for Regional differences'), '!');
    expect(within(card).getByRole('button', { name: 'Save Regional differences' })).toBeEnabled();
  });

  it('says why a change was not saved, against its own card, with the reference', async () => {
    const client = clientWith(checklist({ guidance: { state: 'not_checked', accepted: 1 } }));
    client.submitChecklistState.mockResolvedValue({ ok: false, status: 409, error: { error: 'checklist_needs_finding', message: 'An item can be marked checked only when at least one accepted finding is tagged to it.', correlationId: 'c-5' }, message: 'An item can be marked checked only when at least one accepted finding is tagged to it.' });
    mountPanel(client);
    const card = await screen.findByRole('article', { name: 'Applicable guidance' });

    await userEvent.selectOptions(within(card).getByLabelText('State of Applicable guidance'), 'checked');
    await userEvent.click(within(card).getByRole('button', { name: 'Save Applicable guidance' }));

    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('Not saved: An item can be marked checked only when at least one accepted finding is tagged to it.');
    expect(alert).toHaveTextContent('Reference c-5');
    expect(within(screen.getByRole('article', { name: 'Regional differences' })).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reads the checklist again when the page opens, because findings are accepted elsewhere', async () => {
    const client = clientWith();
    mountPanel(client);

    await screen.findByRole('article', { name: 'Applicable guidance' });
    await waitFor(() => expect(client.getChecklist.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe('ChecklistSummary', () => {
  const mountSummary = (client: ReturnType<typeof clientWith>) =>
    render(
      <ChecklistProvider client={client}>
        <ChecklistSummary />
      </ChecklistProvider>,
    );

  it('renders nothing without a provider', () => {
    const { container } = render(<ChecklistSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not say anything is checked while it is loading, and says when it could not load', async () => {
    const loading = clientWith();
    loading.getChecklist.mockReturnValue(new Promise(() => undefined));
    const first = mountSummary(loading);
    expect(screen.getByText('Loading the checklist…')).toBeInTheDocument();
    first.unmount();

    const broken = clientWith();
    broken.getChecklist.mockResolvedValue(failure('down', 0));
    mountSummary(broken);
    expect(await screen.findByText('The checklist could not be loaded.')).toBeInTheDocument();
  });

  it('counts the four states apart, and links to the page', async () => {
    mountSummary(clientWith(checklist({ guidance: { state: 'checked', accepted: 1 }, regions: { state: 'could_not_check', reason: 'x' }, designations: { state: 'not_applicable', reason: 'y' } })));

    expect(await screen.findByText('1 checked, 1 not applicable, 1 could not check, 3 not checked (of 6).')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the checklist' })).toHaveAttribute('href', '/checklist');
  });
});
