import 'server-only';
import type { SpecIssue } from '@/shared/contracts';

/**
 * Thrown when the specs cannot be used. Lists every issue, not just the first. The issues
 * may be shown on a page, so they never hold a local path; `logDetail` (for example the
 * folder's full path) goes into the error message only, which stays in the server log.
 */
export class AgentSpecError extends Error {
  readonly issues: SpecIssue[];

  constructor(issues: SpecIssue[], options: { logDetail?: string } = {}) {
    const listed = issues.map((issue) => `- ${issue.source}: ${issue.message}`).join('\n');
    super(`agent specs are invalid:\n${listed}${options.logDetail ? `\n(${options.logDetail})` : ''}`);
    this.name = 'AgentSpecError';
    this.issues = issues;
  }
}
