import 'server-only';
import type { ApiErrorBody, ApiErrorCode } from '@/shared/contracts';

// Shared response helpers for the API. Client errors are generic and carry a correlation
// id; the details stay in the server log under that id (BUILD-LEARNINGS Part 3).

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  room_busy: 409,
  locked_agent: 409,
  llm_not_configured: 503,
  internal: 500,
};

const MESSAGE: Record<ApiErrorCode, string> = {
  invalid_request: 'The request is not valid.',
  forbidden: 'This request is not allowed.',
  not_found: 'There is no such room or agent.',
  room_busy: 'Another turn is running in this room.',
  locked_agent: 'Team roles are always on; their switch cannot be turned off.',
  llm_not_configured: 'The model connection is not set up, so nothing was sent.',
  internal: 'Something went wrong on the server. The server log has the details under this correlation id.',
};

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** A non-2xx JSON response with the generic text for its code (or a safe, specific message). */
export function apiError(code: ApiErrorCode, correlationId: string, extra: { message?: string; runningTurnId?: string } = {}): Response {
  const body: ApiErrorBody = {
    error: code,
    message: extra.message ?? MESSAGE[code],
    correlationId,
    ...(extra.runningTurnId === undefined ? {} : { runningTurnId: extra.runningTurnId }),
  };
  return json(body, STATUS[code]);
}

/** Server-log text for an error: its name and message, plus the spec issues of an AgentSpecError. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const issues = (error as Error & { issues?: unknown }).issues;
  const listed = Array.isArray(issues)
    ? issues
        .map((issue) => (typeof issue === 'object' && issue !== null ? `${(issue as { source?: unknown }).source}: ${(issue as { message?: unknown }).message}` : String(issue)))
        .join('; ')
    : '';
  return `${error.name}: ${error.message}${listed && !error.message.includes(listed) ? ` (${listed})` : ''}`;
}

export function logFailure(log: Pick<Console, 'error'>, where: string, correlationId: string, error: unknown): void {
  log.error(`[api] ${where} failed (correlation ${correlationId}): ${describeFailure(error)}`);
}
