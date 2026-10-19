// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { SelectionResponse } from '@/shared/contracts';
import { SelectionProvider, useSelection } from './SelectionProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const reply = (selected: string[]) => ok<SelectionResponse>({ workspaceId: 'demo', selected, source: 'saved' });
const failure: ApiResult<SelectionResponse> = { ok: false, status: 0, error: null, message: 'Could not reach the server.' };

function clientWith(initial: string[]) {
  return {
    getSelection: vi.fn<ChatApi['getSelection']>().mockResolvedValue(reply(initial)),
    setSelection: vi.fn<ChatApi['setSelection']>(),
  };
}

function mount(client: ReturnType<typeof clientWith>) {
  const wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider client={client}>{children}</SelectionProvider>;
  return renderHook(() => useSelection(), { wrapper });
}

function tabBecomes(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('SelectionProvider adopt', () => {
  it('takes the selection a DD setup save returned, without another request', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.adopt(['reglead', 'ops', 'mw']));

    expect([...(result.current.selected ?? [])]).toEqual(['reglead', 'ops', 'mw']);
    expect(client.getSelection).toHaveBeenCalledTimes(1);
    expect(client.setSelection).not.toHaveBeenCalled();
  });

  it('makes an unknown selection known, so a failed first load recovers when a save succeeds', async () => {
    const client = clientWith([]);
    client.getSelection.mockResolvedValue(failure);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.adopt(['reglead']));

    expect(result.current.status).toBe('ready');
    expect(result.current.loadError).toBeNull();
    expect(result.current.selected?.has('reglead')).toBe(true);
  });
});

describe('SelectionProvider quiet refresh', () => {
  it('reads the saved selection again when the tab becomes visible, and never shows "loading" while it does', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getSelection.mockResolvedValue(reply(['reglead', 'ops']));
    const seen: string[] = [];

    await act(async () => {
      tabBecomes('visible');
      seen.push(result.current.status);
    });

    expect(client.getSelection).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['ready']);
    expect(result.current.status).toBe('ready');
    expect(result.current.selected?.has('ops')).toBe(true);
  });

  it('does nothing when the tab is hidden', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => tabBecomes('hidden'));

    expect(client.getSelection).toHaveBeenCalledTimes(1);
  });

  it('keeps what it shows, and shows no error, when the quiet read fails', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getSelection.mockResolvedValue(failure);

    await act(async () => tabBecomes('visible'));

    expect(result.current.status).toBe('ready');
    expect(result.current.loadError).toBeNull();
    expect([...(result.current.selected ?? [])]).toEqual(['reglead']);
  });

  it('drops a read that was overtaken by a save, so an old answer never replaces a newer one', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let late: (value: ApiResult<SelectionResponse>) => void = () => undefined;
    client.getSelection.mockImplementation(() => new Promise((resolve) => (late = resolve)));

    await act(async () => tabBecomes('visible'));
    act(() => result.current.adopt(['reglead', 'ops']));
    await act(async () => late(reply(['reglead'])));

    expect([...(result.current.selected ?? [])]).toEqual(['reglead', 'ops']);
  });

  it('stops listening when the provider goes away', async () => {
    const client = clientWith(['reglead']);
    const { result, unmount } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();
    await act(async () => tabBecomes('visible'));

    expect(client.getSelection).toHaveBeenCalledTimes(1);
  });
});
