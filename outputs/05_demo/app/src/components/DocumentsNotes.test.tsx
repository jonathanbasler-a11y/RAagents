// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DataRoomDocumentSummary, DataRoomResponse } from '@/shared/contracts';
import { EvidenceBanner } from './Banners';
import { DataRoomProvider } from './DataRoomProvider';
import { HomeLede, PhaseLine } from './DocumentsNotes';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const LIMITS = { documentChars: 12_000, turnChars: 48_000 };

function summary(id: string, overrides: Partial<DataRoomDocumentSummary> = {}): DataRoomDocumentSummary {
  return {
    id,
    title: id,
    sourceType: 'company-disclosure',
    publishedAt: '2026-07-01',
    url: null,
    provided: true,
    origin: 'added',
    addedAt: 'x',
    withdrawnAt: null,
    withdrawnReason: null,
    chars: 100,
    ...overrides,
  };
}

const response = (documents: DataRoomDocumentSummary[] | null): DataRoomResponse => ({
  workspaceId: 'demo',
  dataRoom: documents === null ? null : { asOf: '2026-10-12', createdAt: 'x', documents },
  practiceAvailable: true,
  limits: LIMITS,
});

function withRoom(result: ApiResult<DataRoomResponse> | Promise<ApiResult<DataRoomResponse>>, children: React.ReactNode) {
  const client = {
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockImplementation(() => Promise.resolve(result)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
  return render(<DataRoomProvider client={client}>{children}</DataRoomProvider>);
}

const FAILED: ApiResult<DataRoomResponse> = { ok: false, status: 0, error: null, message: 'Could not reach the server.' };

describe('PhaseLine', () => {
  it('is the old line when there is no provider, so a page without a data room keeps its wording', () => {
    render(<PhaseLine mode="live" />);

    expect(screen.getByText('In this phase no documents and no tools are connected. Agent replies are model output, not sources.')).toBeInTheDocument();
  });

  it('says nothing about documents while the data room is loading', () => {
    withRoom(new Promise(() => undefined), <PhaseLine mode="live" />);

    expect(screen.getByText('No tools are connected. Agent replies are model output, not sources.')).toBeInTheDocument();
  });

  it('says nothing about documents when the data room could not be loaded', async () => {
    withRoom(FAILED, <PhaseLine mode="live" />);
    await screen.findByText('No tools are connected. Agent replies are model output, not sources.');

    expect(screen.queryByText(/no documents/i)).not.toBeInTheDocument();
  });

  it('says no documents are connected when there is no data room', async () => {
    withRoom(ok(response(null)), <PhaseLine mode="practice" />);

    expect(await screen.findByText('In this phase no documents and no tools are connected. Replies in practice mode are stand-in text, not model output and not sources.')).toBeInTheDocument();
  });

  it('says a data room is connected, and counts only what the agents are shown', async () => {
    withRoom(
      ok(
        response([
          summary('DR-01'),
          summary('DR-02'),
          summary('DR-03', { provided: false, publishedAt: null, chars: 0 }),
          summary('DR-04', { withdrawnAt: 'x', withdrawnReason: 'y' }),
        ]),
      ),
      <PhaseLine mode="live" />,
    );

    expect(await screen.findByText('A data room is connected (2 documents shown to the agents). No tools are. Agent replies are model output, not sources.')).toBeInTheDocument();
  });

  it('says no documents are connected when the room exists but nothing in it can be shown', async () => {
    withRoom(ok(response([summary('DR-01', { withdrawnAt: 'x', withdrawnReason: 'y' })])), <PhaseLine mode="live" />);

    expect(await screen.findByText(/^In this phase no documents and no tools are connected/)).toBeInTheDocument();
  });

  it('is the paragraph the header already used', async () => {
    withRoom(ok(response(null)), <PhaseLine mode="live" />);

    expect((await screen.findByText(/no documents and no tools/)).tagName).toBe('P');
    expect(screen.getByText(/no documents and no tools/)).toHaveClass('doc-control');
  });
});

describe('HomeLede', () => {
  it('follows the same three states', async () => {
    const { unmount } = withRoom(new Promise(() => undefined), <HomeLede />);
    expect(screen.getByText(/The agents have no tools\./)).toBeInTheDocument();
    expect(screen.queryByText(/no documents/)).not.toBeInTheDocument();
    unmount();

    withRoom(ok(response([summary('DR-01')])), <HomeLede />);
    expect(await screen.findByText(/read the documents of the data room and cite them by id/)).toBeInTheDocument();
  });

  it('says the agents have no documents when there is no data room', async () => {
    withRoom(ok(response(null)), <HomeLede />);

    expect(await screen.findByText(/the agents have no documents and no tools/)).toBeInTheDocument();
  });
});

describe('EvidenceBanner', () => {
  it('keeps its old words without a provider', () => {
    render(<EvidenceBanner name="Emeka" />);

    expect(screen.getByRole('note')).toHaveTextContent('No documents are connected yet, so Emeka cannot verify anything. He can explain what evidence a claim would need.');
  });

  it('says he can check against the data room once one is connected', async () => {
    withRoom(ok(response([summary('DR-01')])), <EvidenceBanner name="Emeka" />);

    expect(await screen.findByText(/Emeka can check a claim against the documents of the data room/)).toBeInTheDocument();
  });

  it('claims nothing about documents while it is not known', () => {
    withRoom(new Promise(() => undefined), <EvidenceBanner name="Emeka" />);

    expect(screen.getByRole('note')).toHaveTextContent('Emeka has no tools, so he cannot look anything up himself.');
  });
});
