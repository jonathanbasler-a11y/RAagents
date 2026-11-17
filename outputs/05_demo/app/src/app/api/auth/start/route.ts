import { accountDeps } from '../../_lib/account-deps';
import { getCompanySignInStart } from '../../_lib/company-sign-in';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Company sign-in, first step: to the provider (src/app/api/_lib/company-sign-in.ts). */
export function GET(request: Request): Promise<Response> {
  return getCompanySignInStart(request, accountDeps());
}
