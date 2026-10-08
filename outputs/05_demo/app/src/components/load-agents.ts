import 'server-only';
import type { PublicAgent, SpecIssue } from '@/shared/contracts';
// The one server import the pages may use: the browser-safe view of the roster.
import { listPublicAgents } from '@/server/agents';

export type AgentsLoad =
  | { ok: true; agents: PublicAgent[] }
  /** Shown as a setup message instead of the page. Never contains paths or stack traces. */
  | { ok: false; title: string; detail: string; issues: string[] };

const MAX_ISSUES = 20;

function specIssues(error: unknown): SpecIssue[] | null {
  if (!(error instanceof Error) || error.name !== 'AgentSpecError') return null;
  const issues = (error as Error & { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return null;
  return issues.filter(
    (issue): issue is SpecIssue =>
      typeof issue === 'object' && issue !== null && typeof issue.source === 'string' && typeof issue.message === 'string',
  );
}

/**
 * Loads the roster for a server component. Any registry failure becomes a clear setup
 * message: the spec issues the registry reported, or a generic line (details in the server log).
 */
export function loadPublicAgents(): AgentsLoad {
  let agents: PublicAgent[];
  try {
    agents = listPublicAgents();
  } catch (error) {
    console.error('[agents] the agent registry could not be loaded', error);
    const issues = specIssues(error);
    if (issues) {
      const lines = issues.slice(0, MAX_ISSUES).map((issue) => `${issue.source}: ${issue.message}`);
      if (issues.length > MAX_ISSUES) lines.push(`…and ${issues.length - MAX_ISSUES} more (see the server log).`);
      return {
        ok: false,
        title: 'The agent specs have problems',
        detail: 'The app checks every spec when it loads them, and refuses a roster with problems. Fix these, then reload:',
        issues: lines,
      };
    }
    return {
      ok: false,
      title: 'The agent roster could not be loaded',
      detail: 'The app could not read the agent specs. The server log has the details.',
      issues: [],
    };
  }
  if (agents.length === 0) {
    return {
      ok: false,
      title: 'No active agents',
      detail: 'No agent spec is active. Set "active: true" in at least one spec, then reload.',
      issues: [],
    };
  }
  return { ok: true, agents };
}
