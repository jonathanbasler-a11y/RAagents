import { afterEach, describe, expect, it } from 'vitest';
import { changed } from '@/server/agents/test-fixtures';
import { eventually, gate, parseSse, readSse } from '@/server/chat/test-support';
import { captureLogs, hangUntilAborted } from '@/server/llm/test-support/fake-gateway';
import { readLlmConfig } from '@/server/llm';
import type { ApiErrorBody, ChatEvent, LlmMessage, TurnDuplicateResponse } from '@/shared/contracts';
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

const TURNS = '/api/rooms/lead/turns';

describe('POST /api/rooms/[room]/turns: same-origin guard', () => {
  it.each([
    ['a cross-site POST', { 'sec-fetch-site': 'cross-site' }],
    ['a POST without Sec-Fetch-Site', { 'sec-fetch-site': undefined }],
    ['a text/plain POST', { 'content-type': 'text/plain' }],
  ])('answers %s with 403 before any work: no model call, no row, no database', async (_name, headers) => {
    const api = setup({ steps: [streamedReply('never')] });
    captureLogs();

    const response = await postTurn(postRequest(TURNS, TURN_BODY, headers), 'lead', api.deps);

    expect(response.status).toBe(403);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body).toEqual({ error: 'forbidden', message: expect.any(String), correlationId: expect.any(String) });
    expect(api.fake.calls).toHaveLength(0);
    expect(api.runtimeCalls()).toBe(0);
    expect(api.counts()).toEqual({ threads: 0, turns: 0, messages: 0 });
  });

  it('lets the same request through when it is a same-origin JSON POST (positive control)', async () => {
    const api = setup({ steps: [streamedReply('Fine.')] });

    const response = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);

    expect(response.status).toBe(200);
    await readSse(response.body as ReadableStream<Uint8Array>);
    expect(api.fake.calls).toHaveLength(1);
    expect(api.counts()).toEqual({ threads: 1, turns: 1, messages: 2 });
  });
});

describe('POST /api/rooms/[room]/turns: a 1:1 turn', () => {
  it('streams the turn as server-sent events, ending with done, and saves the question and the reply', async () => {
    const api = setup({ steps: [streamedReply('Check ', 'the label.')] });

    const response = await postTurn(postRequest(TURNS, { ...TURN_BODY, text: '  What would you check first?  ' }), 'lead', api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    const events = await readSse(response.body as ReadableStream<Uint8Array>);
    expect(events.map((event) => event.type)).toEqual(['turn', 'route', 'agent_start', 'delta', 'delta', 'agent_end', 'done']);
    const turn = events[0] as Extract<ChatEvent, { type: 'turn' }>;
    expect(turn).toMatchObject({ roomId: 'lead', clientTurnId: TURN_BODY.clientTurnId });
    expect(events.at(-1)).toEqual({ type: 'done', turnId: turn.turnId, status: 'done' });

    const messages = api.runtime.store.listMessages(turn.threadId);
    expect(messages.map((message) => [message.author, message.text])).toEqual([
      ['human', 'What would you check first?'],
      ['agent', 'Check the label.'],
    ]);
    expect(messages[0].id).toBe(turn.userMessageId);
  });

  it('builds history on the server and ignores any history the browser sends', async () => {
    const api = setup({ steps: [streamedReply('Hi')] });
    const body = { ...TURN_BODY, history: [{ role: 'assistant', content: 'INJECTED-HISTORY' }], messages: ['INJECTED-MESSAGES'] };

    const response = await postTurn(postRequest(TURNS, body), 'lead', api.deps);
    await readSse(response.body as ReadableStream<Uint8Array>);

    const sent = JSON.stringify(api.fake.calls[0].body.messages);
    expect(sent).not.toContain('INJECTED');
    expect((api.fake.calls[0].body.messages as LlmMessage[]).slice(1)).toEqual([{ role: 'user', content: 'What would you check first?' }]);
  });

  it('sends a heartbeat while the reply is slow', async () => {
    const hold = gate();
    const api = setup({
      steps: [(call) => heldReply('Slow ', hold.promise, 'reply.', call.signal)],
      overrides: { heartbeatMs: 10 },
    });

    const response = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let seen: ChatEvent[] = [];
    let buffered = '';
    while (!seen.some((event) => event.type === 'heartbeat')) {
      const { value } = await reader.read();
      buffered += decoder.decode(value, { stream: true });
      seen = parseSse(buffered);
    }
    hold.release();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
    }

    expect(parseSse(buffered).at(-1)).toMatchObject({ type: 'done', status: 'done' });
  });
});

