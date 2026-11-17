import 'server-only';
import { GateDecisionNotFoundError, GateFactsChangedError, GateReasonRequiredError } from '@/server/chat/store';
import type { GateId, GatesResponse } from '@/shared/contracts';
import { ALWAYS_HUMAN, DISAGREEMENT_RULE, isGateId } from '@/shared/gates';
import type { ApiDeps } from './deps';
import { actorOf } from './decision-actor';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';
import { currentTeam } from './selection';

// The gates over HTTP. Reading is open to anyone who can reach the app. A decision, or a dissent under one, is the
// person's: a same-origin JSON post with a strictly validated body. The facts and the recommended call are built on the
// server (by code, no model) and are never read from the request; the request carries only the choice, a reason and the
// hash of the facts the person saw. The record names who decided: the person the server's session names (decision-actor.ts), or "person (local, not authenticated)" on a copy without sign-in; a name in the request is never used. There is
// no route for an agent to write here.

function gatesBody(deps: ApiDeps): GatesResponse {
  const { store, workspaceId } = deps.runtime();
  return {
    workspaceId,
    generatedAt: deps.now().toISOString(),
    gates: store.listGates(workspaceId, currentTeam(deps)),
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
  write: (deps: ApiDeps, gate: GateId, body: unknown, actor: string) => void,
): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/gates/${JSON.stringify(gate)}/${kind}`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  const actor = actorOf(deps.decider(request));
  if (actor === null) return apiError('sign_in_required', correlationId);
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (!isGateId(gate)) return apiError('gate_not_found', correlationId);
    try {
      write(deps, gate, body.value, actor);
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
  return postToGate(request, deps, gate, 'decision', (api, id, body, actor) => {
    const { store, workspaceId } = api.runtime();
    store.decideGate(workspaceId, id, body, currentTeam(api), actor);
  });
}

/** POST /api/gates/[gate]/dissent: a person records a disagreement under a decision. */
export function postGateDissent(request: Request, deps: ApiDeps, gate: string): Promise<Response> {
  return postToGate(request, deps, gate, 'dissent', (api, id, body, actor) => {
    const { store, workspaceId } = api.runtime();
    store.recordGateDissent(workspaceId, id, body, actor);
  });
}
