import 'server-only';
import { GateDecisionNotFoundError, GateFactsChangedError, GateReasonRequiredError } from '@/server/chat/store';
import type { GateId, GateTeam, GatesResponse } from '@/shared/contracts';
import { ALWAYS_HUMAN, DISAGREEMENT_RULE, isGateId } from '@/shared/gates';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';
import { currentSelection } from './selection';

// The gates over HTTP. Reading is open to anyone who can reach the app. A decision, or a dissent under one, is the
// person's: a same-origin JSON post with a strictly validated body. The facts and the recommended call are built on the
// server (by code, no model) and are never read from the request; the request carries only the choice, a reason and the
// hash of the facts the person saw. The app has no login, so the record says "person (local, not authenticated)". There
// is no route for an agent to write here.

function gatesBody(deps: ApiDeps): GatesResponse {
  const { store, workspaceId } = deps.runtime();
  const team: GateTeam = { selected: currentSelection(deps).selected.length, total: deps.registry.listAgents().length };
  return {
    workspaceId,
    generatedAt: deps.now().toISOString(),
    gates: store.listGates(workspaceId, team),
    alwaysHuman: [...ALWAYS_HUMAN],
    disagreementRule: DISAGREEMENT_RULE,
  };
}

/** GET /api/gates */
export function getGates(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    return json(gatesBody(deps));
  } catch (error) {
    logFailure(deps.log, 'GET /api/gates', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** The shared shape of the two posts: guard, body, gate, the store call, then the whole new state. */
async function postToGate(
  request: Request,
  deps: ApiDeps,
  gate: string,
  kind: 'decision' | 'dissent',
  write: (deps: ApiDeps, gate: GateId, body: unknown) => void,
): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/gates/${JSON.stringify(gate)}/${kind}`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (!isGateId(gate)) return apiError('gate_not_found', correlationId);
    try {
      write(deps, gate, body.value);
    } catch (error) {
      if (error instanceof GateFactsChangedError) return apiError('gate_facts_changed', correlationId);
      if (error instanceof GateReasonRequiredError) return apiError('gate_reason_required', correlationId);
      if (error instanceof GateDecisionNotFoundError) return apiError('gate_decision_not_found', correlationId);
      // The store checks the request with the same rules as the page; its messages are safe sentences.
      if (error instanceof RangeError) return apiError('invalid_request', correlationId, { message: error.message });
      throw error;
    }
    return json(gatesBody(deps));
  } catch (error) {
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/gates/[gate]/decision: a person decides. */
export function postGateDecision(request: Request, deps: ApiDeps, gate: string): Promise<Response> {
  return postToGate(request, deps, gate, 'decision', (api, id, body) => {
    const { store, workspaceId } = api.runtime();
    const team: GateTeam = { selected: currentSelection(api).selected.length, total: api.registry.listAgents().length };
    store.decideGate(workspaceId, id, body, team);
  });
}

/** POST /api/gates/[gate]/dissent: a person records a disagreement under a decision. */
export function postGateDissent(request: Request, deps: ApiDeps, gate: string): Promise<Response> {
  return postToGate(request, deps, gate, 'dissent', (api, id, body) => {
    const { store, workspaceId } = api.runtime();
    store.recordGateDissent(workspaceId, id, body);
  });
}