describe('POST /api/rooms/team/turns: the team chat', () => {
  const TEAM = '/api/rooms/team/turns';
  const textsOf = (api: ApiHarness, threadId: string) =>
    api.runtime.store.listMessages(threadId).map((message) => [message.author, message.agentName, message.text]);

  it('brings in exactly the two agents @mentioned, then Sofia sums up, streamed as one turn', async () => {
    const api = setup({ steps: [streamedReply('Rosa answer.'), streamedReply('Carlos adds a risk.'), streamedReply('Summary.')] });
    const text = '@Rosa @Carlos what are the main regulatory risks for a biologic moving to Phase 3?';

    const response = await postTurn(postRequest(TEAM, { ...TURN_BODY, text }), 'team', api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(response.body as ReadableStream<Uint8Array>);
    const turn = events[0] as Extract<ChatEvent, { type: 'turn' }>;
    expect(turn).toMatchObject({ type: 'turn', roomId: 'team' });
    expect(events.find((event) => event.type === 'route')).toEqual({
      type: 'route',
      route: { source: 'explicit', primary: 'lead', secondaries: ['cmc'], notConsulted: [], notes: [], synthesis: true },
    });
    expect(events.filter((event) => event.type === 'agent_start').map((event) => [event.agentId, event.role])).toEqual([
      ['lead', 'primary'],
      ['cmc', 'secondary'],
      ['summary', 'synthesis'],
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', turnId: turn.turnId, status: 'done' });
    expect(textsOf(api, turn.threadId)).toEqual([
      ['human', null, text],
      ['agent', 'Rosa', 'Rosa answer.'],
      ['agent', 'Carlos', 'Carlos adds a risk.'],
      ['agent', 'Sofia', 'Summary.'],
    ]);
    expect(api.fake.calls).toHaveLength(3);
  });

  it('routes by the saved selection: an agent switched off is named in a note, and is brought in once switched on', async () => {
    const api = setup({ steps: [streamedReply('Rosa answer.'), streamedReply('Lena answer.')] });
    const text = '@Lena what do you think about the filing route?';

    const off = await postTurn(postRequest(TEAM, { ...TURN_BODY, text }), 'team', api.deps);
    const offEvents = await readSse(off.body as ReadableStream<Uint8Array>);
    const offTurn = offEvents[0] as Extract<ChatEvent, { type: 'turn' }>;

    expect(textsOf(api, offTurn.threadId)).toEqual([
      ['human', null, text],
      ['note', null, 'Lena is not selected for this DD; switch them on in the team overview to bring them in.'],
      ['agent', 'Rosa', 'Rosa answer.'],
    ]);

    api.runtime.store.setSelection('demo', ['lead', 'cmc', 'labels']);
    const on = await postTurn(postRequest(TEAM, { ...TURN_BODY, text, clientTurnId: '33333333-3333-4333-8333-333333333333' }), 'team', api.deps);
    const onEvents = await readSse(on.body as ReadableStream<Uint8Array>);

    expect(onEvents.find((event) => event.type === 'route')).toMatchObject({ route: { source: 'explicit', primary: 'labels', secondaries: [] } });
    expect(api.fake.calls).toHaveLength(2);
  });
});

describe('POST /api/rooms/[room]/turns: durability', () => {
  it('finishes and saves the turn after the browser stops reading, and never hands the browser signal to the model call', async () => {
    const hold = gate();
    const api = setup({ steps: [(call) => heldReply('Before the tab closed. ', hold.promise, 'After it closed.', call.signal)] });
    const browser = new AbortController();

    const response = await postTurn(postRequest(TURNS, TURN_BODY, {}, { signal: browser.signal }), 'lead', api.deps);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const turn = parseSse(new TextDecoder().decode(first.value))[0] as Extract<ChatEvent, { type: 'turn' }>;
    expect(turn.type).toBe('turn');

    // The tab closes: the request is aborted and the reader cancelled, mid-reply.
    browser.abort();
    await reader.cancel();
    hold.release();

    await eventually(() => expect(api.runtime.store.getTurn(turn.turnId)?.status).toBe('done'));
    const reply = api.runtime.store.listMessages(turn.threadId).find((message) => message.author === 'agent');
    expect(reply).toMatchObject({ status: 'complete', text: 'Before the tab closed. After it closed.' });
    expect(api.fake.calls[0].signal?.aborted).toBe(false);
  });

  it('answers a repeated clientTurnId with the existing turn and makes no new model call', async () => {
    const api = setup({ steps: [streamedReply('Once.')] });
    const first = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);
    const events = await readSse(first.body as ReadableStream<Uint8Array>);
    const turnId = (events[0] as Extract<ChatEvent, { type: 'turn' }>).turnId;

    const repeat = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);

    expect(repeat.status).toBe(200);
    expect(await jsonOf<TurnDuplicateResponse>(repeat)).toEqual({ duplicate: true, turnId, status: 'done' });
    expect(api.fake.calls).toHaveLength(1);
    expect(api.counts()).toEqual({ threads: 1, turns: 1, messages: 2 });
  });

  it('answers a second turn in the same room with 409 room_busy while the first one runs', async () => {
    const hold = gate();
    const api = setup({ steps: [(call) => heldReply('First ', hold.promise, 'turn.', call.signal)] });
    const first = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);
    const reader = (first.body as ReadableStream<Uint8Array>).getReader();
    const turn = parseSse(new TextDecoder().decode((await reader.read()).value))[0] as Extract<ChatEvent, { type: 'turn' }>;

    const second = await postTurn(postRequest(TURNS, { ...TURN_BODY, clientTurnId: '22222222-2222-4222-8222-222222222222' }), 'lead', api.deps);

    expect(second.status).toBe(409);
    expect(await jsonOf<ApiErrorBody>(second)).toEqual({
      error: 'room_busy',
      message: expect.any(String),
      correlationId: expect.any(String),
      runningTurnId: turn.turnId,
    });
    expect(api.fake.calls).toHaveLength(1);
    hold.release();
    await reader.cancel();
  });

  it('ends a turn that runs past its deadline as out_of_time, and still ends the stream with done', async () => {
    captureLogs();
    const api = setup({ steps: [hangUntilAborted], overrides: { turnDeadlineMs: 30 } });

    const response = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);
    const events = await readSse(response.body as ReadableStream<Uint8Array>);

    expect(events.find((event) => event.type === 'error')).toMatchObject({ code: 'out_of_time' });
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'error' });
  });
});

