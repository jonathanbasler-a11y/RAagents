import { accountDeps } from '../../_lib/account-deps';
import { postPassword } from '../../_lib/account-password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A person chooses their password (src/app/api/_lib/account-password.ts). */
export function POST(request: Request): Promise<Response> {
  return postPassword(request, accountDeps());
}
