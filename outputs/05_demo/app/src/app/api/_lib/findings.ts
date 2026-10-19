import 'server-only';
import { FindingAlreadyDecidedError, FindingNotFoundError, FindingSourceWithdrawnError } from '@/server/chat/store';
import type { FindingDecisionResponse, FindingsResponse } from '@/shared/contracts';
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
    };
    return json(body);
  } catch (error) {
    logFailure(deps.log, 'GET /api/findings', correlationId, error);
    return apiError('internal', correlationId);
  }
}

type Decision = { ok: true; decision: 'accepted' | 'rejected'; note: string | null } | { ok: false; message: string };

/** Exactly "accept" or "reject": a typo, a different case or a missing word is never an approval. */
function parseDecision(value: unknown): Decision {
  const shape = 'Send { "decision": "accept" | "reject", "note": "…" } (the note is optional, up to 300 characters).';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, message: shape };
  const { decision, note } = value as { decision?: unknown; note?: unknown };
  if (decision !== 'accept' && decision !== 'reject') return { ok: false, message: `The decision must be exactly "accept" or "reject". ${shape}` };
  if (note !== undefined && note !== null && typeof note !== 'string') return { ok: false, message: `The note must be text. ${shape}` };
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > MAX_NOTE_CHARS) return { ok: false, message: `The note is longer than ${MAX_NOTE_CHARS} characters.` };
  return { ok: true, decision: decision === 'accept' ? 'accepted' : 'rejected', note: trimmed === '' ? null : trimmed };
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
    const finding = store.decideFinding(workspaceId, findingId, decision.decision, decision.note);
    const decided: FindingDecisionResponse = { finding };
    return json(decided);
  } catch (error) {
    if (error instanceof FindingNotFoundError) return apiError('finding_not_found', correlationId);
    if (error instanceof FindingAlreadyDecidedError) return apiError('finding_decided', correlationId);
    if (error instanceof FindingSourceWithdrawnError) return apiError('finding_source_withdrawn', correlationId);
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