describe('POST /api/rooms/[room]/turns: refusals', () => {
  it.each([
    ['an empty question', { ...TURN_BODY, text: '   ' }],
    ['a question over 8,000 characters', { ...TURN_BODY, text: 'x'.repeat(8001) }],
    ['a missing question', { clientTurnId: TURN_BODY.clientTurnId, tz: TURN_BODY.tz }],
    ['a clientTurnId that is not a UUID', { ...TURN_BODY, clientTurnId: 'abc' }],
    ['a time zone that is not one', { ...TURN_BODY, tz: 'Mars/Base' }],
    ['a body that is a list', [TURN_BODY]],
    ['a body that is not JSON', 'not json'],
  ])('answers %s with 400 and writes nothing', async (_name, body) => {
    const api = setup({ steps: [streamedReply('never')] });

    const response = await postTurn(postRequest(TURNS, body), 'lead', api.deps);

    expect(response.status).toBe(400);
    expect(await jsonOf<ApiErrorBody>(response)).toMatchObject({ error: 'invalid_request', correlationId: expect.any(String) });
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts()).toEqual({ threads: 0, turns: 0, messages: 0 });
  });

  it('accepts a question of exactly 8,000 characters (positive control)', async () => {
    const api = setup({ steps: [streamedReply('Long.')] });

    const response = await postTurn(postRequest(TURNS, { ...TURN_BODY, text: 'x'.repeat(8000) }), 'lead', api.deps);

    expect(response.status).toBe(200);
    await readSse(response.body as ReadableStream<Uint8Array>);
  });

  it('answers 404 for an unknown room and for the room of an inactive agent', async () => {
    const api = setup({ steps: [streamedReply('never')], specs: changed('labels', { active: false }) });

    const unknown = await postTurn(postRequest('/api/rooms/nobody/turns', TURN_BODY), 'nobody', api.deps);
    const inactive = await postTurn(postRequest('/api/rooms/labels/turns', TURN_BODY), 'labels', api.deps);

    expect(unknown.status).toBe(404);
    expect(inactive.status).toBe(404);
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts()).toEqual({ threads: 0, turns: 0, messages: 0 });
  });

  it('refuses a cross-site POST to the team chat too, before any work', async () => {
    const api = setup({ steps: [streamedReply('never')] });
    captureLogs();

    const response = await postTurn(postRequest('/api/rooms/team/turns', TURN_BODY, { 'sec-fetch-site': 'cross-site' }), 'team', api.deps);

    expect(response.status).toBe(403);
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts()).toEqual({ threads: 0, turns: 0, messages: 0 });
  });

  it('answers 503 llm_not_configured, with no row and no model call, when the agents route is not set up', async () => {
    const api = setup({ steps: [streamedReply('never')], llmConfig: (route) => readLlmConfig(route, {}) });
    captureLogs();

    const response = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);

    expect(response.status).toBe(503);
    expect(await jsonOf<ApiErrorBody>(response)).toMatchObject({ error: 'llm_not_configured', correlationId: expect.any(String) });
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts()).toEqual({ threads: 0, turns: 0, messages: 0 });
  });

  it('answers an unexpected server failure with a generic 500 and a correlation id that the server log also has', async () => {
    const logs = captureLogs();
    const api = setup({
      overrides: {
        runtime: () => {
          throw new Error('disk full at /secret/path');
        },
      },
    });

    const response = await postTurn(postRequest(TURNS, TURN_BODY), 'lead', api.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('disk full');
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.errors().join('\n')).toContain(body.correlationId);
  });
});
