import 'server-only';
import type { RememberedRefusal } from '@/server/llm';
import { LLM_ROUTES, type HealthCheckState, type HealthReport, type LlmRouteName, type LlmSetupStatus } from '@/shared/contracts';
import type { ApiDeps } from './deps';
import { describeFailure, json } from './http';

// GET /api/health: what the status panel shows. Names and states only: never a key, a
// host or a model id. Always answers 200 with a report, so the page can show what failed.
// A configured route that the gateway refused (key or model) is not usable: the model
// client remembers the refusal and fails every later call at once until a restart, so the
// report says so, and the setup banner and the disabled composer follow from it.

function refusalMessage(refusal: RememberedRefusal): string {
  const fix =
    refusal.kind === 'auth'
      ? 'The model gateway refused the key. Fix LLM_API_KEY (and LLM_API_KEY_HEADER if your gateway expects another header)'
      : refusal.kind === 'model'
        ? 'The model gateway does not allow the configured model for this key. Fix LLM_MODEL'
        : `The model gateway refused the connection (${refusal.kind}). Fix the LLM_* settings`;
  return `${fix}, then restart the server. Reference ${refusal.correlationId}.`;
}

export interface HealthRouteState {
  configured: boolean;
  /** Variable names that are missing or hold a placeholder. */
  missing: string[];
}

export type HealthResponseBody = HealthReport & {
  /** Problems the agent registry reported (0 when the roster loads). */
  agentIssueCount: number;
  /** Each model route: configured or not, and which variables are missing. */
  llmRoutes: Record<LlmRouteName, HealthRouteState>;
};

function processStartedAt(): string {
  return new Date(Math.round(Date.now() - process.uptime() * 1000)).toISOString();
}

export function getHealth(deps: ApiDeps): Response {
  let database: HealthCheckState = 'ok';
  let startedAt = processStartedAt();
  try {
    const runtime = deps.runtime();
    runtime.store.getTurn('health-check'); // a read: proves the database answers
    startedAt = runtime.startedAt;
  } catch (error) {
    database = 'error';
    deps.log.error(`[health] the chat database check failed: ${describeFailure(error)}`);
  }

  let agents: HealthCheckState = 'ok';
  let agentCount = 0;
  let agentIssueCount = 0;
  try {
    agentCount = deps.registry.listAgents().length;
  } catch (error) {
    agents = 'error';
    const issues = (error as { issues?: unknown }).issues;
    agentIssueCount = Array.isArray(issues) ? issues.length : 1;
    deps.log.error(`[health] the agent registry check failed: ${describeFailure(error)}`);
  }

  const llmRoutes = {} as Record<LlmRouteName, HealthRouteState>;
  for (const route of LLM_ROUTES) {
    const result = deps.llmConfig(route);
    llmRoutes[route] = result.ok ? { configured: true, missing: [] } : { configured: false, missing: [...result.error.missing] };
  }
  const agentsRoute = deps.llmConfig('agents');
  const refusal = agentsRoute.ok ? deps.llmRefusal(agentsRoute.config) : null;
  let llm: HealthCheckState;
  let setup: LlmSetupStatus;
  if (!agentsRoute.ok) {
    llm = 'not_configured';
    setup = { configured: false, missing: [...agentsRoute.error.missing], message: agentsRoute.error.message };
  } else if (refusal !== null) {
    llm = 'error';
    setup = { configured: false, missing: [], message: refusalMessage(refusal) };
  } else {
    llm = 'ok';
    setup = { configured: true, missing: [], message: null };
  }

  const body: HealthResponseBody = {
    status: database === 'error' || agents === 'error' ? 'error' : llm === 'ok' ? 'ok' : 'degraded',
    checks: { database, agents, llm },
    agentCount,
    agentIssueCount,
    llm: setup,
    llmRoutes,
    startedAt,
  };
  return json(body);
}
