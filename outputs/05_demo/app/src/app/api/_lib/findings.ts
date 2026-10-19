import 'server-only';
import {
  FindingAlreadyDecidedError,
  FindingAlreadyTaggedError,
  FindingNotAcceptedError,
  FindingNotFoundError,
  FindingSourceWithdrawnError,
} from '@/server/chat/store';
import { checkTagInput } from '@/shared/checklist';
import type { FindingDecisionResponse, FindingsResponse, FindingTagInput, FindingTagResponse } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

// The findings register over HTTP. Reading is open to anyone who can reach the app. A decision is the person's: a
// same-origin JSON post with a strictly validated body, made once. The app has no login, so the register stamps the
// decision "person (local, not authenticated)" and the page says so. There is no route for an agent to write here:
// agents propose through a findings proposal turn, which only ever creates drafts.

const FINDING_ID = /^F-\d{3,}$/;
const MAX_NOTE_CHARS = 300;

/** GET /api/findings */
export function getFindings(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    const { store, workspaceId } = deps.runtime();
    const body: FindingsResponse = {
      workspaceId,
      findings: store.listFindings(workspaceId),
      openQuestions: store.listOpenQuestions(workspaceId),
      tags: store.listFindingTags(workspaceId),
    };
    return json(body);
  } catch (error) {
    logFailure(deps.log, 'GET /api/findings', correlationId, error);
    return apiError('internal', correlationId);
  }
}

type Decision = { ok: true; decision: 'accepted' | 'rejected'; note: string | null; tag: FindingTagInput | null } | { ok: false; message: string };

/** Exactly "accept" or "reject": a typo, a different case or a missing word is never an approval. */
function parseDecision(value: unknown): Decision {
  const shape =
    'Send { "decision": "accept" | "reject", "note": "…", "checklistItem": "…", "category": "positive" | "risk" | "neutral" } (the note is optional, up to 300 characters; accepting needs the checklist item and the category).';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, message: shape };
  const { decision, note, checklistItem, category } = value as { decision?: unknown; note?: unknown; checklistItem?: unknown; category?: unknown };
  if (decision !== 'accept' && decision !== 'reject') return { ok: false, message: `The decision must be exactly "accept" or "reject". ${shape}` };
  if (note !== undefined && note !== null && typeof note !== 'string') return { ok: false, message: `The note must be text. ${shape}` };
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > MAX_NOTE_CHARS) return { ok: false, message: `The note is longer than ${MAX_NOTE_CHARS} characters.` };
  // Accepting says what the finding is about; a rejection is about nothing, so any tag sent with it is ignored.
  if (decision === 'reject') return { ok: true, decision: 'rejected', note: trimmed === '' ? null : trimmed, tag: null };
  const tag = checkTagInput(checklistItem, category);
  if (!tag.ok) return { ok: false, message: tag.message };
  return { ok: true, decision: 'accepted', note: trimmed === '' ? null : trimmed, tag: tag.tag };
}

/** POST /api/findings/[id]: a person accepts or rejects a draft. Once. */
export async function postFindingDecision(request: Request, deps: ApiDeps, findingId: string): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/findings/${JSON.stringify(findingId)}`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (!FINDING_ID.test(findingId)) return apiError('finding_not_found', correlationId);
    const decision = parseDecision(body.value);
    if (!decision.ok) return apiError('invalid_request', correlationId, { message: decision.message });

    const { store, workspaceId } = deps.runtime();
    const finding = store.decideFinding(workspaceId, findingId, decision.decision, decision.note, decision.tag ?? undefined);
    const tag = store.listFindingTags(workspaceId).find((entry) => entry.findingId === findingId) ?? null;
    const decided: FindingDecisionResponse = { finding, tag };
    return json(decided);
  } catch (error) {
    if (error instanceof FindingNotFoundError) return apiError('finding_not_found', correlationId);
    if (error instanceof FindingAlreadyDecidedError) return apiError('finding_decided', correlationId);
    if (error instanceof FindingSourceWithdrawnError) return apiError('finding_source_withdrawn', correlationId);
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/findings/[id]/tags: a person tags a finding they accepted without a tag. Once. */
export async function postFindingTag(request: Request, deps: ApiDeps, findingId: string): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/findings/${JSON.stringify(findingId)}/tags`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (!FINDING_ID.test(findingId)) return apiError('finding_not_found', correlationId);
    const value = body.value;
    const fields = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { checklistItem?: unknown; category?: unknown }) : {};
    const tag = checkTagInput(fields.checklistItem, fields.category);
    if (!tag.ok) return apiError('invalid_request', correlationId, { message: tag.message });

    const { store, workspaceId } = deps.runtime();
    const saved: FindingTagResponse = { tag: store.tagFinding(workspaceId, findingId, tag.tag) };
    return json(saved);
  } catch (error) {
    if (error instanceof FindingNotFoundError) return apiError('finding_not_found', correlationId);
    if (error instanceof FindingNotAcceptedError) return apiError('finding_not_accepted', correlationId);
    if (error instanceof FindingAlreadyTaggedError) return apiError('finding_tagged', correlationId);
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
