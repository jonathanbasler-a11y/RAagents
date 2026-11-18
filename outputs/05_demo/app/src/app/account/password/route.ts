import { accountDeps } from '../../api/_lib/account-deps';
import { getPasswordPage } from '../../api/_lib/account-password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The password page of a hosted copy. A route, not a page, like /login: a person who must still replace a one-time
// password reaches nothing else, and the app shell's providers would call APIs the proxy refuses them.
export function GET(request: Request): Response {
  return getPasswordPage(request, accountDeps());
}
