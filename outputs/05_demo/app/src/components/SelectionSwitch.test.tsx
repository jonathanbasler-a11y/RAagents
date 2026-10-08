// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { EMEKA, LENA } from '@/client/test-fixtures';
import type { SelectionResponse } from '@/shared/contracts';
import { SelectionProvider } from './SelectionProvider';
import { SelectionSwitch } from './SelectionSwitch';

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

describe('SelectionSwitch', () => {
  it('shows the selection as unknown while it loads, then as a switch', async () => {
    const client = selectionClient(['label', 'ev']);
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={LENA} />
      </SelectionProvider>,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Loading selection…')).toBeInTheDocument();

    const toggle = await screen.findByRole('switch', { name: /Lena/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Selected for this DD');
  });

  it('flips through POST /api/selection and shows the saved result', async () => {
    const user = userEvent.setup();
    const client = selectionClient(['label']);
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={LENA} />
      </SelectionProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /Lena/ });

    await user.click(toggle);

    expect(client.setSelection).toHaveBeenCalledWith('label', false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('is busy while saving and sends one request for a double click', async () => {
    const client = selectionClient([]);
    let release: () => void = () => undefined;
    client.setSelection.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok<SelectionResponse>({ workspaceId: 'demo', selected: ['label'], source: 'saved' }));
        }),
    );
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={LENA} />
      </SelectionProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /Lena/ });

    act(() => {
      toggle.click();
      toggle.click();
    });

    expect(client.setSelection).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('shows "Always on" for a locked team role and never calls the API', async () => {
    const user = userEvent.setup();
    const client = selectionClient(['ev']);
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={EMEKA} />
      </SelectionProvider>,
    );

    const toggle = screen.getByRole('switch', { name: /Emeka/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveTextContent('Always on');

    await user.click(toggle);

    expect(client.setSelection).not.toHaveBeenCalled();
  });

  it('keeps the switch as it was when saving fails, and shows why with a reference', async () => {
    const user = userEvent.setup();
    const client = selectionClient(['label']);
    client.setSelection.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: 'internal', message: 'Could not save the selection.', correlationId: 'corr-s1' },
      message: 'Could not save the selection.',
    });
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={LENA} />
      </SelectionProvider>,
    );
    const toggle = await screen.findByRole('switch', { name: /Lena/ });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the selection.');
    expect(screen.getByRole('alert')).toHaveTextContent('corr-s1');
  });

  it('says the selection could not be loaded, and retries', async () => {
    const user = userEvent.setup();
    const client = selectionClient(['label']);
    client.getSelection
      .mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' })
      .mockResolvedValueOnce(ok<SelectionResponse>({ workspaceId: 'demo', selected: ['label'], source: 'saved' }));
    render(
      <SelectionProvider client={client}>
        <SelectionSwitch agent={LENA} />
      </SelectionProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /retry/i }));

    expect(await screen.findByRole('switch', { name: /Lena/ })).toHaveAttribute('aria-checked', 'true');
    expect(client.getSelection).toHaveBeenCalledTimes(2);
  });
});
