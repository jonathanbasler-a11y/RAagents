// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DdSetup, DdSetupResponse, SelectionResponse } from '@/shared/contracts';
import { DdSetupProvider, useDdSetup } from './DdSetupProvider';
import { SelectionProvider, useSelection } from './SelectionProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const DEFAULT_SETUP: DdSetup = { stage: 'Phase 2', classifications: ['orphan', 'paed'] };
const LATE_SETUP: DdSetup = { stage: 'Phase 3', classifications: ['orphan', 'paed'] };

function setupReply(setup: DdSetup, selected: string[], source: 'default' | 'saved' = 'saved'): ApiResult<DdSetupResponse> {
  return ok<DdSetupResponse>({ workspaceId: 'demo', setup, source, selection: { workspaceId: 'demo', selected, source: 'saved' } });
}

function failure<T>(message: string, correlationId: string | null): ApiResult<T> {
  return {
    ok: false,
    status: 500,
    error: correlationId ? { error: 'internal', message, correlationId } : null,
    message,
  };
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

function mount(client: ReturnType<typeof clientWith>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SelectionProvider client={client}>
      <DdSetupProvider client={client}>{children}</DdSetupProvider>
    </SelectionProvider>
  );
  return renderHook(() => ({ setup: useDdSetup(), selection: useSelection() }), { wrapper });
}

function tabBecomes(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('DdSetupProvider loading', () => {
  it('has no setup while it loads, then the saved or default setup with where it came from', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);

    expect(result.current.setup.status).toBe('loading');
    expect(result.current.setup.setup).toBeNull();

    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    expect(result.current.setup.setup).toEqual(DEFAULT_SETUP);
    expect(result.current.setup.source).toBe('default');
  });

  it('says the setup could not be loaded, shows no setup, and loads it on retry', async () => {
    const client = clientWith(['reglead']);
    client.getDdSetup
      .mockResolvedValueOnce(failure('Could not reach the server.', null))
      .mockResolvedValueOnce(setupReply(LATE_SETUP, ['reglead']));
    const { result } = mount(client);

    await waitFor(() => expect(result.current.setup.status).toBe('error'));
    expect(result.current.setup.setup).toBeNull();
    expect(result.current.setup.loadError?.message).toBe('Could not reach the server.');

    act(() => result.current.setup.reload());
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    expect(result.current.setup.setup).toEqual(LATE_SETUP);
    expect(result.current.setup.loadError).toBeNull();
  });

  it('is unavailable, and changes nothing, outside a provider', async () => {
    const { result } = renderHook(() => useDdSetup());

    expect(result.current.status).toBe('unavailable');
    await act(async () => result.current.change(LATE_SETUP));
    expect(result.current.setup).toBeNull();
  });
});

describe('DdSetupProvider change', () => {
  it('sends the whole setup once and takes the new setup and the team that follows from it', async () => {
    const client = clientWith(['reglead', 'orc']);
    client.setDdSetup.mockResolvedValue(setupReply(LATE_SETUP, ['reglead', 'ops', 'mw']));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));

    await act(async () => result.current.setup.change(LATE_SETUP));

    expect(client.setDdSetup).toHaveBeenCalledTimes(1);
    expect(client.setDdSetup).toHaveBeenCalledWith(LATE_SETUP);
    expect(result.current.setup.setup).toEqual(LATE_SETUP);
    expect(result.current.setup.source).toBe('saved');
    expect([...(result.current.selection.selected ?? [])]).toEqual(['reglead', 'ops', 'mw']);
    expect(result.current.setup.lastSave).toEqual({ team: { joined: ['ops', 'mw'], left: ['orc'] } });
    expect(client.getSelection).toHaveBeenCalledTimes(1);
  });

  it('says the team changed only when it can compare with a known selection', async () => {
    const client = clientWith([]);
    client.getSelection.mockResolvedValue(failure('Could not reach the server.', null));
    client.setDdSetup.mockResolvedValue(setupReply(LATE_SETUP, ['reglead']));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    await waitFor(() => expect(result.current.selection.status).toBe('error'));

    await act(async () => result.current.setup.change(LATE_SETUP));

    expect(result.current.setup.lastSave).toEqual({ team: null });
    expect(result.current.selection.status).toBe('ready');
  });

  it('is busy while saving and sends one request for a double change', async () => {
    const client = clientWith(['reglead']);
    let release: () => void = () => undefined;
    client.setDdSetup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(setupReply(LATE_SETUP, ['reglead']));
        }),
    );
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));

    act(() => {
      void result.current.setup.change(LATE_SETUP);
      void result.current.setup.change({ stage: 'Filed', classifications: [] });
    });

    expect(client.setDdSetup).toHaveBeenCalledTimes(1);
    expect(result.current.setup.saving).toBe(true);
    await act(async () => release());
    expect(result.current.setup.saving).toBe(false);
  });

  it('does not save while one agent switch is being saved', async () => {
    const client = clientWith(['reglead']);
    client.setSelection.mockImplementation(() => new Promise(() => undefined));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    act(() => void result.current.selection.setSelected('label', true));
    expect(result.current.selection.saving.has('label')).toBe(true);

    await act(async () => result.current.setup.change(LATE_SETUP));

    expect(client.setDdSetup).not.toHaveBeenCalled();
  });

  it('keeps the old setup and the old team when saving fails, and says why with a reference', async () => {
    const client = clientWith(['reglead']);
    client.setDdSetup.mockResolvedValue(failure('Could not save the setup.', 'corr-d1'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));

    await act(async () => result.current.setup.change(LATE_SETUP));

    expect(result.current.setup.setup).toEqual(DEFAULT_SETUP);
    expect([...(result.current.selection.selected ?? [])]).toEqual(['reglead']);
    expect(result.current.setup.saveError).toEqual({ message: 'Could not save the setup.', correlationId: 'corr-d1' });
    expect(result.current.setup.lastSave).toBeNull();
  });

  it('clears the old error and the old "saved" note when the next save starts', async () => {
    const client = clientWith(['reglead']);
    client.setDdSetup
      .mockResolvedValueOnce(failure('Could not save the setup.', 'corr-d1'))
      .mockResolvedValueOnce(setupReply(LATE_SETUP, ['reglead', 'ops']))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));

    await act(async () => result.current.setup.change(LATE_SETUP));
    expect(result.current.setup.saveError).not.toBeNull();

    await act(async () => result.current.setup.change(LATE_SETUP));
    expect(result.current.setup.saveError).toBeNull();
    expect(result.current.setup.lastSave).not.toBeNull();

    act(() => void result.current.setup.change(DEFAULT_SETUP));
    expect(result.current.setup.lastSave).toBeNull();
  });
});

