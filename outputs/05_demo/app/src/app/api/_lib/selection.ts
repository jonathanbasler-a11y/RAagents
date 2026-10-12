import 'server-only';
import type { AgentId, AgentSpec, SelectionResponse, WorkspaceId } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

// "Selected for this DD", per workspace. Locked agents (the team roles) are always selected;
// a workspace that never saved its switches gets the specs' defaults.

/** The selection the app acts on: by order, active agents only, every locked agent included. */
export function effectiveSelection(agents: readonly AgentSpec[], saved: readonly AgentId[] | null, workspaceId: WorkspaceId): SelectionResponse {
  const byOrder = [...agents].sort((a, b) => a.order - b.order);
  if (saved === null) {
    return { workspaceId, selected: byOrder.filter((agent) => agent.locked || agent.defaultSelected).map((agent) => agent.id), source: 'default' };
  }
  const chosen = new Set(saved);
  return { workspaceId, selected: byOrder.filter((agent) => agent.locked || chosen.has(agent.id)).map((agent) => agent.id), source: 'saved' };
}

/** The current selection of the runtime's workspace. */
export function currentSelection(deps: ApiDeps): SelectionResponse {
  const { store, workspaceId } = deps.runtime();
  return effectiveSelection(deps.registry.listAgents(), store.getSelection(workspaceId), workspaceId);
}

/** GET /api/selection */
export function getSelection(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    return json(currentSelection(deps));
  } catch (error) {
    logFailure(deps.log, 'GET /api/selection', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/selection: flips one switch and answers with the whole new selection. */
export async function postSelection(request: Request, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused POST /api/selection (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    const value = body.value as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.agentId !== 'string' || typeof value.selected !== 'boolean') {
      return apiError('invalid_request', correlationId, { message: 'Send { agentId, selected } with selected true or false.' });
    }
    const agent = deps.registry.getAgent(value.agentId);
    if (agent === undefined) return apiError('not_found', correlationId);
    if (agent.locked && !value.selected) return apiError('locked_agent', correlationId);

    // Read, change and save without an await in between: requests cannot interleave here.
    const { store, workspaceId } = deps.runtime();
    const current = effectiveSelection(deps.registry.listAgents(), store.getSelection(workspaceId), workspaceId);
    const next = value.selected
      ? [...new Set([...current.selected, agent.id])]
      : current.selected.filter((id) => id !== agent.id);
    store.setSelection(workspaceId, next);
    return json(effectiveSelection(deps.registry.listAgents(), store.getSelection(workspaceId), workspaceId));
  } catch (error) {
    logFailure(deps.log, 'POST /api/selection', correlationId, error);
    return apiError('internal', correlationId);
  }
}
