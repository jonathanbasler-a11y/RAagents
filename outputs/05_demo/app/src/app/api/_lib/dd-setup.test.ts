import { afterEach, describe, expect, it } from 'vitest';
import { AgentSpecError } from '@/server/agents';
import { fixtureSpecs } from '@/server/agents/test-fixtures';
import { readSse } from '@/server/chat/test-support';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { AgentSpec, ApiErrorBody, ChatEvent, DdSetupResponse } from '@/shared/contracts';
import { DEFAULT_DD_SETUP } from '@/shared/dd-setup';
import { getDdSetup, postDdSetup } from './dd-setup';
import { postSelection } from './selection';
import { postTurn } from './turns';
import { apiHarness, jsonOf, postRequest, streamedReply, TURN_BODY, type ApiHarness } from './test-support';

// The DD setup (stage and classifications) changes the selection the team chat routes by. The stock fixture
// roster has Carlos on by default although his trigger is `late`, which the real specs never do (a real-spec
// test pins that). So these tests use a roster that agrees with the rule:
//   lead (default) · cmc (late, off) · labels (exp, off) · conductor, critic, summary (locked).

const SPECS: AgentSpec[] = fixtureSpecs().map((spec) => {
  if (spec.id === 'cmc') return { ...spec, defaultSelected: false, trigger: 'late' };
  if (spec.id === 'labels') return { ...spec, trigger: 'exp' };
  return spec;
});

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(options: Parameters<typeof apiHarness>[0] = {}): ApiHarness {
  harness = apiHarness({ specs: SPECS, ...options });
  return harness;
}

