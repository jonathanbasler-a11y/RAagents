// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import { ROSTER, THREAD, makeMessage, makeTurn, roomData } from '@/client/test-fixtures';
import type { DataRoomResponse, FindingsResponse, HealthReport, HealthResponse, RoomMessagesResponse } from '@/shared/contracts';
import { FINDINGS_REQUEST_TEXT } from '@/shared/findings';
import { ChatRoom } from './ChatRoom';
import { DataRoomProvider } from './DataRoomProvider';
import { FindingsProvider } from './FindingsProvider';
import { SelectionProvider } from './SelectionProvider';

// The "Propose findings from this answer" button: offered in an agent's own room, after one of its answers, when the data
// room has a document it could be shown. The server writes the question; the browser only names the intent.

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

const HEALTHY: HealthReport = {
  status: 'ok',
  checks: { database: 'ok', agents: 'ok', llm: 'ok' },
  agentCount: 25,
  llm: { configured: true, missing: [], message: null },
  startedAt: '2026-10-07T08:00:00.000Z',
};

const ANSWERED: RoomMessagesResponse = roomData(
  [
    makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'What does the licensor say about the pivotal study?', seq: 1 }),
    makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'DR-01 says one study is enough.', seq: 2 }),
  ],
  [makeTurn({ id: 't1' })],
  'reglead',
);

const AFTER_REQUEST: RoomMessagesResponse = roomData(
  [
    ...ANSWERED.messages,
    makeMessage({ id: 'u2', turnId: 't2', author: 'human', text: FINDINGS_REQUEST_TEXT, seq: 3 }),
    makeMessage({ id: 'a2', turnId: 't2', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'One finding.', seq: 4 }),
  ],
  [makeTurn({ id: 't1' }), makeTurn({ id: 't2' })],
  'reglead',
);

/** The room after the person's question and an agent reply that did not finish. */
const unfinished = (status: 'partial' | 'error'): RoomMessagesResponse =>
  roomData(
    [
      makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'A question.', seq: 1 }),
      makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Part of an', seq: 2, status, ...(status === 'partial' ? { truncated: true } : { errorCode: 'internal' as const }) }),
    ],
    [makeTurn({ id: 't1' })],
    'reglead',
  );

const LIMITS = { documentChars: 12_000, turnChars: 48_000 };
const roomWith = (provided: boolean): DataRoomResponse => ({
  workspaceId: 'demo',
  dataRoom: {
    asOf: '2026-10-12',
    createdAt: '2026-10-12T08:00:00.000Z',
    documents: [
      {
        id: 'DR-01',
        title: 'Licensor overview',
        sourceType: 'company-disclosure',
        publishedAt: '2026-07-14',
        url: null,
        provided,
        origin: 'added',
        addedAt: '2026-10-12T08:00:00.000Z',
        withdrawnAt: null,
        withdrawnReason: null,
        chars: provided ? 100 : 0,
      },
    ],
  },
  practiceAvailable: true,
  limits: LIMITS,
});
const NO_ROOM: DataRoomResponse = { workspaceId: 'demo', dataRoom: null, practiceAvailable: true, limits: LIMITS };
const EMPTY_REGISTER: FindingsResponse = { workspaceId: 'demo', findings: [], openQuestions: [], tags: [] };

function api(messages: RoomMessagesResponse, room: DataRoomResponse) {
  return {
    getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(messages)),
    postTurn: vi.fn<ChatApi['postTurn']>().mockResolvedValue({ kind: 'stream', clientTurnId: 'c1', done: null, broken: false }),
    newConversation: vi.fn<ChatApi['newConversation']>().mockResolvedValue(ok({ thread: THREAD, archivedThreadId: null })),
    getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>(HEALTHY)),
    getSelection: vi.fn<ChatApi['getSelection']>().mockResolvedValue(ok({ workspaceId: 'demo', selected: ['reglead'], source: 'saved' })),
    setSelection: vi.fn<ChatApi['setSelection']>(),
    getDdSetup: vi.fn<ChatApi['getDdSetup']>(),
    setDdSetup: vi.fn<ChatApi['setDdSetup']>(),
    getDataRoom: vi.fn<ChatApi['getDataRoom']>().mockResolvedValue(ok(room)),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
    getFindings: vi.fn<ChatApi['getFindings']>().mockResolvedValue(ok(EMPTY_REGISTER)),
    submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
    submitFindingTag: vi.fn<ChatApi['submitFindingTag']>(),
    getChecklist: vi.fn<ChatApi['getChecklist']>(),
    getBriefing: vi.fn<ChatApi['getBriefing']>(),
    submitChecklistState: vi.fn<ChatApi['submitChecklistState']>(),
  } satisfies ChatApi;
}

