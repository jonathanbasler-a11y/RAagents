// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { DataRoomProvider } from '@/components/DataRoomProvider';
import DataRoomPage, { dynamic, metadata } from './page';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

describe('data room page (/data-room)', () => {
  it('shows the data room panel from the provider the app shell mounts', async () => {
    const client = {
      getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(
        ok({ workspaceId: 'demo', dataRoom: null, practiceAvailable: true, limits: { documentChars: 12000, turnChars: 48000 } }),
      ),
      getDocument: vi.fn<ChatApi['getDocument']>(),
      startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
      addDocument: vi.fn<ChatApi['addDocument']>(),
      withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
    };

    render(
      <DataRoomProvider client={client}>
        <DataRoomPage />
      </DataRoomProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Data room' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Load the practice data room' })).toBeInTheDocument();
  });

  it('is rendered per request and titled', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(metadata.title).toBe('Data room');
  });
});
