import { accountDeps } from '@/app/api/_lib/account-deps';
import { sessionTokenFrom } from '@/app/api/_lib/account-http';
import { apiDeps } from '@/app/api/_lib/deps';
import { getHealth, statusOnly } from '@/app/api/_lib/health';
import { countedSession } from '@/server/access-gate';

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
  const setting = accounts.setting();
  if (setting.state === 'off') return report;
  const token = sessionTokenFrom(request);
  let signedIn = false;
  try {
    // The proxy's rule (access-gate.ts): a session that must still replace a one-time password reaches the password page only.
    const session = countedSession(setting, token === null ? null : accounts.store().findSession(token));
    signedIn = session !== null && !session.mustChangePassword;
  } catch {
    signedIn = false;
  }
  return signedIn ? report : statusOnly(report);
}