describe('DdSetupProvider quiet refresh', () => {
  it('reads the setup again when the tab becomes visible, and never shows "loading" while it does', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    client.getDdSetup.mockResolvedValue(setupReply(LATE_SETUP, ['reglead']));
    const seen: string[] = [];

    await act(async () => {
      tabBecomes('visible');
      seen.push(result.current.setup.status);
    });

    expect(seen).toEqual(['ready']);
    expect(client.getDdSetup).toHaveBeenCalledTimes(2);
    expect(result.current.setup.setup).toEqual(LATE_SETUP);
  });

  it('does nothing when the tab is hidden, and keeps what it shows when the read fails', async () => {
    const client = clientWith(['reglead']);
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));

    await act(async () => tabBecomes('hidden'));
    expect(client.getDdSetup).toHaveBeenCalledTimes(1);

    client.getDdSetup.mockResolvedValue(failure('Could not reach the server.', null));
    await act(async () => tabBecomes('visible'));
    expect(result.current.setup.status).toBe('ready');
    expect(result.current.setup.loadError).toBeNull();
    expect(result.current.setup.setup).toEqual(DEFAULT_SETUP);
  });

  it('drops a read that was overtaken by a save', async () => {
    const client = clientWith(['reglead']);
    client.setDdSetup.mockResolvedValue(setupReply(LATE_SETUP, ['reglead']));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));
    await waitFor(() => expect(result.current.selection.status).toBe('ready'));
    let late: (value: ApiResult<DdSetupResponse>) => void = () => undefined;
    client.getDdSetup.mockImplementation(() => new Promise((resolve) => (late = resolve)));

    await act(async () => tabBecomes('visible'));
    await act(async () => result.current.setup.change(LATE_SETUP));
    await act(async () => late(setupReply(DEFAULT_SETUP, ['reglead'], 'default')));

    expect(result.current.setup.setup).toEqual(LATE_SETUP);
    expect(result.current.setup.source).toBe('saved');
  });

  it('recovers from a failed first load when a quiet read works', async () => {
    const client = clientWith(['reglead']);
    client.getDdSetup.mockResolvedValueOnce(failure('Could not reach the server.', null));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('error'));
    client.getDdSetup.mockResolvedValue(setupReply(LATE_SETUP, ['reglead']));

    await act(async () => tabBecomes('visible'));

    expect(result.current.setup.status).toBe('ready');
    expect(result.current.setup.loadError).toBeNull();
    expect(result.current.setup.setup).toEqual(LATE_SETUP);
  });

  it('stops listening when the provider goes away', async () => {
    const client = clientWith(['reglead']);
    const { result, unmount } = mount(client);
    await waitFor(() => expect(result.current.setup.status).toBe('ready'));

    unmount();
    await act(async () => tabBecomes('visible'));

    expect(client.getDdSetup).toHaveBeenCalledTimes(1);
  });
});
