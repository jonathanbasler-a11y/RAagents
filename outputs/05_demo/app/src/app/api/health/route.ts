import { apiDeps } from '@/app/api/_lib/deps';
import { getHealth } from '@/app/api/_lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The app's status: database, agent specs and model routes, as names and states only. */
export function GET(): Response {
  return getHealth(apiDeps());
}
