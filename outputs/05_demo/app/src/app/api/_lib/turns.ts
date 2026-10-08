import 'server-only';
import { oneToOneExecutor } from '@/server/chat/one-to-one';
import { teamExecutor } from '@/server/chat/team';
import { startTurn, type RoomExecutor } from '@/server/chat/turn-runner';
import { resolveTimeZone } from '@/server/prompts';
import type { ChatLimits, TurnDuplicateResponse } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';
import { resolveRoom } from './rooms';
import { currentSelection } from './selection';
import { sseResponse } from './sse';

// POST /api/rooms/[room]/turns. Order is policy:
//   1. same-origin guard (403 before any work);
//   2. body: { text, clientTurnId, tz } only; any history the browser sends is ignored (400);
//   3. room: the team chat or an active agent (404);
//   4. model route configured (503, before any write);
//   5. start the turn (a repeat clientTurnId answers with the existing turn, no new model
//      call; another running turn answers 409), run it detached, stream its events.
// The team chat routes over the active roster and the saved "Selected for this DD".

export const TURN_TEXT_MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TurnBody = { ok: true; text: string; clientTurnId: string; timeZone: string } | { ok: false; message: string };

function parseTurnBody(value: unknown): TurnBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'The request body must be a JSON object.' };
  }
  const body = value as Record<string, unknown>;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length === 0 || text.length > TURN_TEXT_MAX_CHARS) {
    return { ok: false, message: `The question must be 1 to ${TURN_TEXT_MAX_CHARS.toLocaleString('en')} characters.` };
  }
  if (typeof body.clientTurnId !== 'string' || !UUID.test(body.clientTurnId)) {
    return { ok: false, message: 'clientTurnId must be a UUID.' };
  }
  const timeZone = resolveTimeZone(body.tz);
  if (timeZone === null) return { ok: false, message: 'tz must be an IANA time zone, such as Europe/Paris.' };
  return { ok: true, text, clientTurnId: body.clientTurnId.toLowerCase(), timeZone };
}

export async function postTurn(request: Request, room: string, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/rooms/${room}/turns`;
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }

  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    const input = parseTurnBody(body.value);
    if (!input.ok) return apiError('invalid_request', correlationId, { message: input.message });

    const resolved = resolveRoom(room, deps.registry);
    if (resolved === null) return apiError('not_found', correlationId);

    const config = deps.llmConfig('agents');
    if (!config.ok) {
      deps.log.warn(`[api] ${where} refused (correlation ${correlationId}): the agents model route is not configured (missing: ${config.error.missing.join(', ')})`);
      return apiError('llm_not_configured', correlationId);
    }

    const runtime = deps.runtime();
    const agentDeps = {
      store: runtime.store,
      getAgent: deps.registry.getAgent,
      llm: deps.llmClient(config.config),
      now: deps.now,
      newId: deps.newId,
      log: deps.log,
    };
    const executor: RoomExecutor =
      resolved.kind === 'team'
        ? teamExecutor({ ...agentDeps, agents: deps.registry.listAgents(), selected: new Set(currentSelection(deps).selected) })
        : oneToOneExecutor(resolved.agent.id, agentDeps);
    const outcome = startTurn(
      { roomId: resolved.roomId, clientTurnId: input.clientTurnId, text: input.text, timeZone: input.timeZone },
      executor,
      {
        store: runtime.store,
        bootId: runtime.bootId,
        workspaceId: runtime.workspaceId,
        now: deps.now,
        newId: deps.newId,
        log: deps.log,
        turnDeadlineMs: deps.turnDeadlineMs,
      },
    );

    switch (outcome.kind) {
      case 'started':
        return sseResponse(outcome.channel, { heartbeatMs: deps.heartbeatMs });
      case 'duplicate': {
        const duplicate: TurnDuplicateResponse = { duplicate: true, turnId: outcome.turn.id, status: outcome.turn.status };
        return json(duplicate);
      }
      case 'busy':
        return apiError('room_busy', correlationId, { runningTurnId: outcome.runningTurnId });
      case 'other_room':
        return apiError('invalid_request', correlationId, { message: 'This clientTurnId was already used in another room.' });
    }
  } catch (error) {
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