const DEFAULTS = ['lead', 'conductor', 'critic', 'summary'];
const DEFAULT_CLASSES = ['orphan', 'paed'];
const save = (api: ApiHarness, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postDdSetup(postRequest('/api/dd-setup', body, headers), api.deps);
const bodyOf = (stage: string, classifications: string[] = DEFAULT_CLASSES) => ({ stage, classifications });
const selected = async (response: Response) => (await jsonOf<DdSetupResponse>(response)).selection.selected;

describe('GET /api/dd-setup', () => {
  it('returns the default setup and the default selection when nothing is saved', async () => {
    const api = setup();

    const response = getDdSetup(api.deps);

    expect(response.status).toBe(200);
    expect(await jsonOf<DdSetupResponse>(response)).toEqual({
      workspaceId: 'demo',
      setup: DEFAULT_DD_SETUP,
      source: 'default',
      selection: { workspaceId: 'demo', selected: DEFAULTS, source: 'default' },
    });
  });
});

describe('POST /api/dd-setup', () => {
  it('saves the stage, brings the late agent in at Phase 3 and answers with the new setup and selection', async () => {
    const api = setup();

    const response = await save(api, bodyOf('Phase 3'));

    expect(response.status).toBe(200);
    const body = await jsonOf<DdSetupResponse>(response);
    expect(body).toEqual({
      workspaceId: 'demo',
      setup: { stage: 'Phase 3', classifications: DEFAULT_CLASSES },
      source: 'saved',
      selection: { workspaceId: 'demo', selected: ['lead', 'cmc', 'conductor', 'critic', 'summary'], source: 'saved' },
    });
    expect(await jsonOf<DdSetupResponse>(getDdSetup(api.deps))).toEqual(body);
  });

  it('takes the late agent out again when the stage moves back to Phase 2', async () => {
    const api = setup();
    await save(api, bodyOf('Phase 3'));

    expect(await selected(await save(api, bodyOf('Phase 2')))).toEqual(DEFAULTS);
  });

  it('keeps an agent a person switched on by hand when the stage changes', async () => {
    const api = setup();
    await postSelection(postRequest('/api/selection', { agentId: 'labels', selected: true }), api.deps);

    expect(await selected(await save(api, bodyOf('Phase 3')))).toEqual(['lead', 'cmc', 'labels', 'conductor', 'critic', 'summary']);
  });

  it('brings a classification specialist in with its classification and out with it', async () => {
    const api = setup();

    expect(await selected(await save(api, bodyOf('Phase 2', ['orphan', 'paed', 'exp'])))).toEqual(['lead', 'labels', 'conductor', 'critic', 'summary']);
    expect(await selected(await save(api, bodyOf('Phase 2', ['orphan', 'paed'])))).toEqual(DEFAULTS);
  });

  it('saves the classifications in their canonical order, without repeats', async () => {
    const api = setup();

    const body = await jsonOf<DdSetupResponse>(await save(api, bodyOf('Phase 1', ['paed', 'orphan', 'paed'])));

    expect(body.setup).toEqual({ stage: 'Phase 1', classifications: ['orphan', 'paed'] });
  });

  it('ignores a selection smuggled into the body: only a person switching an agent changes one agent', async () => {
    const api = setup();

    const body = await jsonOf<DdSetupResponse>(await save(api, { ...bodyOf('Phase 2'), selected: ['lead', 'labels'], agentId: 'labels' }));

    expect(body.selection.selected).toEqual(DEFAULTS);
  });

  it.each([
    ['a cross-site POST', { 'sec-fetch-site': 'cross-site' }],
    ['a POST without Sec-Fetch-Site', { 'sec-fetch-site': undefined }],
    ['a text/plain POST', { 'content-type': 'text/plain' }],
  ])('answers %s with 403 before any work: no database, nothing saved', async (_name, headers) => {
    const api = setup();
    captureLogs();

    const response = await save(api, bodyOf('Phase 3'), headers);

    expect(response.status).toBe(403);
    expect(await jsonOf<ApiErrorBody>(response)).toEqual({ error: 'forbidden', message: expect.any(String), correlationId: expect.any(String) });
    expect(api.runtimeCalls()).toBe(0);
    expect(await jsonOf<DdSetupResponse>(getDdSetup(api.deps))).toMatchObject({ source: 'default' });
  });

  it('lets the same request through when it is a same-origin JSON POST (positive control)', async () => {
    const api = setup();

    expect((await save(api, bodyOf('Phase 3'))).status).toBe(200);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a null body', null],
    ['a missing stage', { classifications: [] }],
    ['an unknown stage', { stage: 'Phase 4', classifications: [] }],
    ['missing classifications', { stage: 'Phase 2' }],
    ['an unknown classification', { stage: 'Phase 2', classifications: ['biosimilar'] }],
  ])('answers %s with 400 and saves nothing', async (_name, body) => {
    const api = setup();

    const response = await save(api, body);

    expect(response.status).toBe(400);
    expect(await jsonOf<ApiErrorBody>(response)).toMatchObject({ error: 'invalid_request', correlationId: expect.any(String) });
    expect(await jsonOf<DdSetupResponse>(getDdSetup(api.deps))).toMatchObject({ source: 'default', setup: DEFAULT_DD_SETUP });
  });

  it('answers a broken roster with a generic 500 and logs the issue under the correlation id', async () => {
    const logs = captureLogs();
    const api = setup({
      overrides: {
        registry: {
          listAgents: () => {
            throw new AgentSpecError([{ source: 'lead.md', message: 'unique-issue-text' }]);
          },
          getAgent: () => undefined,
          listPublicAgents: () => [],
        },
      },
    });

    const response = await save(api, bodyOf('Phase 3'));

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('unique-issue-text');
    expect(logs.all()).toContain(body.correlationId);
  });

  it('changes who the team chat routes to: a manufacturing question reaches Carlos only after the stage is Phase 3', async () => {
    const api = setup({ steps: [streamedReply('Oskar answers.'), streamedReply('Carlos answers.')] });
    const ask = async (clientTurnId: string) => {
      const response = await postTurn(
        postRequest('/api/rooms/team/turns', { ...TURN_BODY, text: 'Does a manufacturing change need new comparability data?', clientTurnId }),
        'team',
        api.deps,
      );
      return (await readSse(response.body as ReadableStream<Uint8Array>)).find((event): event is Extract<ChatEvent, { type: 'route' }> => event.type === 'route');
    };

    const before = await ask('11111111-1111-4111-8111-111111111111');
    await save(api, bodyOf('Phase 3'));
    const after = await ask('22222222-2222-4222-8222-222222222222');

    expect(before?.route.primary).toBe('conductor');
    expect(after?.route).toMatchObject({ source: 'keyword', primary: 'cmc' });
  });
});
