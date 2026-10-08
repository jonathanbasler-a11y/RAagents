import 'server-only';
import type { AgentsResponse, SelectionResponse } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { currentSelection } from './selection';

/** GET /api/agents: the browser-safe roster by order, plus the effective selection. */
export function getAgents(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    const body: AgentsResponse & { selection: SelectionResponse } = {
      agents: deps.registry.listPublicAgents(),
      selection: currentSelection(deps),
    };
    return json(body);
  } catch (error) {
    logFailure(deps.log, 'GET /api/agents', correlationId, error);
    return apiError('internal', correlationId);
  }
}
