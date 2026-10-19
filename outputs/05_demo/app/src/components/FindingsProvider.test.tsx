// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { FindingDecisionResponse, FindingsResponse } from '@/shared/contracts';
import { finding } from './findings-fixtures';
import { FindingsProvider, useFindings } from './FindingsProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const failure = <T,>(message: string, status = 400, correlationId: string | null = null): ApiResult<T> => ({
  ok: false,
  status,
  error: correlationId ? { error: 'invalid_request', message, correlationId } : null,
  message,
});

const register = (findings: FindingsResponse['findings'] = [], openQuestions: FindingsResponse['openQuestions'] = []): FindingsResponse => ({ workspaceId: 'demo', findings, openQuestions, tags: [] });

function clientWith(initial: FindingsResponse = register()) {
  return {
    getFindings: vi.fn<ChatApi['getFindings']>().mockResolvedValue(ok(initial)),
    submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
    submitFindingTag: vi.fn<ChatApi['submitFindingTag']>(),
    getChecklist: vi.fn<ChatApi['getChecklist']>(),
    submitChecklistState: vi.fn<ChatApi['submitChecklistState']>(),
  };
}

function mount(client: ReturnType<typeof clientWith>) {
  const wrapper = ({ children }: { children: ReactNode }) => <FindingsProvider client={client}>{children}</FindingsProvider>;
  return renderHook(() => useFindings(), { wrapper });
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('FindingsProvider: loading', () => {
  it('knows nothing while it loads: an empty register is not the same as not knowing', async () => {
    const { result } = mount(clientWith());

    expect(result.current.status).toBe('loading');
    expect(result.current.findings).toBeUndefined();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.findings).toEqual([]);
    expect(result.current.openQuestions).toEqual([]);
  });

  it('says it could not load, and keeps unknown unknown', async () => {
    const client = clientWith();
    client.getFindings.mockResolvedValue(failure('Could not reach the server.', 0, 'c-1'));
    const { result } = mount(client);

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.findings).toBeUndefined();
    expect(result.current.loadError?.message).toBe('Could not reach the server.');
    expect(result.current.loadError?.correlationId).toBe('c-1');
  });

  it('reads again when the tab becomes visible, and a failed read changes nothing', async () => {
    const client = clientWith(register([finding('F-001')]));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    client.getFindings.mockResolvedValueOnce(failure('down'));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(client.getFindings).toHaveBeenCalledTimes(2));
    expect(result.current.findings?.map((entry) => entry.id)).toEqual(['F-001']);
    expect(result.current.status).toBe('ready');

    client.getFindings.mockResolvedValueOnce(ok(register([finding('F-001'), finding('F-002')])));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(result.current.findings?.map((entry) => entry.id)).toEqual(['F-001', 'F-002']));
  });

  it('does not read while the tab is hidden', async () => {
    const client = clientWith();
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(client.getFindings).toHaveBeenCalledTimes(1);
  });
});

describe('FindingsProvider: deciding', () => {
  it('replaces the finding with what the server saved, sends only the decision and the note', async () => {
    const client = clientWith(register([finding('F-001'), finding('F-002')]));
    const saved = finding('F-001', { status: 'accepted', decidedBy: 'person (local, not authenticated)', decidedAt: '2026-10-12T09:00:00.000Z' });
    client.submitFindingDecision.mockResolvedValue(ok<FindingDecisionResponse>({ finding: saved, tag: null }));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let accepted = false;
    await act(async () => {
      accepted = await result.current.decide('F-001', 'accept', 'Checked.', { checklistItem: 'regions', category: 'risk' });
    });

    expect(accepted).toBe(true);
    expect(client.submitFindingDecision).toHaveBeenCalledWith('F-001', 'accept', 'Checked.', { checklistItem: 'regions', category: 'risk' });
    expect(result.current.findings?.map((entry) => [entry.id, entry.status])).toEqual([['F-001', 'accepted'], ['F-002', 'draft']]);
    expect(result.current.deciding).toBeNull();
  });

  it('ignores a second decision while one is being saved', async () => {
    const client = clientWith(register([finding('F-001'), finding('F-002')]));
    let finish: (value: ApiResult<FindingDecisionResponse>) => void = () => undefined;
    client.submitFindingDecision.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.decide('F-001', 'reject');
    });
    expect(result.current.deciding).toBe('F-001');
    let second = true;
    await act(async () => {
      second = await result.current.decide('F-002', 'accept');
    });

    expect(second).toBe(false);
    expect(client.submitFindingDecision).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(ok({ finding: finding('F-001', { status: 'rejected' }), tag: null }));
      await first;
    });
    expect(result.current.deciding).toBeNull();
  });

  it('keeps the draft a draft when the decision is not saved, says which finding, and reads the register again after a 409', async () => {
    const client = clientWith(register([finding('F-001')]));
    client.submitFindingDecision.mockResolvedValue(failure('This finding was already decided.', 409, 'c-2'));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getFindings.mockResolvedValue(ok(register([finding('F-001', { status: 'rejected' })])));

    let saved = true;
    await act(async () => {
      saved = await result.current.decide('F-001', 'accept');
    });

    expect(saved).toBe(false);
    expect(result.current.decideError).toEqual({ findingId: 'F-001', message: 'This finding was already decided.', correlationId: 'c-2' });
    await waitFor(() => expect(result.current.findings?.[0].status).toBe('rejected'));
  });

  it('clears the old error when the next decision starts', async () => {
    const client = clientWith(register([finding('F-001')]));
    client.submitFindingDecision.mockResolvedValueOnce(failure('Could not reach the server.', 0));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.decide('F-001', 'accept');
    });
    expect(result.current.decideError).not.toBeNull();

    client.submitFindingDecision.mockResolvedValueOnce(ok({ finding: finding('F-001', { status: 'accepted' }), tag: null }));
    await act(async () => {
      await result.current.decide('F-001', 'accept');
    });

    expect(result.current.decideError).toBeNull();
  });
});

