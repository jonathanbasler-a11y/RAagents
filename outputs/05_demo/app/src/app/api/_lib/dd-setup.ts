import 'server-only';
import type { DdSetupResponse } from '@/shared/contracts';
import { DEFAULT_DD_SETUP, normalizeDdSetup, selectionAfterSetupChange } from '@/shared/dd-setup';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';
import { effectiveSelection } from './selection';

// The DD setup (development stage and asset classifications) of the runtime's workspace. Changing it
// applies the playbook rule to the selection in the same transaction, so the team chat, which reads the
// selection on every turn, follows. A person can still flip single switches through /api/selection.

const defaultSetup = () => ({ stage: DEFAULT_DD_SETUP.stage, classifications: [...DEFAULT_DD_SETUP.classifications] });

/** The current setup and selection of the runtime's workspace. */
export function currentDdSetup(deps: ApiDeps): DdSetupResponse {
  const { store, workspaceId } = deps.runtime();
  const saved = store.getDdSetup(workspaceId);
  return {
    workspaceId,
    setup: saved ?? defaultSetup(),
    source: saved === null ? 'default' : 'saved',
    selection: effectiveSelection(deps.registry.listAgents(), store.getSelection(workspaceId), workspaceId),
  };
}

/** GET /api/dd-setup */
export function getDdSetup(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    return json(currentDdSetup(deps));
  } catch (error) {
    logFailure(deps.log, 'GET /api/dd-setup', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/dd-setup: saves the whole setup and the selection that follows from it, and answers with both. */
export async function postDdSetup(request: Request, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused POST /api/dd-setup (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    const next = normalizeDdSetup(body.value);
    if (!next.ok) return apiError('invalid_request', correlationId, { message: next.message });

    // Read, change and save in one store transaction, with no await in between.
    const { store, workspaceId } = deps.runtime();
    const agents = [...deps.registry.listAgents()].sort((a, b) => a.order - b.order);
    store.updateDdSetup(workspaceId, ({ setup, selection }) => ({
      setup: next.setup,
      selection: selectionAfterSetupChange(
        agents,
        setup ?? DEFAULT_DD_SETUP,
        next.setup,
        effectiveSelection(agents, selection, workspaceId).selected,
      ),
    }));
    return json(currentDdSetup(deps));
  } catch (error) {
    logFailure(deps.log, 'POST /api/dd-setup', correlationId, error);
    return apiError('internal', correlationId);
  }
}
