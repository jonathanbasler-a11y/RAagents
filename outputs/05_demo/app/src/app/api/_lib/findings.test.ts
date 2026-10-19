import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { LOCAL_PERSON, type ApiErrorBody, type Finding, type FindingsResponse } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { getFindings, postFindingDecision, postFindingTag } from './findings';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

// The findings register over HTTP: anyone who can reach the app can read it, and a decision is a strictly validated,
// same-origin, JSON post that a person makes once. The agent has no route here.

const AS_OF = '2026-10-12';
const TEXT = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

const checked = (): CheckedFinding => ({
  claim: 'The licensor says a single study is enough.',
  quote: 'agreed one adequate and well-controlled pivotal study is sufficient',
  documentId: 'DR-01',
  documentTitle: 'Licensor overview',
  sourceType: 'company-disclosure',
  basis: 'attributed',
  publishedAt: '2026-07-14',
  confidence: 'medium',
  confidenceReason: 'Explicit.',
  assumptions: [],
});

function setup(withDraft = true): ApiHarness {
  harness = apiHarness();
  const { store } = harness.runtime;
  store.createDataRoom('demo', { asOf: AS_OF, documents: [{ id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT }] });
  if (withDraft) {
    const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'lead', clientTurnId: 'c1', bootId: 'boot-test', deadlineAt: '2026-10-12T08:03:00.000Z' });
    store.proposeFindings('demo', {
      turnId: turn.id,
      agent: { agentId: 'lead', agentName: 'Rosa', agentVersion: '0.1.0', model: 'm', promptHash: 'h' },
      owner: 'Regulatory lead agent owner',
      findings: [checked()],
      refused: [{ claim: 'The study met its endpoint.', code: 'quote_not_in_document', message: 'The quote is not in DR-04.', documentId: 'DR-04' }],
    });
  }
  return harness;
}

