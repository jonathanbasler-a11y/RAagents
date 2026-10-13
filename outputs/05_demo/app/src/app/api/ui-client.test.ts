import { afterEach, describe, expect, it } from 'vitest';
import { createChatClient } from '@/client/chat-client';
import { readLlmConfig } from '@/server/llm';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { ChatEvent, LlmConfigResult } from '@/shared/contracts';
import { getAgents } from './_lib/agents';
import { getHealth } from './_lib/health';
import { getRoomMessages, postNewThread } from './_lib/rooms';
import { getSelection, postSelection } from './_lib/selection';
import { postTurn } from './_lib/turns';
import { apiHarness, streamedReply, type ApiHarness } from './_lib/test-support';

// The UI's real API client (src/client/chat-client.ts) against the real route handlers,
// in-process. The injected fetch plays the browser: it resolves same-origin paths and adds
// Sec-Fetch-Site: same-origin, as a browser does for the app's own requests.

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function browserFetch(api: ApiHarness): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), 'http://localhost'), init);
    const headers = new Headers(request.headers);
    headers.set('sec-fetch-site', 'same-origin');
    const sameOrigin = new Request(request, { headers });
    const { pathname } = new URL(sameOrigin.url);
    const room = /^\/api\/rooms\/([^/]+)\/(turns|messages|new)$/.exec(pathname);
    if (room && room[2] === 'turns' && sameOrigin.method === 'POST') return postTurn(sameOrigin, decodeURIComponent(room[1]), api.deps);
    if (room && room[2] === 'messages' && sameOrigin.method === 'GET') return getRoomMessages(decodeURIComponent(room[1]), api.deps);
    if (room && room[2] === 'new' && sameOrigin.method === 'POST') return postNewThread(sameOrigin, decodeURIComponent(room[1]), api.deps);
    if (pathname === '/api/health') return getHealth(api.deps);
    if (pathname === '/api/agents') return getAgents(api.deps);
    if (pathname === '/api/selection') return sameOrigin.method === 'POST' ? postSelection(sameOrigin, api.deps) : getSelection(api.deps);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function setup(llmConfig?: (route: 'agents' | 'judge') => LlmConfigResult) {
  harness = apiHarness({ steps: [streamedReply('Check ', 'the label.')], llmConfig });
  const api = harness;
  const chat = createChatClient({
    fetch: browserFetch(api),
    newClientTurnId: () => '33333333-3333-4333-8333-333333333333',
    timeZone: () => 'Europe/Paris',
    sleep: async () => {},
  });
  return { api, chat };
}

describe('the UI chat client against the API', () => {
  it('streams a 1:1 turn to done, then reloads the saved question and reply', async () => {
    const { chat } = setup();
    const events: ChatEvent[] = [];

    const outcome = await chat.postTurn('lead', 'What would you check first?', { onEvent: (event) => events.push(event) });

    expect(outcome).toMatchObject({ kind: 'stream', broken: false, done: { type: 'done', status: 'done' } });
    expect(events.map((event) => event.type)).toEqual(['turn', 'route', 'agent_start', 'delta', 'delta', 'agent_end', 'done']);
    const saved = await chat.getMessages('lead');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.messages.map((message) => message.text)).toEqual(['What would you check first?', 'Check the label.']);
    expect(saved.data.runningTurn).toBeNull();
    const start = events.find((event) => event.type === 'agent_start');
    expect(saved.data.messages[1].id).toBe(start?.type === 'agent_start' ? start.messageId : undefined);
  });

  it('gets a duplicate answer, not a second turn, when the same clientTurnId is posted again', async () => {
    const { api, chat } = setup();
    await chat.postTurn('lead', 'What would you check first?');

    const repeat = await chat.postTurn('lead', 'What would you check first?');

    expect(repeat).toMatchObject({ kind: 'duplicate', status: 'done' });
    expect(api.fake.calls).toHaveLength(1);
  });

  it('is told llm_not_configured, and the health report carries the setup banner text', async () => {
    captureLogs();
    const { chat } = setup((route) => readLlmConfig(route, {}));

    const outcome = await chat.postTurn('lead', 'Hello?');
    const health = await chat.getHealth();

    expect(outcome).toMatchObject({ kind: 'rejected', status: 503, error: { error: 'llm_not_configured' } });
    expect(health.ok).toBe(true);
    if (!health.ok || !('llm' in health.data)) throw new Error('expected a health report');
    expect(health.data.llm).toMatchObject({ configured: false, missing: ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] });
    expect(health.data.llm.message).toEqual(expect.any(String));
  });

  it('reads and flips the selection, and starts a new conversation', async () => {
    const { chat } = setup();

    const before = await chat.getSelection();
    const after = await chat.setSelection('labels', true);
    const locked = await chat.setSelection('critic', false);
    const fresh = await chat.newConversation('lead');

    expect(before).toMatchObject({ ok: true, data: { source: 'default' } });
    expect(after).toMatchObject({ ok: true, data: { source: 'saved' } });
    expect(after.ok && after.data.selected).toContain('labels');
    expect(locked).toMatchObject({ ok: false, status: 409, error: { error: 'locked_agent' } });
    expect(fresh).toMatchObject({ ok: true, data: { thread: { status: 'active' } } });
  });
});
