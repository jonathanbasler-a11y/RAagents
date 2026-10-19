// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DataRoomDocument, DataRoomDocumentResponse, DataRoomDocumentSummary, DataRoomResponse } from '@/shared/contracts';
import { DataRoomProvider, useDataRoom } from './DataRoomProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = <T,>(message: string, correlationId: string | null = null): ApiResult<T> => ({
  ok: false,
  status: 400,
  error: correlationId ? { error: 'invalid_request', message, correlationId } : null,
  message,
});

const LIMITS = { documentChars: 12_000, turnChars: 48_000 };

function summary(id: string, overrides: Partial<DataRoomDocumentSummary> = {}): DataRoomDocumentSummary {
  return {
    id,
    title: `Title of ${id}`,
    sourceType: 'company-disclosure',
    publishedAt: '2026-07-01',
    url: null,
    provided: true,
    origin: 'added',
    addedAt: '2026-10-12T08:00:00.000Z',
    withdrawnAt: null,
    withdrawnReason: null,
    chars: 100,
    ...overrides,
  };
}

const NO_ROOM: DataRoomResponse = { workspaceId: 'demo', dataRoom: null, practiceAvailable: true, limits: LIMITS };
const roomWith = (...documents: DataRoomDocumentSummary[]): DataRoomResponse => ({
  workspaceId: 'demo',
  dataRoom: { asOf: '2026-10-12', createdAt: '2026-10-12T08:00:00.000Z', documents },
  practiceAvailable: true,
  limits: LIMITS,
});
const docReply = (id: string): ApiResult<DataRoomDocumentResponse> =>
  ok({ document: { ...summary(id), text: 'Text.' } as DataRoomDocument });

function clientWith(initial: DataRoomResponse = NO_ROOM) {
  return {
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(ok(initial)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
}

function mount(client: ReturnType<typeof clientWith>) {
  const wrapper = ({ children }: { children: ReactNode }) => <DataRoomProvider client={client}>{children}</DataRoomProvider>;
  return renderHook(() => useDataRoom(), { wrapper });
}

function tabBecomes(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('DataRoomProvider: loading', () => {
  it('knows nothing while it loads: no room is not the same as not knowing', async () => {
    const { result } = mount(clientWith());

    expect(result.current.status).toBe('loading');
    expect(result.current.dataRoom).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.dataRoom).toBeNull();
    expect(result.current.practiceAvailable).toBe(true);
    expect(result.current.limits).toEqual(LIMITS);
  });

  it('holds the documents once the room exists', async () => {
    const { result } = mount(clientWith(roomWith(summary('DR-01'), summary('DR-02'))));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01', 'DR-02']);
    expect(result.current.dataRoom?.asOf).toBe('2026-10-12');
  });

  it('says the data room could not be loaded, knows nothing, and loads it on retry', async () => {
    const client = clientWith();
    client.getDataRoom.mockResolvedValueOnce(failure('Could not reach the server.')).mockResolvedValueOnce(ok(roomWith(summary('DR-01'))));
    const { result } = mount(client);

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.dataRoom).toBeUndefined();
    expect(result.current.loadError?.message).toBe('Could not reach the server.');

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.dataRoom?.documents).toHaveLength(1);
    expect(result.current.loadError).toBeNull();
  });

  it('is unavailable, and does nothing, outside a provider', async () => {
    const { result } = renderHook(() => useDataRoom());

    expect(result.current.status).toBe('unavailable');
    expect(await result.current.start({ practice: true })).toBe(false);
    expect(result.current.dataRoom).toBeUndefined();
  });
});

describe('DataRoomProvider: starting', () => {
  it('starts the room, takes the reply as the new state, and sends one request', async () => {
    const client = clientWith();
    client.startDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01'))));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let started = false;
    await act(async () => {
      started = await result.current.start({ practice: true });
    });

    expect(started).toBe(true);
    expect(client.startDataRoom).toHaveBeenCalledTimes(1);
    expect(client.startDataRoom).toHaveBeenCalledWith({ practice: true });
    expect(result.current.dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01']);
    expect(client.getDataRoom).toHaveBeenCalledTimes(1);
  });

  it('keeps no room and shows why when starting is refused, with the reference', async () => {
    const client = clientWith();
    client.startDataRoom.mockResolvedValue(failure('The as-of date must be a real date written YYYY-MM-DD.', 'corr-s1'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let started = true;
    await act(async () => {
      started = await result.current.start({ asOf: 'soon' });
    });

    expect(started).toBe(false);
    expect(result.current.dataRoom).toBeNull();
    expect(result.current.saveError).toEqual({ message: 'The as-of date must be a real date written YYYY-MM-DD.', correlationId: 'corr-s1' });
  });

  it('sends one request for two starts at once, and is busy while it runs', async () => {
    const client = clientWith();
    let release: () => void = () => undefined;
    client.startDataRoom.mockImplementation(() => new Promise((resolve) => (release = () => resolve(ok(roomWith())))));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      void result.current.start({ practice: true });
      void result.current.start({ asOf: '2026-10-12' });
    });

    expect(client.startDataRoom).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(true);
    await act(async () => release());
    expect(result.current.saving).toBe(false);
  });

  it('clears an old error when the next action starts', async () => {
    const client = clientWith();
    client.startDataRoom.mockResolvedValueOnce(failure('No.', 'c1')).mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => void (await result.current.start({ asOf: 'x' })));
    expect(result.current.saveError).not.toBeNull();

    act(() => void result.current.start({ asOf: '2026-10-12' }));

    expect(result.current.saveError).toBeNull();
  });
});

