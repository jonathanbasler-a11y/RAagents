import { afterEach, describe, expect, it } from 'vitest';
import { changed } from '@/server/agents/test-fixtures';
import { AgentSpecError } from '@/server/agents';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { AgentsResponse, ApiErrorBody, SelectionResponse } from '@/shared/contracts';
import { getAgents } from './agents';
import { getSelection, postSelection } from './selection';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(...args: Parameters<typeof apiHarness>): ApiHarness {
  harness = apiHarness(...args);
  return harness;
}

const DEFAULTS = ['lead', 'cmc', 'conductor', 'critic', 'summary'];
const flip = (api: ApiHarness, agentId: unknown, selected: unknown, headers: Record<string, string> = {}) =>
  postSelection(postRequest('/api/selection', { agentId, selected }, headers), api.deps);

describe('GET /api/selection', () => {
  it('returns the default selection by order, with every locked team role, when nothing is saved', async () => {
    const api = setup();

    const response = getSelection(api.deps);

    expect(response.status).toBe(200);
    expect(await jsonOf<SelectionResponse>(response)).toEqual({ workspaceId: 'demo', selected: DEFAULTS, source: 'default' });
  });
});

describe('POST /api/selection', () => {
  it('switches an agent on and answers with the full saved selection by order', async () => {
    const api = setup();

    const response = await flip(api, 'labels', true);

    expect(response.status).toBe(200);
    const saved = { workspaceId: 'demo', selected: ['lead', 'cmc', 'labels', 'conductor', 'critic', 'summary'], source: 'saved' };
    expect(await jsonOf<SelectionResponse>(response)).toEqual(saved);
    expect(await jsonOf<SelectionResponse>(getSelection(api.deps))).toEqual(saved);
  });

  it('switches an agent off', async () => {
    const api = setup();

    const body = await jsonOf<SelectionResponse>(await flip(api, 'cmc', false));

    expect(body).toEqual({ workspaceId: 'demo', selected: ['lead', 'conductor', 'critic', 'summary'], source: 'saved' });
  });

  it('refuses to switch a locked team role off with 409 locked_agent and saves nothing', async () => {
    const api = setup();

    const response = await flip(api, 'critic', false);

    expect(response.status).toBe(409);
    expect(await jsonOf<ApiErrorBody>(response)).toMatchObject({ error: 'locked_agent', correlationId: expect.any(String) });
    expect(await jsonOf<SelectionResponse>(getSelection(api.deps))).toMatchObject({ selected: DEFAULTS, source: 'default' });
  });

  it('accepts switching a locked team role on, which changes nothing (positive control)', async () => {
    const api = setup();

    const body = await jsonOf<SelectionResponse>(await flip(api, 'critic', true));

    expect(body.selected).toEqual(DEFAULTS);
  });

  it('answers 404 for an unknown or inactive agent', async () => {
    const api = setup({ specs: changed('labels', { active: false }) });

    expect((await flip(api, 'nobody', true)).status).toBe(404);
    expect((await flip(api, 'labels', true)).status).toBe(404);
  });

  it.each([
    ['a missing agent id', undefined, true],
    ['a non-boolean switch', 'labels', 'yes'],
  ])('answers %s with 400', async (_name, agentId, selected) => {
    const api = setup();

    expect((await flip(api, agentId, selected)).status).toBe(400);
  });

  it('refuses a cross-site POST with 403 and saves nothing', async () => {
    const api = setup();

    const response = await flip(api, 'labels', true, { 'sec-fetch-site': 'cross-site' });

    expect(response.status).toBe(403);
    expect(api.runtimeCalls()).toBe(0);
    expect(await jsonOf<SelectionResponse>(getSelection(api.deps))).toMatchObject({ source: 'default' });
  });

  it('leaves out saved agents that became inactive, and always includes locked roles', async () => {
    const api = setup();
    api.runtime.store.setSelection('demo', ['lead', 'labels', 'gone']);

    expect(await jsonOf<SelectionResponse>(getSelection(api.deps))).toEqual({
      workspaceId: 'demo',
      selected: ['lead', 'labels', 'conductor', 'critic', 'summary'],
      source: 'saved',
    });
  });
});

describe('GET /api/agents', () => {
  it('returns the public roster by order and the effective selection, without prompt text or routing terms', async () => {
    const api = setup();

    const response = getAgents(api.deps);

    expect(response.status).toBe(200);
    const body = await jsonOf<AgentsResponse & { selection: SelectionResponse }>(response);
    expect(body.agents.map((agent) => agent.id)).toEqual(['lead', 'cmc', 'labels', 'conductor', 'critic', 'summary']);
    expect(body.selection).toEqual({ workspaceId: 'demo', selected: DEFAULTS, source: 'default' });
    const text = JSON.stringify(body);
    expect(text).not.toContain('persona-brief-');
    expect(text).not.toContain('phase-limits-');
    expect(text).not.toContain('regulatory strategy');
  });

  it('answers a broken roster with a generic 500 and logs the spec issues under the correlation id', async () => {
    const logs = captureLogs();
    const api = setup({
      overrides: {
        registry: {
          listAgents: () => {
            throw new AgentSpecError([{ source: 'lead.md', message: 'unique-issue-text' }]);
          },
          getAgent: () => undefined,
          listPublicAgents: () => {
            throw new AgentSpecError([{ source: 'lead.md', message: 'unique-issue-text' }]);
          },
        },
      },
    });

    const response = getAgents(api.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(JSON.stringify(body)).not.toContain('unique-issue-text');
    expect(logs.errors().join('\n')).toContain(body.correlationId);
    expect(logs.errors().join('\n')).toContain('unique-issue-text');
  });
});
