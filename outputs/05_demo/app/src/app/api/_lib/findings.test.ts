import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { LOCAL_PERSON, type ApiErrorBody, type Finding, type FindingsResponse } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { getFindings, postFindingDecision } from './findings';
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

describe('POST /api/findings/[id]: a person decides', () => {
  it('accepts a draft: the finding comes back decided, stamped as a local person, with the note', async () => {
    const api = setup();

    const response = await decide(api, 'F-001', { decision: 'accept', note: 'Matches the minutes.' });

    expect(response.status).toBe(200);
    const { finding } = await jsonOf<{ finding: Finding }>(response);
    expect(finding).toMatchObject({ id: 'F-001', status: 'accepted', decidedBy: LOCAL_PERSON, decisionNote: 'Matches the minutes.' });
    expect(finding.decidedAt).not.toBeNull();
    expect(api.runtime.store.listFindingEvents('demo').map((event) => event.kind)).toEqual(['proposed', 'accepted']);
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
    ['a note that is not text', { decision: 'accept', note: 5 }],
    ['a note over 300 characters', { decision: 'accept', note: 'x'.repeat(301) }],
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
    await decide(api, 'F-001', { decision: 'accept' });

    const response = await decide(api, 'F-001', { decision: 'reject' });

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('finding_decided');
    expect(api.runtime.store.listFindings('demo')[0].status).toBe('accepted');
  });

  it('answers 404 for a finding that is not there, and for an id that is not an id', async () => {
    const api = setup();

    const missing = await decide(api, 'F-077', { decision: 'accept' });
    const odd = await decide(api, '../etc', { decision: 'accept' });

    expect(missing.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(missing)).error).toBe('finding_not_found');
    expect(odd.status).toBe(404);
  });

  it('will not accept a finding whose document was withdrawn (409), but lets it be rejected', async () => {
    const api = setup();
    api.runtime.store.withdrawDocument('demo', 'DR-01', 'wrong file');

    const accept = await decide(api, 'F-001', { decision: 'accept' });
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

    const response = await decide(broken, 'F-001', { decision: 'accept' });

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
    broken.cleanup();
  });
});
