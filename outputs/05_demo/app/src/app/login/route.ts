import { accountDeps } from '../api/_lib/account-deps';
import { getLoginPage } from '../api/_lib/sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The login page of a hosted copy. A route, not a page, on purpose: the root layout mounts the app shell, whose providers
// load workspace data, and none of that may run before sign-in. Plain HTML (src/app/api/_lib/account-pages.ts).
export function GET(request: Request): Response {
  return getLoginPage(request, accountDeps());
}
