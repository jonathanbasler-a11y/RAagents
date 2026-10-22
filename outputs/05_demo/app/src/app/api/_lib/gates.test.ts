import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { LOCAL_PERSON, type ApiErrorBody, type GateView, type GatesResponse } from '@/shared/contracts';
import { ALWAYS_HUMAN, DISAGREEMENT_RULE } from '@/shared/gates';
import { getGates, postGateDecision, postGateDissent } from './gates';
import { currentSelection } from './selection';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

// The gates over HTTP: anyone who can reach the app can read them; a person decides, or records a dissent, with a
// same-origin JSON post and a strictly validated body. The facts and the recommended call are built on the server and are
// never read from the request. There is no login, so a decision is stamped "person (local, not authenticated)".

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

const TEXT = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';

/** A workspace with a data room, so the scope gate recommends going ahead. */
function setup(): ApiHarness {
  harness = apiHarness();
  harness.runtime.store.createDataRoom('demo', {
    asOf: '2026-10-12',
    documents: [{ id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT }],
  });
  return harness;
}

const gateOf = (body: GatesResponse, id: string): GateView => body.gates.find((gate) => gate.id === id) as GateView;
const read = async (api: ApiHarness): Promise<GatesResponse> => jsonOf<GatesResponse>(getGates(api.deps));
const decide = (api: ApiHarness, gate: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postGateDecision(postRequest(`/api/gates/${gate}/decision`, body, headers), api.deps, gate);
const dissent = (api: ApiHarness, gate: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postGateDissent(postRequest(`/api/gates/${gate}/dissent`, body, headers), api.deps, gate);

describe('GET /api/gates', () => {
  it('lists the three gates with the facts, the recommended call, the always-human list and the disagreement rule', async () => {
    const api = setup();

    const response = getGates(api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await jsonOf<GatesResponse>(response);
    expect(body.workspaceId).toBe('demo');
    expect(body.generatedAt).toBe(api.deps.now().toISOString());
    expect(body.gates.map((gate) => [gate.id, gate.status])).toEqual([
      ['scope', 'not_decided'],
      ['evidence', 'not_decided'],
      ['release', 'not_decided'],
    ]);
    expect(gateOf(body, 'scope').recommended).toBe('proceed');
    expect(body.alwaysHuman).toEqual([...ALWAYS_HUMAN]);
    expect(body.disagreementRule).toBe(DISAGREEMENT_RULE);
  });

  it('shows the team as the app acts on it: the saved or default selection out of the roster', async () => {
    const api = setup();
    const selected = currentSelection(api.deps).selected.length;
    const total = api.deps.registry.listAgents().length;

    const team = gateOf(await read(api), 'scope').facts.find((fact) => fact.label === 'Team');

    expect(team?.text).toBe(`${selected} of ${total} agents are selected for this DD.`);
  });

  it('is read-only: asking changes nothing', async () => {
    const api = setup();

    await read(api);
    await read(api);

    expect(gateOf(await read(api), 'scope').decisions).toEqual([]);
  });

  it('answers a generic error with a reference when the server breaks, and logs the details', async () => {
    const logs = captureLogs();
    harness = apiHarness({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = getGates(harness.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});

describe('POST /api/gates/[gate]/decision', () => {
  it('records the recommended call without a reason and answers with the new state', async () => {
    const api = setup();
    const scope = gateOf(await read(api), 'scope');

    const response = await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash });

    expect(response.status).toBe(200);
    const body = await jsonOf<GatesResponse>(response);
    const after = gateOf(body, 'scope');
    expect(after.status).toBe('decided');
    expect(after.decisions[0]).toMatchObject({ id: 'GD-1', option: 'proceed', reason: null, recommended: 'proceed', actor: LOCAL_PERSON, dissents: [] });
    expect(after.decisions[0].facts).toEqual(scope.facts);
  });

  it('refuses another option without a reason with 400 gate_reason_required, and writes nothing', async () => {
    const api = setup();
    const evidence = gateOf(await read(api), 'evidence');

    for (const reason of [undefined, '', '   ']) {
      const response = await decide(api, 'evidence', { option: 'proceed', reason, factsHash: evidence.factsHash });
      expect(response.status).toBe(400);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('gate_reason_required');
    }
    expect(gateOf(await read(api), 'evidence').decisions).toEqual([]);
  });

  it('records another option with its reason, and keeps the call the code recommended', async () => {
    const api = setup();
    const evidence = gateOf(await read(api), 'evidence');

    const response = await decide(api, 'evidence', { option: 'proceed', reason: 'The seller sends the rest on Friday.', factsHash: evidence.factsHash });

    expect(response.status).toBe(200);
    expect(gateOf(await jsonOf<GatesResponse>(response), 'evidence').decisions[0]).toMatchObject({ option: 'proceed', recommended: 'seek_more', reason: 'The seller sends the rest on Friday.' });
  });

  it('refuses a decision taken on facts that changed with 409 gate_facts_changed, and writes nothing', async () => {
    const api = setup();
    const scope = gateOf(await read(api), 'scope');

    const response = await decide(api, 'scope', { option: 'proceed', factsHash: 'an-older-view' });

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('gate_facts_changed');
    expect(gateOf(await read(api), 'scope').factsHash).toBe(scope.factsHash);
    expect(gateOf(await read(api), 'scope').decisions).toEqual([]);
  });

  it('ignores a recommended call or facts in the request: the server builds both', async () => {
    const api = setup();
    const evidence = gateOf(await read(api), 'evidence');

    const response = await decide(api, 'evidence', { option: 'proceed', reason: 'ok', factsHash: evidence.factsHash, recommended: 'proceed', facts: [], actor: 'the lead' });

    const decision = gateOf(await jsonOf<GatesResponse>(response), 'evidence').decisions[0];
    expect(decision.recommended).toBe('seek_more');
    expect(decision.facts).toEqual(evidence.facts);
    expect(decision.actor).toBe(LOCAL_PERSON);
  });

  it('refuses an unknown gate with 404 gate_not_found', async () => {
    const api = setup();

    const response = await decide(api, 'everything', { option: 'proceed', factsHash: 'x' });

    expect(response.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('gate_not_found');
  });

  it('refuses a body that is not valid, with 400 invalid_request', async () => {
    const api = setup();
    const scope = gateOf(await read(api), 'scope');
    const bodies: unknown[] = ['not json {', '[]', 'null', '"proceed"', { option: 'buy', factsHash: scope.factsHash }, { factsHash: scope.factsHash }, { option: 'proceed' }, { option: 'proceed', reason: 5, factsHash: scope.factsHash }, { option: 'proceed', reason: 'x'.repeat(601), factsHash: scope.factsHash }];

    for (const body of bodies) {
      const response = await decide(api, 'scope', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await jsonOf<ApiErrorBody>(response)).error, JSON.stringify(body)).toBe('invalid_request');
    }
    expect(gateOf(await read(api), 'scope').decisions).toEqual([]);
  });

  it('refuses a cross-site or non-JSON post with 403 before it opens the database', async () => {
    captureLogs();
    const api = setup();
    const scope = gateOf(await read(api), 'scope');
    const calls = api.runtimeCalls();

    const cross = await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash }, { 'sec-fetch-site': 'cross-site' });
    const text = await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash }, { 'content-type': 'text/plain' });
    const missing = await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash }, { 'sec-fetch-site': undefined });

    for (const response of [cross, text, missing]) {
      expect(response.status).toBe(403);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('forbidden');
    }
    expect(api.runtimeCalls()).toBe(calls);
    expect(gateOf(await read(api), 'scope').decisions).toEqual([]);
  });

  it('accepts the same post when it is same-origin (positive control for the refusals above)', async () => {
    const api = setup();
    const scope = gateOf(await read(api), 'scope');

    expect((await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash })).status).toBe(200);
  });

  it('follows the evidence gate on the release gate: go ahead only after the evidence gate was decided go ahead', async () => {
    const api = setup();
    expect(gateOf(await read(api), 'release').recommended).toBe('seek_more');
    const evidence = gateOf(await read(api), 'evidence');
    await decide(api, 'evidence', { option: 'seek_more', factsHash: evidence.factsHash });

    expect(gateOf(await read(api), 'release').recommended).toBe('seek_more');
    expect(gateOf(await read(api), 'release').facts.find((fact) => fact.label === 'Evidence gate')?.text).toBe('Decided: ask for more information, on the facts as they are now.');
  });
});

