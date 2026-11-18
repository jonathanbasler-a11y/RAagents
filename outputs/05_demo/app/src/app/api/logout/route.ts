import { accountDeps } from '../_lib/account-deps';
import { postLogout } from '../_lib/sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign-out for a hosted copy: ends this browser's session and shows the login page. */
export function POST(request: Request): Promise<Response> {
  return postLogout(request, accountDeps());
}
