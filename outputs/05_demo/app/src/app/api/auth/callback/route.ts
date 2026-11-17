import { accountDeps } from '../../_lib/account-deps';
import { getCompanySignInCallback } from '../../_lib/company-sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Company sign-in, second step: back from the provider (src/app/api/_lib/company-sign-in.ts). */
export function GET(request: Request): Promise<Response> {
  return getCompanySignInCallback(request, accountDeps());
}
