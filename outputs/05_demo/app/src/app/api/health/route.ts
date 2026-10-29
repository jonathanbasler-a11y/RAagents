import { accountDeps } from '@/app/api/_lib/account-deps';
import { sessionTokenFrom } from '@/app/api/_lib/account-http';
import { apiDeps } from '@/app/api/_lib/deps';
import { getHealth, statusOnly } from '@/app/api/_lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The app's status: database, agent specs and model routes, as names and states only. On a copy with sign-in this route
 * stays open for the load balancer, so a caller without a session gets only the overall status: the full report names
 * missing settings, the demo mode and when the server started.
 */
export async function GET(request: Request): Promise<Response> {
  const report = getHealth(apiDeps());
  const accounts = accountDeps();
  if (accounts.setting().state === 'off') return report;
  const token = sessionTokenFrom(request);
  let signedIn = false;
  try {
    signedIn = token !== null && accounts.store().findSession(token) !== null;
  } catch {
    signedIn = false;
  }
  return signedIn ? report : statusOnly(report);
}