describe('POST /api/gates/[gate]/dissent', () => {
  async function decided(api: ApiHarness) {
    const scope = gateOf(await read(api), 'scope');
    const body = await jsonOf<GatesResponse>(await decide(api, 'scope', { option: 'proceed', factsHash: scope.factsHash }));
    return gateOf(body, 'scope').decisions[0];
  }

  it('records a dissent under the decision and shows it there', async () => {
    const api = setup();
    const decision = await decided(api);

    const response = await dissent(api, 'scope', { decisionId: decision.id, role: 'CMC regulatory agent owner', reason: 'The site data is not in yet.' });

    expect(response.status).toBe(200);
    const after = gateOf(await jsonOf<GatesResponse>(response), 'scope');
    expect(after.status).toBe('decided');
    expect(after.decisions[0].dissents).toMatchObject([{ id: 'GX-1', decisionId: decision.id, role: 'CMC regulatory agent owner', reason: 'The site data is not in yet.', actor: LOCAL_PERSON }]);
    expect(gateOf(await jsonOf<GatesResponse>(getGates(api.deps)), 'release').facts.find((fact) => fact.label === 'Dissents recorded')?.text).toBe('1');
  });

  it('refuses a decision that does not exist or belongs to another gate with 404 gate_decision_not_found', async () => {
    const api = setup();
    const decision = await decided(api);

    for (const [gate, decisionId] of [['scope', 'GD-99'], ['evidence', decision.id]]) {
      const response = await dissent(api, gate, { decisionId, role: 'Quality', reason: 'No.' });
      expect(response.status).toBe(404);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('gate_decision_not_found');
    }
  });

  it('refuses an unknown gate with 404 gate_not_found', async () => {
    const api = setup();

    const response = await dissent(api, 'everything', { decisionId: 'GD-1', role: 'Quality', reason: 'No.' });

    expect(response.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('gate_not_found');
  });

  it('refuses a missing or oversized role or reason, and a body that is not an object, with 400 invalid_request', async () => {
    const api = setup();
    const decision = await decided(api);
    const good = { decisionId: decision.id, role: 'Quality', reason: 'No.' };
    const bodies: unknown[] = ['not json {', '[]', null, { ...good, role: '' }, { ...good, reason: '  ' }, { ...good, role: 'x'.repeat(61) }, { ...good, reason: 'x'.repeat(601) }, { ...good, decisionId: 7 }];

    for (const body of bodies) {
      const response = await dissent(api, 'scope', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await jsonOf<ApiErrorBody>(response)).error, JSON.stringify(body)).toBe('invalid_request');
    }
    expect(gateOf(await read(api), 'scope').decisions[0].dissents).toEqual([]);
  });

  it('refuses a cross-site or non-JSON post with 403', async () => {
    captureLogs();
    const api = setup();
    const decision = await decided(api);
    const good = { decisionId: decision.id, role: 'Quality', reason: 'No.' };

    expect((await dissent(api, 'scope', good, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await dissent(api, 'scope', good, { 'content-type': 'text/plain' })).status).toBe(403);
    expect(gateOf(await read(api), 'scope').decisions[0].dissents).toEqual([]);
    expect((await dissent(api, 'scope', good)).status).toBe(200);
  });
});
