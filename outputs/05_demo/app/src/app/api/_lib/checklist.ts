import 'server-only';
import { ChecklistNeedsFindingError } from '@/server/chat/store';
import { isChecklistItemId } from '@/shared/checklist';
import type { ChecklistResponse, Store, WorkspaceId } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

// The regulatory checklist over HTTP. Reading is open to anyone who can reach the app. Moving an item between the four
// states is the person's: a same-origin JSON post with a strictly validated body. The app has no login, so the change is
// stamped "person (local, not authenticated)". There is no route for an agent to write here.

function checklistBody(store: Store, workspaceId: WorkspaceId): ChecklistResponse {
  const accepted = new Set(store.listFindings(workspaceId).filter((finding) => finding.status === 'accepted').map((finding) => finding.id));
  const backing = new Map<string, number>();
  for (const tag of store.listFindingTags(workspaceId)) {
    if (accepted.has(tag.findingId)) backing.set(tag.checklistItem, (backing.get(tag.checklistItem) ?? 0) + 1);
  }
  return { workspaceId, items: store.listChecklist(workspaceId).map((entry) => ({ ...entry, acceptedFindings: backing.get(entry.item) ?? 0 })) };
}

/** GET /api/checklist */
export function getChecklist(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    const { store, workspaceId } = deps.runtime();
    return json(checklistBody(store, workspaceId));
  } catch (error) {
    logFailure(deps.log, 'GET /api/checklist', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/checklist/[item]: a person moves one item to a state. */
export async function postChecklistState(request: Request, deps: ApiDeps, item: string): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/checklist/${JSON.stringify(item)}`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (!isChecklistItemId(item)) return apiError('checklist_item_not_found', correlationId);
    const value = body.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return apiError('invalid_request', correlationId, { message: 'Send { "state": "…", "reason": "…" } (the reason is required for not_applicable and could_not_check).' });
    }
    const { state, reason } = value as { state?: unknown; reason?: unknown };

    const { store, workspaceId } = deps.runtime();
    try {
      // The store checks the state and the reason with the same rules as the page, and the database checks them again.
      store.setChecklistState(workspaceId, item, state as never, reason as never);
    } catch (error) {
      if (error instanceof RangeError) return apiError('invalid_request', correlationId, { message: error.message });
      throw error;
    }
    return json(checklistBody(store, workspaceId));
  } catch (error) {
    if (error instanceof ChecklistNeedsFindingError) return apiError('checklist_needs_finding', correlationId);
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
