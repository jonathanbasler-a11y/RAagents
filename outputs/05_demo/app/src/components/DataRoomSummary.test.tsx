// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { DataRoomDocumentSummary, DataRoomResponse } from '@/shared/contracts';
import { DataRoomProvider } from './DataRoomProvider';
import { DataRoomSummary } from './DataRoomSummary';

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

function renderSummary(result: ApiResult<DataRoomResponse> | Promise<ApiResult<DataRoomResponse>>) {
  const client = {
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockImplementation(() => Promise.resolve(result)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
  };
  return render(
    <DataRoomProvider client={client}>
      <DataRoomSummary />
    </DataRoomProvider>,
  );
}

const room = (documents: DataRoomDocumentSummary[] | null): DataRoomResponse => ({
  workspaceId: 'demo',
  dataRoom: documents === null ? null : { asOf: '2026-10-12', createdAt: 'x', documents },
  practiceAvailable: true,
  limits: LIMITS,
});

describe('DataRoomSummary', () => {
  it('renders nothing outside a provider', () => {
    const { container } = render(<DataRoomSummary />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says it is loading, and claims neither a room nor none', () => {
    renderSummary(new Promise(() => undefined));

    expect(screen.getByRole('heading', { name: 'Data room' })).toBeInTheDocument();
    expect(screen.getByText('Loading the data room…')).toBeInTheDocument();
    expect(screen.queryByText(/No data room yet/)).not.toBeInTheDocument();
  });

  it('says it could not be loaded, and links to the page where it can be retried', async () => {
    renderSummary({ ok: false, status: 0, error: null, message: 'Could not reach the server.' });

    expect(await screen.findByText('The data room could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the data room' })).toHaveAttribute('href', '/data-room');
  });

  it('says there is no data room, so the agents have no documents, and links to start one', async () => {
    renderSummary(ok(room(null)));

    expect(await screen.findByText(/No data room yet\. The agents have no documents to work from\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up the data room' })).toHaveAttribute('href', '/data-room');
  });

  it('says how many documents the room holds, its date, and how many the agents see', async () => {
    renderSummary(
      ok(room([summary('DR-01'), summary('DR-02'), summary('DR-03', { provided: false, publishedAt: null, chars: 0 }), summary('DR-04', { withdrawnAt: 'x', withdrawnReason: 'y' })])),
    );

    expect(await screen.findByText('4 documents as of 2026-10-12: 2 shown to the agents, 2 not shown.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the data room' })).toHaveAttribute('href', '/data-room');
  });

  it('says a room without documents is empty', async () => {
    renderSummary(ok(room([])));

    expect(await screen.findByText('The data room is empty (as of 2026-10-12). Add the first document.')).toBeInTheDocument();
  });

  it('uses the singular for one document', async () => {
    renderSummary(ok(room([summary('DR-01')])));

    expect(await screen.findByText('1 document as of 2026-10-12: 1 shown to the agents, 0 not shown.')).toBeInTheDocument();
  });
});