function renderRoom(roomId: string, client: ChatApi, providers: boolean | 'data-room-only' = true) {
  const room = (
    <SelectionProvider client={client}>
      <ChatRoom roomId={roomId} agents={ROSTER} client={client} />
    </SelectionProvider>
  );
  if (providers === 'data-room-only') return render(<DataRoomProvider client={client}>{room}</DataRoomProvider>);
  return render(
    providers ? (
      <DataRoomProvider client={client}>
        <FindingsProvider client={client}>{room}</FindingsProvider>
      </DataRoomProvider>
    ) : (
      room
    ),
  );
}

const BUTTON = { name: 'Propose findings from this answer' };

describe('ChatRoom: propose findings', () => {
  it('is offered after an answer, when the data room has a document the agent can be shown', async () => {
    renderRoom('reglead', api(ANSWERED, roomWith(true)));

    expect(await screen.findByRole('button', BUTTON)).toBeEnabled();
    expect(screen.getByText(/nothing is a finding until you accept it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Findings page' })).toHaveAttribute('href', '/findings');
  });

  it('is disabled while the model connection cannot be used', async () => {
    const notConfigured: HealthReport = {
      ...HEALTHY,
      status: 'degraded',
      checks: { ...HEALTHY.checks, llm: 'not_configured' },
      llm: { configured: false, missing: ['LLM_API_KEY'], message: 'The model connection is not set up. Set LLM_API_KEY.' },
    };
    const client = { ...api(ANSWERED, roomWith(true)), getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>(notConfigured)) };
    renderRoom('reglead', client);

    await screen.findByText('The model connection is not set up. Set LLM_API_KEY.');
    expect(screen.getByRole('button', BUTTON)).toBeDisabled();
  });

  it('sends the intent with the request text and reads the register again when the turn is saved', async () => {
    const client = api(ANSWERED, roomWith(true));
    renderRoom('reglead', client);

    await userEvent.click(await screen.findByRole('button', BUTTON));

    await waitFor(() => expect(client.postTurn).toHaveBeenCalledTimes(1));
    const [room, text, , options] = client.postTurn.mock.calls[0];
    expect(room).toBe('reglead');
    expect(text).toBe(FINDINGS_REQUEST_TEXT);
    expect(options).toMatchObject({ intent: 'propose-findings' });
    await waitFor(() => expect(client.getFindings.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('waits for a new question after a proposal: asking again would propose from the proposal', async () => {
    renderRoom('reglead', api(AFTER_REQUEST, roomWith(true)));

    await screen.findByText('One finding.');
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  it.each([
    ['in the team chat', () => renderRoom('team', api(ANSWERED, roomWith(true)))],
    ['with no data room', () => renderRoom('reglead', api(ANSWERED, NO_ROOM))],
    ['when no document can be shown to the agent', () => renderRoom('reglead', api(ANSWERED, roomWith(false)))],
    ['before the agent has answered', () => renderRoom('reglead', api(roomData([], [], 'reglead'), roomWith(true)))],
    ['without the findings register', () => renderRoom('reglead', api(ANSWERED, roomWith(true)), 'data-room-only')],
    ['without the data room or the register', () => renderRoom('reglead', api(ANSWERED, roomWith(true)), false)],
    ['after an answer that was cut off', () => renderRoom('reglead', api(unfinished('partial'), roomWith(true)))],
    ['after an answer that failed', () => renderRoom('reglead', api(unfinished('error'), roomWith(true)))],
  ])('is not offered %s', async (_label, mount) => {
    mount();

    await screen.findByRole('log', { name: 'Messages' });
    await waitFor(() => expect(screen.queryByText(/Loading messages/)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });

  it('is not offered while the data room is still loading: unknown is not "has documents"', async () => {
    const client = api(ANSWERED, roomWith(true));
    client.getDataRoom.mockReturnValue(new Promise(() => undefined));
    renderRoom('reglead', client);

    await waitFor(() => expect(screen.queryByText(/Loading messages/)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', BUTTON)).not.toBeInTheDocument();
  });
});
