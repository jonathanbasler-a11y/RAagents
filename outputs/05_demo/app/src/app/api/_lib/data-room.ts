import 'server-only';
import {
  DataRoomExistsError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  NoDataRoomError,
} from '@/server/chat/store';
import type { DataRoom, DataRoomDocumentResponse, DataRoomResponse, DataRoomDocumentSummary } from '@/shared/contracts';
import {
  DOCUMENT_ID_PATTERN,
  MAX_DOCUMENT_CHARS,
  MAX_REASON_CHARS,
  MAX_TURN_DOCUMENT_CHARS,
  checkAsOf,
  checkNewDocument,
} from '@/shared/data-room';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

// The data room of the runtime's workspace: the documents the agents work from. Starting it, adding a document and
// withdrawing one are the person's actions (same-origin JSON only); the agents have no way to change it. A document
// dated after the room's as-of date is refused here and again by the store and the database.

const LIMITS = { documentChars: MAX_DOCUMENT_CHARS, turnChars: MAX_TURN_DOCUMENT_CHARS } as const;

const isMapping = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function summarize(document: DataRoom['documents'][number]): DataRoomDocumentSummary {
  const { text, ...rest } = document;
  return { ...rest, chars: text?.length ?? 0 };
}

/** Whether the practice case can be loaded here. A pack that is there but broken is logged and counts as not available. */
function practiceAvailable(deps: ApiDeps): boolean {
  if (!deps.practiceRoom) return false;
  try {
    return deps.practiceRoom() !== null;
  } catch (error) {
    deps.log.warn(`[api] the practice data room cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function currentDataRoom(deps: ApiDeps): DataRoomResponse {
  const { store, workspaceId } = deps.runtime();
  const room = store.getDataRoom(workspaceId);
  return {
    workspaceId,
    dataRoom: room === null ? null : { asOf: room.asOf, createdAt: room.createdAt, documents: room.documents.map(summarize) },
    practiceAvailable: practiceAvailable(deps),
    limits: { ...LIMITS },
  };
}

/** GET /api/data-room */
export function getDataRoom(deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    return json(currentDataRoom(deps));
  } catch (error) {
    logFailure(deps.log, 'GET /api/data-room', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** GET /api/data-room/documents/[id]: one document with its text. */
export function getDocument(deps: ApiDeps, documentId: string): Response {
  const correlationId = deps.newId();
  if (!DOCUMENT_ID_PATTERN.test(documentId)) return apiError('document_not_found', correlationId);
  try {
    const { store, workspaceId } = deps.runtime();
    const document = store.getDataRoom(workspaceId)?.documents.find((entry) => entry.id === documentId);
    if (document === undefined) return apiError('document_not_found', correlationId);
    return json({ document } satisfies DataRoomDocumentResponse);
  } catch (error) {
    logFailure(deps.log, `GET /api/data-room/documents/${documentId}`, correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** The guard and the body, in the order every POST of this API runs them. */
async function readPost(request: Request, deps: ApiDeps, where: string, correlationId: string): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused POST ${where} (correlation ${correlationId}): ${guard.reason}`);
    return { ok: false, response: apiError('forbidden', correlationId) };
  }
  const body = await readJsonBody(request);
  if (!body.ok) return { ok: false, response: apiError('invalid_request', correlationId, { message: body.message }) };
  return { ok: true, value: body.value };
}

/** POST /api/data-room: start the data room, with an as-of date or with the fictional practice case. */
export async function postDataRoom(request: Request, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const read = await readPost(request, deps, '/api/data-room', correlationId);
  if (!read.ok) return read.response;
  const shape = 'Send { "asOf": "YYYY-MM-DD" } for an empty data room, or { "practice": true } for the fictional practice case.';
  try {
    const body = read.value;
    if (!isMapping(body) || (body.practice === undefined) === (body.asOf === undefined) || (body.practice !== undefined && body.practice !== true)) {
      return apiError('invalid_request', correlationId, { message: shape });
    }

    let room: { asOf: string; documents: Parameters<ReturnType<ApiDeps['runtime']>['store']['createDataRoom']>[1]['documents'] };
    if (body.practice === true) {
      const practice = deps.practiceRoom?.() ?? null;
      if (practice === null) return apiError('invalid_request', correlationId, { message: 'The fictional practice data room is not installed here.' });
      room = practice;
    } else {
      const asOf = checkAsOf(body.asOf);
      if (!asOf.ok) return apiError('invalid_request', correlationId, { message: asOf.message });
      room = { asOf: asOf.asOf, documents: [] };
    }

    const { store, workspaceId } = deps.runtime();
    store.createDataRoom(workspaceId, room);
    return json(currentDataRoom(deps));
  } catch (error) {
    if (error instanceof DataRoomExistsError) return apiError('data_room_exists', correlationId);
    if (error instanceof RangeError) return apiError('invalid_request', correlationId, { message: error.message });
    logFailure(deps.log, 'POST /api/data-room', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/data-room/documents: add one document. Only the known fields are read; the id and origin are the store's. */
export async function postDocument(request: Request, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const read = await readPost(request, deps, '/api/data-room/documents', correlationId);
  if (!read.ok) return read.response;
  try {
    const { store, workspaceId } = deps.runtime();
    const room = store.getDataRoom(workspaceId);
    if (room === null) return apiError('no_data_room', correlationId);

    const input = read.value;
    const checked = checkNewDocument(
      isMapping(input) ? { title: input.title, sourceType: input.sourceType, publishedAt: input.publishedAt, url: input.url, provided: input.provided, text: input.text } : input,
      room.asOf,
    );
    if (!checked.ok) return apiError('invalid_request', correlationId, { message: checked.message });

    const { title, sourceType, publishedAt, url, provided, text } = checked.document;
    const document = store.addDocument(workspaceId, { title, sourceType, publishedAt, url, provided, text, origin: 'added' });
    return json({ document } satisfies DataRoomDocumentResponse);
  } catch (error) {
    if (error instanceof NoDataRoomError) return apiError('no_data_room', correlationId);
    if (error instanceof DuplicateDocumentError || error instanceof RangeError) return apiError('invalid_request', correlationId, { message: error.message });
    logFailure(deps.log, 'POST /api/data-room/documents', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/data-room/documents/[id]: { action: 'withdraw', reason }. The only change a document can have. */
export async function postDocumentAction(request: Request, deps: ApiDeps, documentId: string): Promise<Response> {
  const correlationId = deps.newId();
  const read = await readPost(request, deps, `/api/data-room/documents/${documentId}`, correlationId);
  if (!read.ok) return read.response;
  if (!DOCUMENT_ID_PATTERN.test(documentId)) return apiError('document_not_found', correlationId);
  try {
    const body = read.value;
    if (!isMapping(body) || body.action !== 'withdraw') {
      return apiError('invalid_request', correlationId, { message: 'Send { "action": "withdraw", "reason": "…" }.' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason === '' || reason.length > MAX_REASON_CHARS) {
      return apiError('invalid_request', correlationId, { message: `The reason is required: 1 to ${MAX_REASON_CHARS} characters.` });
    }
    const { store, workspaceId } = deps.runtime();
    const document = store.withdrawDocument(workspaceId, documentId, reason);
    return json({ document } satisfies DataRoomDocumentResponse);
  } catch (error) {
    if (error instanceof NoDataRoomError) return apiError('no_data_room', correlationId);
    if (error instanceof DocumentNotFoundError) return apiError('document_not_found', correlationId);
    logFailure(deps.log, `POST /api/data-room/documents/${documentId}`, correlationId, error);
    return apiError('internal', correlationId);
  }
}
