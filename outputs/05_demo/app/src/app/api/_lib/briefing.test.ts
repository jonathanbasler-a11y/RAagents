import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { ApiErrorBody, BriefingResponse, GatesResponse } from '@/shared/contracts';
import type { CheckedFinding } from '@/shared/findings';
import { FROZEN_NOW } from '@/server/chat/test-support';
import { getBriefing } from './briefing';
import { getGates, postGateDecision } from './gates';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

// GET /api/briefing: the briefing built from the live register, as JSON or as a Markdown download. Reading only.

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

const TEXT = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval. A paediatric plan has been agreed.';

const checked = (quote: string, claim: string): CheckedFinding => ({
  claim,
  quote,
  documentId: 'DR-01',
  documentTitle: 'Licensor overview',
  sourceType: 'company-disclosure',
  basis: 'attributed',
  publishedAt: '2026-07-14',
  confidence: 'medium',
  confidenceReason: 'Explicit.',
  assumptions: [],
});

/** A data room with three drafts: F-001 accepted and tagged, F-002 still a draft, F-003 rejected. */
function setup(withRoom = true): ApiHarness {
  harness = apiHarness();
  const { store } = harness.runtime;
  if (withRoom) {
    store.createDataRoom('demo', { asOf: '2026-10-12', documents: [{ id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', provided: true, text: TEXT }] });
    const { turn } = store.startTurn({ workspaceId: 'demo', roomId: 'lead', clientTurnId: 'c1', bootId: 'boot-test', deadlineAt: '2026-10-12T08:03:00.000Z' });
    store.proposeFindings('demo', {
      turnId: turn.id,
      agent: { agentId: 'lead', agentName: 'Rosa', agentVersion: '0.1.0', model: 'm', promptHash: 'h' },
      owner: 'Regulatory lead agent owner',
      findings: [
        checked('agreed one adequate and well-controlled pivotal study', 'The licensor says one study is enough.'),
        checked('A paediatric plan has been agreed.', 'Still only a draft claim.'),
        checked('is sufficient for approval', 'A claim a person rejected.'),
      ],
      refused: [{ claim: 'The study met its endpoint.', code: 'quote_not_in_document', message: 'The quote is not in DR-04.', documentId: 'DR-04' }],
    });
    store.decideFinding('demo', 'F-001', 'accepted', 'Matches the minutes.', { checklistItem: 'regions', category: 'risk' });
    store.decideFinding('demo', 'F-003', 'rejected', null);
  }
  return harness;
}

const get = (api: ApiHarness, query = '') => getBriefing(new Request(`http://localhost/api/briefing${query}`), api.deps);

describe('GET /api/briefing', () => {
  it('returns the briefing built from the register: the accepted, tagged finding is a risk; the draft and the rejected one are not in it', async () => {
    const api = setup();

    const response = get(api);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await jsonOf<BriefingResponse>(response);
    expect(body.workspaceId).toBe('demo');
    expect(body.generatedAt).toBe(FROZEN_NOW.toISOString());
    expect(body.briefing.asOf).toBe('2026-10-12');
    expect(body.briefing.risks).toMatchObject([{ id: 'F-001', claim: 'The licensor says one study is enough.', category: 'risk', checklistItem: 'regions', decisionNote: 'Matches the minutes.' }]);
    expect(JSON.stringify(body)).not.toContain('Still only a draft claim.');
    expect(JSON.stringify(body)).not.toContain('A claim a person rejected.');
    expect(body.briefing.counts).toMatchObject({ acceptedTagged: 1, drafts: 1, rejected: 1, openQuestions: 1 });
    expect(body.briefing.openQuestions).toMatchObject([{ id: 'Q-001', claim: 'The study met its endpoint.', documentId: 'DR-04' }]);
    expect(body.briefing.warnings.map((warning) => warning.code)).toContain('drafts_pending');
  });

  it('shows the three gates, and what a person decided at one, in the JSON and in the Markdown', async () => {
    const api = setup();
    const gates = await jsonOf<GatesResponse>(getGates(api.deps));
    const scope = gates.gates.find((gate) => gate.id === 'scope')!;
    await postGateDecision(postRequest('/api/gates/scope/decision', { option: 'proceed', factsHash: scope.factsHash }), api.deps, 'scope');

    const body = await jsonOf<BriefingResponse>(getBriefing(new Request('http://localhost/api/briefing'), api.deps));
    const markdown = await getBriefing(new Request('http://localhost/api/briefing?format=markdown'), api.deps).text();

    expect(body.briefing.gateDecisions.map((row) => [row.gate, row.status])).toEqual([
      ['scope', 'decided'],
      ['evidence', 'not_decided'],
      ['release', 'not_decided'],
    ]);
    expect(body.briefing.gateDecisions[0].latest).toMatchObject({ id: 'GD-1', option: 'proceed' });
    expect(markdown).toContain('## Gate decisions');
    expect(markdown).toContain('- **Scope and activation**: Decided: Go ahead, the recommended call');
  });

  it('warns when a gate was decided on facts that have since changed', async () => {
    const api = setup();
    const gates = await jsonOf<GatesResponse>(getGates(api.deps));
    const evidence = gates.gates.find((gate) => gate.id === 'evidence')!;
    await postGateDecision(postRequest('/api/gates/evidence/decision', { option: 'seek_more', factsHash: evidence.factsHash }), api.deps, 'evidence');
    api.runtime.store.decideFinding('demo', 'F-002', 'rejected', null);

    const body = await jsonOf<BriefingResponse>(getBriefing(new Request('http://localhost/api/briefing'), api.deps));

    expect(body.briefing.warnings.map((warning) => warning.code)).toContain('gate_outdated');
  });

  it('follows the checklist as it is now', async () => {
    const api = setup();
    api.runtime.store.setChecklistState('demo', 'regions', 'checked', null);
    api.runtime.store.setChecklistState('demo', 'designations', 'not_applicable', 'Not an orphan product.');

    const { briefing } = await jsonOf<BriefingResponse>(get(api));

    expect(briefing.checklist.find((row) => row.item === 'regions')).toMatchObject({ state: 'checked', findingIds: ['F-001'] });
    expect(briefing.checklist.find((row) => row.item === 'designations')).toMatchObject({ state: 'not_applicable', reason: 'Not an orphan product.' });
  });

  it('flags a finding whose document was withdrawn after it was accepted', async () => {
    const api = setup();
    api.runtime.store.withdrawDocument('demo', 'DR-01', 'wrong version');

    const { briefing } = await jsonOf<BriefingResponse>(get(api));

    expect(briefing.risks[0].documentWithdrawn).toBe(true);
    expect(briefing.warnings.map((warning) => warning.code)).toContain('withdrawn_document');
  });

  it('answers 200 with a warning, not an error, when there is no data room', async () => {
    const api = setup(false);

    const body = await jsonOf<BriefingResponse>(get(api));

    expect(body.briefing.asOf).toBeNull();
    expect(body.briefing.warnings.map((warning) => warning.code)).toContain('no_data_room');
    expect(body.briefing.checklist).toHaveLength(6);
  });

  it('returns Markdown as a download when asked, named for the as-of date', async () => {
    const api = setup();

    const response = get(api, '?format=markdown');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="dd-briefing-2026-10-12.md"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text.startsWith('# Regulatory due diligence briefing\n')).toBe(true);
    expect(text).toContain(`prepared ${FROZEN_NOW.toISOString()}`);
    expect(text).toContain('The licensor says one study is enough.');
    expect(text).not.toContain('Still only a draft claim.');
  });

  it('names the Markdown file without a date when there is no data room', async () => {
    const api = setup(false);

    expect(get(api, '?format=markdown').headers.get('content-disposition')).toBe('attachment; filename="dd-briefing.md"');
  });

  it('accepts format=json, and refuses any other format with 400', async () => {
    const api = setup();

    expect(get(api, '?format=json').status).toBe(200);
    for (const query of ['?format=pdf', '?format=', '?format=Markdown', '?format=markdown&format=json']) {
      const response = get(api, query);
      expect(response.status, query).toBe(400);
      expect((await jsonOf<ApiErrorBody>(response)).error).toBe('invalid_request');
    }
  });

  it('answers 500 with a correlation id and a generic message when the database fails', async () => {
    const logs = captureLogs();
    harness = apiHarness({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = get(harness);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});
