import { afterEach, describe, expect, it } from 'vitest';
import { changed } from '@/server/agents/test-fixtures';
import { gate, parseSse, readSse } from '@/server/chat/test-support';
import type { ApiErrorBody, ChatEvent, NewThreadResponse, RoomMessagesResponse } from '@/shared/contracts';
import { getRoomMessages, postNewThread } from './rooms';
import { postTurn } from './turns';
import { apiHarness, heldReply, jsonOf, postRequest, streamedReply, TURN_BODY, type ApiHarness } from './test-support';

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(...args: Parameters<typeof apiHarness>): ApiHarness {
  harness = apiHarness(...args);
  return harness;
}

async function finishedTurn(api: ApiHarness, room = 'lead'): Promise<Extract<ChatEvent, { type: 'turn' }>> {
  const response = await postTurn(postRequest(`/api/rooms/${room}/turns`, TURN_BODY), room, api.deps);
  const events = await readSse(response.body as ReadableStream<Uint8Array>);
  return events[0] as Extract<ChatEvent, { type: 'turn' }>;
}

describe('GET /api/rooms/[room]/messages', () => {
  it("returns the active thread's messages and turns, with no running turn once the turn has ended", async () => {
    const api = setup({ steps: [streamedReply('Saved reply.')] });
    const turn = await finishedTurn(api);

    const response = getRoomMessages('lead', api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await jsonOf<RoomMessagesResponse>(response);
    expect(body.roomId).toBe('lead');
    expect(body.thread).toMatchObject({ id: turn.threadId, status: 'active', roomId: 'lead' });
    expect(body.messages.map((message) => [message.author, message.text])).toEqual([
      ['human', TURN_BODY.text],
      ['agent', 'Saved reply.'],
    ]);
    expect(body.turns).toEqual([expect.objectContaining({ id: turn.turnId, status: 'done' })]);
    expect(body.runningTurn).toBeNull();
  });

  it('shows the running turn while it runs, so a reload can show "in progress" and poll', async () => {
    const hold = gate();
    const api = setup({ steps: [(call) => heldReply('Part ', hold.promise, 'two.', call.signal)] });
    const response = await postTurn(postRequest('/api/rooms/lead/turns', TURN_BODY), 'lead', api.deps);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const turn = parseSse(new TextDecoder().decode((await reader.read()).value))[0] as Extract<ChatEvent, { type: 'turn' }>;

    const body = await jsonOf<RoomMessagesResponse>(getRoomMessages('lead', api.deps));

    expect(body.runningTurn).toMatchObject({ id: turn.turnId, status: 'running' });
    expect(body.turns).toEqual([expect.objectContaining({ id: turn.turnId, status: 'running' })]);
    hold.release();
    await reader.cancel();
  });

  it('opens an empty thread for a room with no conversation yet, including the team chat', async () => {
    const api = setup();

    const lead = await jsonOf<RoomMessagesResponse>(getRoomMessages('lead', api.deps));
    const team = await jsonOf<RoomMessagesResponse>(getRoomMessages('team', api.deps));

    expect(lead).toMatchObject({ roomId: 'lead', messages: [], turns: [], runningTurn: null, thread: { status: 'active' } });
    expect(team).toMatchObject({ roomId: 'team', messages: [], turns: [], runningTurn: null });
  });

  it('answers 404 for an unknown room or an inactive agent, and opens no thread', async () => {
    const api = setup({ specs: changed('labels', { active: false }) });

    expect(getRoomMessages('nobody', api.deps).status).toBe(404);
    expect(getRoomMessages('labels', api.deps).status).toBe(404);
    expect(getRoomMessages('../etc', api.deps).status).toBe(404);
    expect(api.counts().threads).toBe(0);
  });
});

describe('POST /api/rooms/[room]/new', () => {
  it('archives the active thread, keeps its messages, and opens an empty one', async () => {
    const api = setup({ steps: [streamedReply('Old reply.')] });
    const turn = await finishedTurn(api);

    const response = await postNewThread(postRequest('/api/rooms/lead/new', {}), 'lead', api.deps);

    expect(response.status).toBe(200);
    const body = await jsonOf<NewThreadResponse>(response);
    expect(body.archivedThreadId).toBe(turn.threadId);
    expect(body.thread).toMatchObject({ status: 'active', roomId: 'lead' });
    expect(body.thread.id).not.toBe(turn.threadId);
    const after = await jsonOf<RoomMessagesResponse>(getRoomMessages('lead', api.deps));
    expect(after.thread.id).toBe(body.thread.id);
    expect(after.messages).toEqual([]);
    // Nothing was deleted.
    expect(api.counts()).toEqual({ threads: 2, turns: 1, messages: 2 });
  });

  it('answers 409 room_busy while a turn runs in the room', async () => {
    const hold = gate();
    const api = setup({ steps: [(call) => heldReply('Busy ', hold.promise, 'room.', call.signal)] });
    const running = await postTurn(postRequest('/api/rooms/lead/turns', TURN_BODY), 'lead', api.deps);
    const reader = (running.body as ReadableStream<Uint8Array>).getReader();
    const turn = parseSse(new TextDecoder().decode((await reader.read()).value))[0] as Extract<ChatEvent, { type: 'turn' }>;

    const response = await postNewThread(postRequest('/api/rooms/lead/new', {}), 'lead', api.deps);

    expect(response.status).toBe(409);
    expect(await jsonOf<ApiErrorBody>(response)).toMatchObject({ error: 'room_busy', runningTurnId: turn.turnId });
    hold.release();
    await reader.cancel();
  });

  it('refuses a cross-site or non-JSON POST with 403 and changes nothing', async () => {
    const api = setup();

    const crossSite = await postNewThread(postRequest('/api/rooms/lead/new', {}, { 'sec-fetch-site': 'cross-site' }), 'lead', api.deps);
    const plain = await postNewThread(postRequest('/api/rooms/lead/new', '{}', { 'content-type': 'text/plain' }), 'lead', api.deps);

    expect(crossSite.status).toBe(403);
    expect(plain.status).toBe(403);
    expect(api.runtimeCalls()).toBe(0);
    expect(api.counts().threads).toBe(0);
  });

  it('answers 404 for an unknown room and 400 for a body that is not a JSON object', async () => {
    const api = setup();

    expect((await postNewThread(postRequest('/api/rooms/nobody/new', {}), 'nobody', api.deps)).status).toBe(404);
    expect((await postNewThread(postRequest('/api/rooms/lead/new', 'nope'), 'lead', api.deps)).status).toBe(400);
    expect((await postNewThread(postRequest('/api/rooms/lead/new', []), 'lead', api.deps)).status).toBe(400);
  });
});
