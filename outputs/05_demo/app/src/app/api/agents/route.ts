import { getAgents } from '@/app/api/_lib/agents';
import { apiDeps } from '@/app/api/_lib/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The browser-safe roster by order, plus the effective selection. */
export function GET(): Response {
  return getAgents(apiDeps());
}
