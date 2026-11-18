import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_PERSON, type ApiErrorBody, type ChecklistResponse, type FindingDecisionResponse, type FindingTagResponse, type GatesResponse } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { postChecklistState } from './checklist';
import type { ApiDeps, Decider } from './deps';
import { postFindingDecision, postFindingTag } from './findings';
import { getGates, postGateDecision, postGateDissent } from './gates';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

// Names on decisions: every decision a person makes over HTTP is recorded under the person the server's session says,
// never under a name the request carries. Without sign-in it stays the local, unauthenticated person.

const TEXT = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';
const JANE = 'Jane Doe (jane.doe)';
const signedIn: Decider = { kind: 'person', actor: JANE };

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

/** A workspace with a data room and one draft finding; `decider` says who is signed in. */
function setup(decider?: ApiDeps['decider']): ApiHarness {
  harness = apiHarness(decider === undefined ? {} : { overrides: { decider } });
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

const TAG = { checklistItem: 'regions', category: 'risk' } as const;
const decideFinding = (api: ApiHarness, body: unknown) => postFindingDecision(postRequest('/api/findings/F-001', body), api.deps, 'F-001');
const tagFinding = (api: ApiHarness, body: unknown) => postFindingTag(postRequest('/api/findings/F-001/tags', body), api.deps, 'F-001');
const moveItem = (api: ApiHarness, item: string, body: unknown) => postChecklistState(postRequest(`/api/checklist/${item}`, body), api.deps, item);
const scopeOf = async (api: ApiHarness) => (await jsonOf<GatesResponse>(getGates(api.deps))).gates.find((gate) => gate.id === 'scope')!;
const decideScope = async (api: ApiHarness, extra: Record<string, unknown> = {}) =>
  postGateDecision(postRequest('/api/gates/scope/decision', { option: 'proceed', factsHash: (await scopeOf(api)).factsHash, ...extra }), api.deps, 'scope');

describe('names on decisions, signed in', () => {
  it('records the signed-in person on a finding decision and on the tag that comes with it', async () => {
    const api = setup(() => signedIn);
    const body = await jsonOf<FindingDecisionResponse>(await decideFinding(api, { decision: 'accept', ...TAG }));
    expect(body.finding.decidedBy).toBe(JANE);
    expect(body.tag?.taggedBy).toBe(JANE);
    expect(api.runtime.store.listFindingEvents('demo').at(-1)).toMatchObject({ by: JANE });
  });

  it('records the signed-in person on a tag added after accepting', async () => {
    const api = setup(() => signedIn);
    // Accepted before tags were asked for (the store allows it; the API asks for the tag when accepting).
    api.runtime.store.decideFinding('demo', 'F-001', 'accepted', null);
    const body = await jsonOf<FindingTagResponse>(await tagFinding(api, TAG));
    expect(body.tag.taggedBy).toBe(JANE);
  });

  it('records the signed-in person on a checklist change', async () => {
    const api = setup(() => signedIn);
    const body = await jsonOf<ChecklistResponse>(await moveItem(api, 'designations', { state: 'not_applicable', reason: 'Not an orphan product.' }));
    expect(body.items.find((entry) => entry.item === 'designations')?.changedBy).toBe(JANE);
  });

  it('records the signed-in person on a gate decision and a dissent', async () => {
    const api = setup(() => signedIn);
    const decided = (await jsonOf<GatesResponse>(await decideScope(api))).gates.find((gate) => gate.id === 'scope')!.decisions[0];
    expect(decided.actor).toBe(JANE);
    const response = await postGateDissent(
      postRequest('/api/gates/scope/dissent', { decisionId: decided.id, role: 'Quality', reason: 'Not yet.' }),
      api.deps,
      'scope',
    );
    expect((await jsonOf<GatesResponse>(response)).gates.find((gate) => gate.id === 'scope')!.decisions[0].dissents[0].actor).toBe(JANE);
  });

  it('ignores a name the request carries', async () => {
    const api = setup(() => signedIn);
    const body = await jsonOf<GatesResponse>(await decideScope(api, { actor: 'Someone Else', by: 'Someone Else' }));
    expect(body.gates.find((gate) => gate.id === 'scope')!.decisions[0].actor).toBe(JANE);
  });
});

describe('names on decisions, without sign-in', () => {
  it('keeps the local, unauthenticated person when the copy has no sign-in', async () => {
    const api = setup(() => ({ kind: 'local' }));
    expect((await jsonOf<FindingDecisionResponse>(await decideFinding(api, { decision: 'reject' }))).finding.decidedBy).toBe(LOCAL_PERSON);
    const items = (await jsonOf<ChecklistResponse>(await moveItem(api, 'designations', { state: 'not_applicable', reason: 'No.' }))).items;
    expect(items.find((entry) => entry.item === 'designations')?.changedBy).toBe(LOCAL_PERSON);
    expect((await jsonOf<GatesResponse>(await decideScope(api))).gates.find((gate) => gate.id === 'scope')!.decisions[0].actor).toBe(LOCAL_PERSON);
  });

  it('the test harness defaults to no sign-in', async () => {
    const api = setup();
    expect((await jsonOf<FindingDecisionResponse>(await decideFinding(api, { decision: 'reject' }))).finding.decidedBy).toBe(LOCAL_PERSON);
  });
});

describe('names on decisions, sign-in on but nobody signed in', () => {
  it.each([
    ['a finding decision', (api: ApiHarness) => decideFinding(api, { decision: 'reject' })],
    ['a tag', (api: ApiHarness) => tagFinding(api, TAG)],
    ['a checklist change', (api: ApiHarness) => moveItem(api, 'designations', { state: 'not_applicable', reason: 'No.' })],
    ['a gate decision', (api: ApiHarness) => decideScope(api)],
    ['a dissent', (api: ApiHarness) => postGateDissent(postRequest('/api/gates/scope/dissent', { decisionId: 'GD-1', role: 'Quality', reason: 'No.' }), api.deps, 'scope')],
  ])('refuses %s with 401 and writes nothing', async (_name, call) => {
    const api = setup(() => ({ kind: 'nobody' }));
    const response = await call(api);
    expect(response.status).toBe(401);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('sign_in_required');
    const { store } = api.runtime;
    expect(store.listFindings('demo')[0]?.status).toBe('draft');
    expect(store.listChecklistEvents('demo')).toHaveLength(0);
  });
});