describe('DataRoomProvider: documents', () => {
  const NEW_DOC = { title: 'Clinical summary', sourceType: 'company-disclosure', publishedAt: '2026-07-30', url: null, provided: true, text: 'Text.' } as const;

  it('adds a document, then reads the room again so the list is the saved one', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    client.addDocument.mockResolvedValue(docReply('DR-02'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01'), summary('DR-02'))));

    let added = false;
    await act(async () => {
      added = await result.current.add(NEW_DOC);
    });

    expect(added).toBe(true);
    expect(client.addDocument).toHaveBeenCalledWith(NEW_DOC);
    expect(result.current.dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01', 'DR-02']);
  });

  it('returns false and keeps the list when adding is refused, and says why', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    client.addDocument.mockResolvedValue(failure('The document is dated 2026-10-13, after the as-of date 2026-10-12.', 'corr-a1'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let added = true;
    await act(async () => {
      added = await result.current.add(NEW_DOC);
    });

    expect(added).toBe(false);
    expect(result.current.dataRoom?.documents).toHaveLength(1);
    expect(result.current.saveError?.message).toMatch(/after the as-of date/);
    expect(result.current.saveError?.correlationId).toBe('corr-a1');
  });

  it('withdraws a document with its reason, then reads the room again', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    client.withdrawDocument.mockResolvedValue(docReply('DR-01'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01', { withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'wrong file' }))));

    await act(async () => void (await result.current.withdraw('DR-01', 'wrong file')));

    expect(client.withdrawDocument).toHaveBeenCalledWith('DR-01', 'wrong file');
    expect(result.current.dataRoom?.documents[0].withdrawnReason).toBe('wrong file');
  });

  it('says so when the save worked but the list could not be read again, and keeps the old list', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    client.addDocument.mockResolvedValue(docReply('DR-02'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getDataRoom.mockResolvedValue(failure('Could not reach the server.'));

    let added = false;
    await act(async () => {
      added = await result.current.add(NEW_DOC);
    });

    expect(added).toBe(true);
    expect(result.current.saveError?.message).toMatch(/saved, but the list could not be read again/i);
    expect(result.current.dataRoom?.documents).toHaveLength(1);
  });

  it('does nothing else while one action runs', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    client.addDocument.mockImplementation(() => new Promise(() => undefined));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      void result.current.add(NEW_DOC);
      void result.current.withdraw('DR-01', 'x');
    });

    expect(client.addDocument).toHaveBeenCalledTimes(1);
    expect(client.withdrawDocument).not.toHaveBeenCalled();
  });
});

describe('DataRoomProvider: quiet refresh', () => {
  it('reads again when the tab becomes visible, and never shows "loading" while it does', async () => {
    const client = clientWith();
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01'))));
    const seen: string[] = [];

    await act(async () => {
      tabBecomes('visible');
      seen.push(result.current.status);
    });

    expect(seen).toEqual(['ready']);
    expect(result.current.dataRoom?.documents).toHaveLength(1);
  });

  it('does nothing when the tab is hidden, and keeps what it shows when the read fails', async () => {
    const client = clientWith(roomWith(summary('DR-01')));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => tabBecomes('hidden'));
    expect(client.getDataRoom).toHaveBeenCalledTimes(1);

    client.getDataRoom.mockResolvedValue(failure('Could not reach the server.'));
    await act(async () => tabBecomes('visible'));
    expect(result.current.status).toBe('ready');
    expect(result.current.loadError).toBeNull();
    expect(result.current.dataRoom?.documents).toHaveLength(1);
  });

  it('drops a read that was overtaken by a save', async () => {
    const client = clientWith();
    client.startDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01'))));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let late: (value: ApiResult<DataRoomResponse>) => void = () => undefined;
    client.getDataRoom.mockImplementation(() => new Promise((resolve) => (late = resolve)));

    await act(async () => tabBecomes('visible'));
    await act(async () => void (await result.current.start({ practice: true })));
    await act(async () => late(ok(NO_ROOM)));

    expect(result.current.dataRoom?.documents).toHaveLength(1);
  });

  it('recovers from a failed first load when a quiet read works', async () => {
    const client = clientWith();
    client.getDataRoom.mockResolvedValueOnce(failure('Could not reach the server.'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('error'));
    client.getDataRoom.mockResolvedValue(ok(roomWith(summary('DR-01'))));

    await act(async () => tabBecomes('visible'));

    expect(result.current.status).toBe('ready');
    expect(result.current.loadError).toBeNull();
    expect(result.current.dataRoom?.documents).toHaveLength(1);
  });

  it('stops listening when the provider goes away', async () => {
    const client = clientWith();
    const { result, unmount } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    unmount();
    await act(async () => tabBecomes('visible'));

    expect(client.getDataRoom).toHaveBeenCalledTimes(1);
  });
});
