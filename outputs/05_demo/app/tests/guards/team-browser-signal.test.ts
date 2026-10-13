import { afterEach, describe, expect, it } from 'vitest';
import { apiHarness, heldReply, postRequest, streamedReply, TURN_BODY, type ApiHarness } from '@/app/api/_lib/test-support';
import { postTurn } from '@/app/api/_lib/turns';
import { eventually, gate, parseSse } from '@/server/chat/test-support';
import type { ChatEvent } from '@/shared/contracts';

// Mutation sweep, guard 10 (BUILD-LEARNINGS Part 9.11): the browser's request signal never
// reaches a model call. turns.test.ts proves it for a 1:1 room. A mutation that handed the
// browser's signal to the team chat's executor alone left the whole suite green, although
// the team chat makes up to five model calls per turn, so this runs the same proof there.

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

const TEAM = '/api/rooms/team/turns';

describe('the team chat: the browser closing the tab', () => {
  it('lets the whole turn finish, and never hands the browser signal to any of its model calls', async () => {
    const hold = gate();
    harness = apiHarness({
      steps: [
        (call) => heldReply('Before the tab closed. ', hold.promise, 'After it closed.', call.signal),
        streamedReply('Carlos adds a risk.'),
        streamedReply('Summary.'),
      ],
    });
    const api = harness;
    const browser = new AbortController();
    const text = '@Rosa @Carlos what are the main regulatory risks for a biologic moving to Phase 3?';

    const response = await postTurn(postRequest(TEAM, { ...TURN_BODY, text }, {}, { signal: browser.signal }), 'team', api.deps);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const turn = parseSse(new TextDecoder().decode(first.value))[0] as Extract<ChatEvent, { type: 'turn' }>;
    expect(turn.type).toBe('turn');

    // The tab closes: the request is aborted and the reader cancelled, while Rosa is mid-reply.
    browser.abort();
    await reader.cancel();
    hold.release();

    await eventually(() => expect(api.runtime.store.getTurn(turn.turnId)?.status).toBe('done'));
    const replies = api.runtime.store
      .listMessages(turn.threadId)
      .filter((message) => message.author === 'agent')
      .map((message) => [message.agentName, message.status, message.text]);
    expect(replies).toEqual([
      ['Rosa', 'complete', 'Before the tab closed. After it closed.'],
      ['Carlos', 'complete', 'Carlos adds a risk.'],
      ['Sofia', 'complete', 'Summary.'],
    ]);
    expect(api.fake.calls).toHaveLength(3);
    expect(api.fake.calls.map((call) => call.signal?.aborted)).toEqual([false, false, false]);
  });
});
