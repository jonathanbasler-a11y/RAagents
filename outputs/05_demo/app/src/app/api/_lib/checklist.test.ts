import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { CHECKLIST_ITEM_IDS, LOCAL_PERSON, type ApiErrorBody, type ChecklistResponse } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { getChecklist, postChecklistState } from './checklist';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

// The checklist over HTTP: anyone who can reach the app can read it; a person moves an item between the four states with
// a strictly validated, same-origin, JSON post. "checked" needs an accepted finding tagged to the item.

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

const TEXT = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';

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

function setup(): ApiHarness {
  harness = apiHarness();
  const { store } = harness.runtime;
  store.createDataRoom('demo', { asOf: '2026-10-12', documents: [{ id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT }] });
  const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'lead', clientTurnId: 'c1', bootId: 'boot-test', deadlineAt: '2026-10-12T08:03:00.000Z' });
  store.proposeFindings('demo', {
    turnId: turn.id,
    agent: { agentId: 'lead', agentName: 'Rosa', agentVersion: '0.1.0', model: 'm', promptHash: 'h' },
    owner: 'Regulatory lead agent owner',
    findings: [checked()],
    refused: [],
  });
  return harness;
}

const move = (api: ApiHarness, item: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postChecklistState(postRequest(`/api/checklist/${item}`, body, headers), api.deps, item);

describe('GET /api/checklist', () => {
  it('lists every item in order, not checked, with how many accepted findings are tagged to each', async () => {
    const api = setup();
    api.runtime.store.decideFinding('demo', 'F-001', 'accepted', null, { checklistItem: 'regions', category: 'risk' });

    const response = getChecklist(api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await jsonOf<ChecklistResponse>(response);
    expect(body.workspaceId).toBe('demo');
    expect(body.items.map((entry) => entry.item)).toEqual([...CHECKLIST_ITEM_IDS]);
    expect(body.items.every((entry) => entry.state === 'not_checked')).toBe(true);
    expect(body.items.map((entry) => [entry.item, entry.acceptedFindings]).filter(([, count]) => count !== 0)).toEqual([['regions', 1]]);
  });

  it('works with no data room at all', async () => {
    harness = apiHarness();

    const body = await jsonOf<ChecklistResponse>(getChecklist(harness.deps));

    expect(body.items).toHaveLength(CHECKLIST_ITEM_IDS.length);
  });

  it('does not count a draft or a rejected finding', async () => {
    const api = setup();
    api.runtime.store.decideFinding('demo', 'F-001', 'rejected', null);

    const body = await jsonOf<ChecklistResponse>(getChecklist(api.deps));

    expect(body.items.every((entry) => entry.acceptedFindings === 0)).toBe(true);
  });

  it('answers 500 with a correlation id and a generic message when the database fails', async () => {
    const logs = captureLogs();
    harness = apiHarness({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = getChecklist(harness.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});

describe('POST /api/checklist/[item]: a person moves an item', () => {
  it('marks an item "not applicable" with a reason, stamped as a local person', async () => {
    const api = setup();

    const response = await move(api, 'designations', { state: 'not_applicable', reason: 'Not an orphan product.' });

    expect(response.status).toBe(200);
    const body = await jsonOf<ChecklistResponse>(response);
    expect(body.items.find((entry) => entry.item === 'designations')).toMatchObject({ state: 'not_applicable', reason: 'Not an orphan product.', changedBy: LOCAL_PERSON });
    expect(api.runtime.store.listChecklistEvents('demo')).toHaveLength(1);
  });

  it('marks an item "checked" only after an accepted finding is tagged to it', async () => {
    const api = setup();

    const refused = await move(api, 'regions', { state: 'checked' });
    expect(refused.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(refused)).error).toBe('checklist_needs_finding');

    api.runtime.store.decideFinding('demo', 'F-001', 'accepted', null, { checklistItem: 'regions', category: 'risk' });
    const allowed = await move(api, 'regions', { state: 'checked', reason: 'Matches the minutes.' });

    expect(allowed.status).toBe(200);
    expect((await jsonOf<ChecklistResponse>(allowed)).items.find((entry) => entry.item === 'regions')).toMatchObject({ state: 'checked', acceptedFindings: 1 });
  });

  it('takes a mark back to not checked', async () => {
    const api = setup();
    await move(api, 'regions', { state: 'could_not_check', reason: 'Plan not provided.' });

    const body = await jsonOf<ChecklistResponse>(await move(api, 'regions', { state: 'not_checked' }));

    expect(body.items.find((entry) => entry.item === 'regions')).toMatchObject({ state: 'not_checked', reason: null });
  });

  it.each([
    ['no state', {}],
    ['a state that is not one of the four', { state: 'done' }],
    ['a capital letter', { state: 'Checked' }],
    ['a trailing space', { state: 'not_applicable ', reason: 'x' }],
    ['"not applicable" with no reason', { state: 'not_applicable' }],
    ['"could not check" with a blank reason', { state: 'could_not_check', reason: '   ' }],
    ['a reason that is not text', { state: 'not_applicable', reason: 5 }],
    ['a reason over 300 characters', { state: 'not_applicable', reason: 'x'.repeat(301) }],
    ['a list', []],
    ['text', 'checked'],
  ])('answers 400 for %s, and changes nothing', async (_label, body) => {
    const api = setup();

    const response = await move(api, 'regions', body);

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('invalid_request');
    expect(api.runtime.store.listChecklistEvents('demo')).toEqual([]);
  });

  it('tells a list or text body what to send, rather than reading it as a state', async () => {
    const api = setup();

    for (const body of [[], '"checked"', 7]) {
      const response = await move(api, 'regions', body);
      expect(response.status).toBe(400);
      expect((await jsonOf<ApiErrorBody>(response)).message).toMatch(/Send \{ "state"/);
    }
  });

  it('answers 404 checklist_item_not_found for an item that is not there, and for an id that is not an id', async () => {
    const api = setup();

    for (const item of ['everything', 'Regions', '../etc', 'regions%20']) {
      const response = await move(api, item, { state: 'not_applicable', reason: 'x' });
      expect(response.status, item).toBe(404);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('checklist_item_not_found');
    }
  });

  it('takes the state and the reason from the body only: a person, a time or an item in the body are ignored', async () => {
    const api = setup();

    const body = await jsonOf<ChecklistResponse>(await move(api, 'regions', { state: 'not_applicable', reason: 'Single region.', changedBy: 'someone', changedAt: '2000-01-01', item: 'guidance' }));

    expect(body.items.find((entry) => entry.item === 'regions')).toMatchObject({ state: 'not_applicable', changedBy: LOCAL_PERSON });
    expect(body.items.find((entry) => entry.item === 'guidance')?.state).toBe('not_checked');
  });

  it('refuses a cross-site or non-JSON post with 403 before it opens the database', async () => {
    captureLogs();
    const api = setup();

    const cross = await move(api, 'regions', { state: 'not_applicable', reason: 'x' }, { 'sec-fetch-site': 'cross-site' });
    const text = await move(api, 'regions', { state: 'not_applicable', reason: 'x' }, { 'content-type': 'text/plain' });

    expect(cross.status).toBe(403);
    expect(text.status).toBe(403);
    expect(api.runtime.store.listChecklistEvents('demo')).toEqual([]);
  });

  it('answers 500 with a correlation id, naming nothing, when the store fails in an unexpected way', async () => {
    const logs = captureLogs();
    harness = apiHarness({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = await move(harness, 'regions', { state: 'not_applicable', reason: 'x' });

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});
