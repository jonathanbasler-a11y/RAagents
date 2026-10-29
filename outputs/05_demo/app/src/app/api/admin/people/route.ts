import { accountDeps } from '@/app/api/_lib/account-deps';
import { getPeople, postPerson } from '@/app/api/_lib/admin-people';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The People page: everyone with an account (admin only). */
export function GET(request: Request): Response {
  return getPeople(request, accountDeps());
}

/** The admin creates a person; the answer carries their one-time password, once. */
export function POST(request: Request): Promise<Response> {
  return postPerson(request, accountDeps());
}