describe('FindingsProvider: tags', () => {
  const TAG = { findingId: 'F-001', checklistItem: 'regions', category: 'risk', taggedAt: '2026-10-12T09:00:00.000Z', taggedBy: 'person (local, not authenticated)' } as const;

  it('keeps the tag a decision came back with, and starts with the tags the register has', async () => {
    const client = clientWith({ ...register([finding('F-001'), finding('F-002', { status: 'accepted', decidedBy: 'x', decidedAt: '2026-10-12T09:00:00.000Z' })]), tags: [{ ...TAG, findingId: 'F-002', category: 'neutral' }] });
    client.submitFindingDecision.mockResolvedValue(ok<FindingDecisionResponse>({ finding: finding('F-001', { status: 'accepted', decidedBy: 'x', decidedAt: '2026-10-12T09:00:00.000Z' }), tag: TAG }));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.tags?.map((entry) => entry.findingId)).toEqual(['F-002']);

    await act(async () => {
      await result.current.decide('F-001', 'accept', undefined, { checklistItem: 'regions', category: 'risk' });
    });

    expect(result.current.tags?.map((entry) => [entry.findingId, entry.checklistItem])).toEqual([['F-002', 'regions'], ['F-001', 'regions']]);
  });

  it('tags a finding accepted without one, one action at a time, and reports a refusal against that finding', async () => {
    const client = clientWith(register([finding('F-001', { status: 'accepted', decidedBy: 'x', decidedAt: '2026-10-12T09:00:00.000Z' })]));
    client.submitFindingTag.mockResolvedValueOnce({ ok: false, status: 409, error: { error: 'finding_tagged', message: 'This finding already has its tag. A tag is set once.', correlationId: 'c-4' }, message: 'This finding already has its tag. A tag is set once.' });
    client.submitFindingTag.mockResolvedValueOnce(ok({ tag: TAG }));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first = true;
    await act(async () => {
      first = await result.current.tag('F-001', { checklistItem: 'regions', category: 'risk' });
    });
    expect(first).toBe(false);
    expect(result.current.decideError).toEqual({ findingId: 'F-001', message: 'This finding already has its tag. A tag is set once.', correlationId: 'c-4' });

    let second = false;
    await act(async () => {
      second = await result.current.tag('F-001', { checklistItem: 'regions', category: 'risk' });
    });
    expect(second).toBe(true);
    expect(result.current.decideError).toBeNull();
    expect(result.current.tags).toEqual([TAG]);
  });
});

describe('FindingsProvider: tagging one at a time, and after a refusal', () => {
  const ACCEPTED = (id: string) => finding(id, { status: 'accepted', decidedBy: 'x', decidedAt: '2026-10-12T09:00:00.000Z' });

  it('ignores a second tag while one is being saved', async () => {
    const client = clientWith(register([ACCEPTED('F-001'), ACCEPTED('F-002')]));
    let finish: (value: ApiResult<{ tag: never }>) => void = () => undefined;
    client.submitFindingTag.mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.tag('F-001', { checklistItem: 'regions', category: 'risk' });
    });
    expect(result.current.deciding).toBe('F-001');
    let second = true;
    await act(async () => {
      second = await result.current.tag('F-002', { checklistItem: 'regions', category: 'risk' });
    });

    expect(second).toBe(false);
    expect(client.submitFindingTag).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ok: false, status: 400, error: null, message: 'x' });
      await first;
    });
    expect(result.current.deciding).toBeNull();
  });

  it('reads the register again after a refused tag (409), so the screen shows what is saved', async () => {
    const client = clientWith(register([ACCEPTED('F-001')]));
    client.submitFindingTag.mockResolvedValue({ ok: false, status: 409, error: null, message: 'This finding already has its tag.' });
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.getFindings.mockClear();
    client.getFindings.mockResolvedValue({ ok: true, data: { ...register([ACCEPTED('F-001')]), tags: [{ findingId: 'F-001', checklistItem: 'guidance', category: 'neutral', taggedAt: 'x', taggedBy: 'y' }] } });

    await act(async () => {
      await result.current.tag('F-001', { checklistItem: 'regions', category: 'risk' });
    });

    await waitFor(() => expect(client.getFindings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.tags?.[0]?.checklistItem).toBe('guidance'));
  });
});

describe('FindingsProvider: a read that started before a decision', () => {
  it('does not overwrite the decision with the older state it read', async () => {
    const client = clientWith(register([finding('F-001')]));
    client.submitFindingDecision.mockResolvedValue(ok<FindingDecisionResponse>({ finding: finding('F-001', { status: 'accepted', decidedBy: 'person (local, not authenticated)', decidedAt: '2026-10-12T09:00:00.000Z' }), tag: null }));
    const { result } = mount(client);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let finishRead: (value: ApiResult<FindingsResponse>) => void = () => undefined;
    client.getFindings.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    let reading: Promise<void> = Promise.resolve();
    act(() => {
      reading = result.current.refresh();
    });
    await act(async () => {
      await result.current.decide('F-001', 'accept');
    });
    await act(async () => {
      finishRead(ok(register([finding('F-001')])));
      await reading;
    });

    expect(result.current.findings?.[0].status).toBe('accepted');
  });
});

describe('useFindings without a provider', () => {
  it('is unavailable, shows nothing and decides nothing', async () => {
    const { result } = renderHook(() => useFindings());

    expect(result.current.status).toBe('unavailable');
    expect(result.current.findings).toBeUndefined();
    await expect(result.current.decide('F-001', 'accept')).resolves.toBe(false);
  });
});
