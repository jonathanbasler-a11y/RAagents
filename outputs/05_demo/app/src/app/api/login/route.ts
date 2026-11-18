import { accountDeps } from '../_lib/account-deps';
import { postLogin } from '../_lib/sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign-in for a hosted copy (src/app/api/_lib/sign-in.ts). */
export function POST(request: Request): Promise<Response> {
  return postLogin(request, accountDeps());
}
