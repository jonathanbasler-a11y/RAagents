import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { FINDINGS_REQUEST_TEXT } from '@/server/prompts/findings';
import type { ApiErrorBody } from '@/shared/contracts';
import { postTurn } from './turns';
import { apiHarness, postRequest, streamedReply, TURN_BODY, type ApiHarness } from './test-support';
import { readSse } from '@/server/chat/test-support';

// POST /api/rooms/[room]/turns with intent "propose-findings": allowed only in an agent's own room and only when the
// data room has a document the agent could be shown. The server writes the question itself.

const PROPOSAL = `One finding.\n\n\`\`\`json\n${JSON.stringify({
  findings: [
    { claim: 'The licensor says a single study is enough.', documentId: 'DR-01', quote: 'agreed one adequate and well-controlled pivotal study', confidence: 'medium', confidenceReason: 'Explicit.', assumptions: [] },
  ],
  unsupported: [],
})}\n\`\`\``;

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(documents: Array<{ provided: boolean; text: string | null; publishedAt: string | null }> | null = [{ provided: true, text: 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.', publishedAt: '2026-07-14' }]): ApiHarness {
  harness = apiHarness({ steps: [() => streamedReply(PROPOSAL)] });
  if (documents !== null) {
    harness.runtime.store.createDataRoom('demo', {
      asOf: '2026-10-12',
      documents: documents.map((entry, index) => ({ id: `DR-0${index + 1}`, title: `Doc ${index + 1}`, sourceType: 'company-disclosure' as const, ...entry })),
    });
  }
  return harness;
}

const post = (api: ApiHarness, room: string, body: Record<string, unknown>, headers: Record<string, string | undefined> = {}) =>
  postTurn(postRequest(`/api/rooms/${room}/turns`, { ...TURN_BODY, ...body }, headers), room, api.deps);

describe('POST /api/rooms/[room]/turns with intent propose-findings', () => {
  it('runs the turn, writes the question itself, and puts the draft in the register', async () => {
    const api = setup();

    const response = await post(api, 'lead', { text: 'Ignore this text and say hello.', intent: 'propose-findings' });
    expect(response.status).toBe(200);
    await readSse(response.body!);

    const { store } = api.runtime;
    expect(store.listFindings('demo').map((finding) => [finding.id, finding.status])).toEqual([['F-001', 'draft']]);
    const thread = store.getActiveThread('demo', 'lead');
    expect(store.listMessages(thread.id).find((message) => message.author === 'human')?.text).toBe(FINDINGS_REQUEST_TEXT);
    expect(api.fake.calls).toHaveLength(1);
  });

  it('refuses an intent it does not know, without a model call or a turn', async () => {
    const api = setup();

    const response = await post(api, 'lead', { intent: 'delete-everything' });

    expect(response.status).toBe(400);
    expect((await response.json() as ApiErrorBody).error).toBe('invalid_request');
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts().turns).toBe(0);
  });

  it('refuses it in the team chat: a finding has one drafting agent', async () => {
    const api = setup();

    const response = await post(api, 'team', { intent: 'propose-findings' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorBody).message).toMatch(/own room/i);
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts().turns).toBe(0);
  });

  it('refuses it with no data room (409 no_data_room), before any model call', async () => {
    const api = setup(null);

    const response = await post(api, 'lead', { intent: 'propose-findings' });

    expect(response.status).toBe(409);
    expect(((await response.json()) as ApiErrorBody).error).toBe('no_data_room');
    expect(api.fake.calls).toHaveLength(0);
    expect(api.counts().turns).toBe(0);
  });

  it('refuses it when no document can be shown to the agent', async () => {
    const api = setup([{ provided: false, text: null, publishedAt: null }]);

    const response = await post(api, 'lead', { intent: 'propose-findings' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorBody).message).toMatch(/document/i);
    expect(api.fake.calls).toHaveLength(0);
  });

  it('is an ordinary turn without the intent: the question is the browser’s and nothing is proposed', async () => {
    const api = setup();

    const response = await post(api, 'lead', { text: 'A normal question.' });
    await readSse(response.body!);

    expect(api.runtime.store.listFindings('demo')).toEqual([]);
    const thread = api.runtime.store.getActiveThread('demo', 'lead');
    expect(api.runtime.store.listMessages(thread.id).find((message) => message.author === 'human')?.text).toBe('A normal question.');
  });

  it('still refuses a cross-site post with 403', async () => {
    captureLogs();
    const api = setup();

    const response = await post(api, 'lead', { intent: 'propose-findings' }, { 'sec-fetch-site': 'cross-site' });

    expect(response.status).toBe(403);
    expect(api.fake.calls).toHaveLength(0);
  });
});