const decide = (api: ApiHarness, id: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postFindingDecision(postRequest(`/api/findings/${id}`, body, headers), api.deps, id);

const tagRequest = (api: ApiHarness, id: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postFindingTag(postRequest(`/api/findings/${id}/tags`, body, headers), api.deps, id);

/** What accepting needs besides the decision: which checklist item the finding supports, and what kind of finding it is. */
const TAG = { checklistItem: 'regions', category: 'risk' } as const;

describe('GET /api/findings', () => {
  it('returns the register: the findings with who drafted them, and the open questions', async () => {
    const api = setup();

    const response = getFindings(api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await jsonOf<FindingsResponse>(response);
    expect(body.workspaceId).toBe('demo');
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({ id: 'F-001', status: 'draft', basis: 'attributed', documentTitle: 'Licensor overview', draftedBy: { agentName: 'Rosa' } });
    expect(body.openQuestions).toMatchObject([{ id: 'Q-001', reasonCode: 'quote_not_in_document', documentId: 'DR-04' }]);
  });

  it('is empty before anything is proposed, and when there is no data room', async () => {
    const api = setup(false);
    expect(await jsonOf<FindingsResponse>(getFindings(api.deps))).toMatchObject({ findings: [], openQuestions: [] });
    api.cleanup();
    harness = apiHarness();

    expect(await jsonOf<FindingsResponse>(getFindings(harness.deps))).toMatchObject({ findings: [], openQuestions: [] });
  });

  it('answers 500 with a correlation id and a generic message when the database fails', async () => {
    const logs = captureLogs();
    harness = apiHarness({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = getFindings(harness.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});

describe('GET /api/findings: the tags', () => {
  it('lists the tags of accepted findings next to the findings', async () => {
    const api = setup();
    await decide(api, 'F-001', { decision: 'accept', checklistItem: 'bottlenecks', category: 'risk' });

    const body = await jsonOf<FindingsResponse>(getFindings(api.deps));

    expect(body.tags).toMatchObject([{ findingId: 'F-001', checklistItem: 'bottlenecks', category: 'risk' }]);
  });

  it('has no tags before anything is accepted', async () => {
    const api = setup();

    expect((await jsonOf<FindingsResponse>(getFindings(api.deps))).tags).toEqual([]);
  });
});

describe('POST /api/findings/[id]/tags: a person tags a finding they accepted without one', () => {
  it('tags an accepted, untagged finding', async () => {
    const api = setup();
    api.runtime.store.decideFinding('demo', 'F-001', 'accepted', null);

    const response = await tagRequest(api, 'F-001', { checklistItem: 'guidance', category: 'neutral' });

    expect(response.status).toBe(200);
    expect((await jsonOf<{ tag: unknown }>(response)).tag).toMatchObject({ findingId: 'F-001', checklistItem: 'guidance', category: 'neutral', taggedBy: LOCAL_PERSON });
  });

  it('refuses a draft and a rejected finding (409 finding_not_accepted)', async () => {
    const api = setup();

    const draft = await tagRequest(api, 'F-001', TAG);
    api.runtime.store.decideFinding('demo', 'F-001', 'rejected', null);
    const rejected = await tagRequest(api, 'F-001', TAG);

    for (const response of [draft, rejected]) {
      expect(response.status).toBe(409);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('finding_not_accepted');
    }
  });

  it('tags once: a second tag answers 409 finding_tagged and changes nothing', async () => {
    const api = setup();
    await decide(api, 'F-001', { decision: 'accept', ...TAG });

    const response = await tagRequest(api, 'F-001', { checklistItem: 'guidance', category: 'positive' });

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('finding_tagged');
    expect(api.runtime.store.listFindingTags('demo')[0]).toMatchObject({ checklistItem: 'regions', category: 'risk' });
  });

  it.each([
    ['no tag', {}],
    ['an unknown item', { checklistItem: 'everything', category: 'risk' }],
    ['an unknown category', { checklistItem: 'regions', category: 'good' }],
    ['a list', []],
    ['text', 'regions'],
  ])('answers 400 for %s', async (_label, body) => {
    const api = setup();
    api.runtime.store.decideFinding('demo', 'F-001', 'accepted', null);

    const response = await tagRequest(api, 'F-001', body);

    expect(response.status).toBe(400);
    expect(api.runtime.store.listFindingTags('demo')).toEqual([]);
  });

  it('answers 404 for a finding that is not there, and refuses a cross-site post with 403', async () => {
    const api = setup();

    expect((await tagRequest(api, 'F-077', TAG)).status).toBe(404);
    expect((await tagRequest(api, '../etc', TAG)).status).toBe(404);
    expect((await tagRequest(api, 'F-001', TAG, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

describe('POST /api/findings/[id]: a person decides', () => {
  it('accepts a draft: the finding comes back decided, stamped as a local person, with the note', async () => {
    const api = setup();

    const response = await decide(api, 'F-001', { decision: 'accept', note: 'Matches the minutes.', ...TAG });

    expect(response.status).toBe(200);
    const { finding } = await jsonOf<{ finding: Finding }>(response);
    expect(finding).toMatchObject({ id: 'F-001', status: 'accepted', decidedBy: LOCAL_PERSON, decisionNote: 'Matches the minutes.' });
    expect(finding.decidedAt).not.toBeNull();
    expect(api.runtime.store.listFindingEvents('demo').map((event) => event.kind)).toEqual(['proposed', 'accepted']);
  });

  it('accepts with the tag: the response carries it, and the register keeps it, stamped as a local person', async () => {
    const api = setup();

    const body = await jsonOf<{ finding: Finding; tag: { findingId: string; checklistItem: string; category: string; taggedBy: string } | null }>(
      await decide(api, 'F-001', { decision: 'accept', checklistItem: 'ptrs-inputs', category: 'positive' }),
    );

    expect(body.tag).toMatchObject({ findingId: 'F-001', checklistItem: 'ptrs-inputs', category: 'positive', taggedBy: LOCAL_PERSON });
    expect(api.runtime.store.listFindingTags('demo')).toHaveLength(1);
  });

  it('rejects a draft with no tag, and ignores a tag sent with a rejection', async () => {
    const api = setup();

    const body = await jsonOf<{ finding: Finding; tag: unknown }>(await decide(api, 'F-001', { decision: 'reject', ...TAG }));

    expect(body.finding.status).toBe('rejected');
    expect(body.tag).toBeNull();
    expect(api.runtime.store.listFindingTags('demo')).toEqual([]);
  });

  it('rejects a draft, with no note', async () => {
    const api = setup();

    const { finding } = await jsonOf<{ finding: Finding }>(await decide(api, 'F-001', { decision: 'reject' }));

    expect(finding).toMatchObject({ status: 'rejected', decisionNote: null });
  });

  it.each([
    ['approve', { decision: 'approve' }],
    ['a capital letter', { decision: 'Accept' }],
    ['a trailing space', { decision: 'accept ' }],
    ['accepted instead of accept', { decision: 'accepted' }],
    ['yes', { decision: 'yes' }],
    ['true', { decision: true }],
    ['no decision', {}],
    ['a note that is not text', { decision: 'accept', note: 5, ...TAG }],
    ['a note over 300 characters', { decision: 'accept', note: 'x'.repeat(301), ...TAG }],
    ['no tag', { decision: 'accept' }],
    ['no category', { decision: 'accept', checklistItem: 'regions' }],
    ['no checklist item', { decision: 'accept', category: 'risk' }],
    ['an unknown checklist item', { decision: 'accept', checklistItem: 'everything', category: 'risk' }],
    ['a category that is not one of the three', { decision: 'accept', checklistItem: 'regions', category: 'good' }],
    ['a tag with a capital letter', { decision: 'accept', checklistItem: 'Regions', category: 'risk' }],
    ['a list', []],
    ['text', 'accept'],
  ])('answers 400 for %s, and decides nothing', async (_label, body) => {
    const api = setup();

    const response = await decide(api, 'F-001', body);

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('invalid_request');
    expect(api.runtime.store.listFindings('demo')[0].status).toBe('draft');
  });

  it('takes the decision from the body only: a status, a decider or an id in the body are ignored', async () => {
    const api = setup();

    const { finding } = await jsonOf<{ finding: Finding }>(await decide(api, 'F-001', { decision: 'reject', status: 'accepted', decidedBy: 'someone', id: 'F-009' }));

    expect(finding).toMatchObject({ id: 'F-001', status: 'rejected', decidedBy: LOCAL_PERSON });
  });

  it('decides once: a second decision answers 409 finding_decided and changes nothing', async () => {
    const api = setup();
    await decide(api, 'F-001', { decision: 'accept', ...TAG });

    const response = await decide(api, 'F-001', { decision: 'reject' });

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('finding_decided');
    expect(api.runtime.store.listFindings('demo')[0].status).toBe('accepted');
  });

  it('answers 404 for a finding that is not there, and for an id that is not an id', async () => {
    const api = setup();

    const missing = await decide(api, 'F-077', { decision: 'accept', ...TAG });
    const odd = await decide(api, '../etc', { decision: 'accept', ...TAG });

    expect(missing.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(missing)).error).toBe('finding_not_found');
    expect(odd.status).toBe(404);
  });

  it('will not accept a finding whose document was withdrawn (409), but lets it be rejected', async () => {
    const api = setup();
    api.runtime.store.withdrawDocument('demo', 'DR-01', 'wrong file');

    const accept = await decide(api, 'F-001', { decision: 'accept', ...TAG });
    expect(accept.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(accept)).error).toBe('finding_source_withdrawn');

    const reject = await decide(api, 'F-001', { decision: 'reject', note: 'source withdrawn' });
    expect(reject.status).toBe(200);
  });

  it('refuses a cross-site or non-JSON post with 403 before it opens the database', async () => {
    captureLogs();
    const api = setup();
    const before = api.runtimeCalls();

    const crossSite = await decide(api, 'F-001', { decision: 'accept' }, { 'sec-fetch-site': 'cross-site' });
    const plain = await decide(api, 'F-001', { decision: 'accept' }, { 'content-type': 'text/plain' });

    expect(crossSite.status).toBe(403);
    expect(plain.status).toBe(403);
    expect(api.runtimeCalls()).toBe(before);
    expect(api.runtime.store.listFindings('demo')[0].status).toBe('draft');
  });

  it('answers 500 with a correlation id, naming nothing, when the store fails in an unexpected way', async () => {
    const logs = captureLogs();
    const api = setup();
    const broken = apiHarness({ overrides: { runtime: () => ({ ...api.runtime, store: { ...api.runtime.store, decideFinding: () => { throw new Error('boom: /secret/path'); } } }) } });

    const response = await decide(broken, 'F-001', { decision: 'accept', ...TAG });

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
    broken.cleanup();
  });
});
