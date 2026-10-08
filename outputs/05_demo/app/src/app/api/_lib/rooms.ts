import 'server-only';
import { RoomBusyError } from '@/server/chat/store';
import type { AgentSpec, NewThreadResponse, RoomMessagesResponse } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

/** The team chat, or one active agent's 1:1 room. */
export type ResolvedRoom = { kind: 'team'; roomId: 'team' } | { kind: 'agent'; roomId: string; agent: AgentSpec };

const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** Null for anything that is not the team chat or an active agent (unknown and inactive agents alike). */
export function resolveRoom(room: string, registry: ApiDeps['registry']): ResolvedRoom | null {
  if (room === 'team') return { kind: 'team', roomId: 'team' };
  if (!AGENT_ID_PATTERN.test(room)) return null;
  const agent = registry.getAgent(room);
  return agent === undefined ? null : { kind: 'agent', roomId: agent.id, agent };
}

/** GET /api/rooms/[room]/messages: the room's active thread, its turns, and the turn running now. */
export function getRoomMessages(room: string, deps: ApiDeps): Response {
  const correlationId = deps.newId();
  try {
    const resolved = resolveRoom(room, deps.registry);
    if (resolved === null) return apiError('not_found', correlationId);
    const { store, workspaceId } = deps.runtime();
    const thread = store.getActiveThread(workspaceId, resolved.roomId);
    const body: RoomMessagesResponse = {
      roomId: resolved.roomId,
      thread,
      messages: store.listMessages(thread.id),
      turns: store.listTurns(thread.id),
      runningTurn: store.getRunningTurn(workspaceId, resolved.roomId),
    };
    return json(body);
  } catch (error) {
    logFailure(deps.log, `GET /api/rooms/${room}/messages`, correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** POST /api/rooms/[room]/new: archives the active thread (nothing is deleted) and opens an empty one. */
export async function postNewThread(request: Request, room: string, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused POST /api/rooms/${room}/new (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
      return apiError('invalid_request', correlationId, { message: 'The request body must be a JSON object.' });
    }
    const resolved = resolveRoom(room, deps.registry);
    if (resolved === null) return apiError('not_found', correlationId);
    const { store, workspaceId } = deps.runtime();
    try {
      const { thread, archived } = store.newThread(workspaceId, resolved.roomId);
      const response: NewThreadResponse = { thread, archivedThreadId: archived?.id ?? null };
      return json(response);
    } catch (error) {
      if (error instanceof RoomBusyError) return apiError('room_busy', correlationId, { runningTurnId: error.runningTurnId });
      throw error;
    }
  } catch (error) {
    logFailure(deps.log, `POST /api/rooms/${room}/new`, correlationId, error);
    return apiError('internal', correlationId);
  }
}
