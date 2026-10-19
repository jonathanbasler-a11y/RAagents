import 'server-only';
import { oneToOneExecutor } from '@/server/chat/one-to-one';
import { teamExecutor } from '@/server/chat/team';
import { startTurn, type RoomExecutor } from '@/server/chat/turn-runner';
import { resolveTimeZone } from '@/server/prompts';
import { TURN_INTENTS, type ChatLimits, type TurnDuplicateResponse, type TurnIntent } from '@/shared/contracts';
import { documentsForTurn } from '@/shared/data-room';
import { FINDINGS_REQUEST_TEXT } from '@/shared/findings';
import type { ApiDeps } from './deps';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';
import { resolveRoom } from './rooms';
import { currentSelection } from './selection';
import { sseResponse } from './sse';

// POST /api/rooms/[room]/turns. Order is policy:
//   1. same-origin guard (403 before any work);
//   2. body: { text, clientTurnId, tz } only, plus an optional intent (a findings proposal: the server then writes
//      the question itself, and refuses the team chat, a missing data room and a room with nothing to show, before any
//      model call); any history the browser sends is ignored (400);
//   3. room: the team chat or an active agent (404);
//   4. model route configured (503, before any write);
//   5. start the turn (a repeat clientTurnId answers with the existing turn, no new model
//      call; another running turn in the room answers 409; two turns already running on the
//      server answer 429, with nothing written), run it detached, stream its events.
// The team chat routes over the active roster and the saved "Selected for this DD".

export const TURN_TEXT_MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TurnBody = { ok: true; text: string; clientTurnId: string; timeZone: string; intent: TurnIntent | null } | { ok: false; message: string };

function parseTurnBody(value: unknown): TurnBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'The request body must be a JSON object.' };
  }
  const body = value as Record<string, unknown>;
  if (body.intent !== undefined && !(TURN_INTENTS as readonly unknown[]).includes(body.intent)) {
    return { ok: false, message: `intent must be one of: ${TURN_INTENTS.join(', ')}.` };
  }
  const intent = (body.intent as TurnIntent | undefined) ?? null;
  // A findings proposal has a question of its own, written by the server: the browser's text is not used.
  const text = intent !== null ? FINDINGS_REQUEST_TEXT : typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length === 0 || text.length > TURN_TEXT_MAX_CHARS) {
    return { ok: false, message: `The question must be 1 to ${TURN_TEXT_MAX_CHARS.toLocaleString('en')} characters.` };
  }
  if (typeof body.clientTurnId !== 'string' || !UUID.test(body.clientTurnId)) {
    return { ok: false, message: 'clientTurnId must be a UUID.' };
  }
  const timeZone = resolveTimeZone(body.tz);
  if (timeZone === null) return { ok: false, message: 'tz must be an IANA time zone, such as Europe/Paris.' };
  return { ok: true, text, clientTurnId: body.clientTurnId.toLowerCase(), timeZone, intent };
}

export async function postTurn(request: Request, room: string, deps: ApiDeps): Promise<Response> {
  const correlationId = deps.newId();
  // The room is the raw path segment, not yet checked: quoted, so a line break in it cannot forge a log line.
  const where = `POST /api/rooms/${JSON.stringify(room)}/turns`;
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

    if (input.intent !== null) {
      if (resolved.kind === 'team') {
        return apiError('invalid_request', correlationId, { message: 'Findings are proposed in an agent’s own room, so each finding has one drafting agent.' });
      }
      const room = deps.runtime().store.getDataRoom(deps.runtime().workspaceId);
      if (room === null) return apiError('no_data_room', correlationId);
      if (documentsForTurn(room).shown.length === 0) {
        return apiError('invalid_request', correlationId, { message: 'The data room has no document that can be shown to the agent, so there is nothing to propose findings from.' });
      }
    }

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
        : oneToOneExecutor(resolved.agent.id, agentDeps, input.intent === null ? {} : { intent: input.intent });
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
        getAgent: deps.registry.getAgent,
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
      case 'server_busy':
        deps.log.warn(`[api] ${where} refused (correlation ${correlationId}): ${outcome.running} turn(s) already run on this server, the limit is ${outcome.limit}`);
        return apiError('server_busy', correlationId);
      case 'other_room':
        return apiError('invalid_request', correlationId, { message: 'This clientTurnId was already used in another room.' });
    }
  } catch (error) {
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
