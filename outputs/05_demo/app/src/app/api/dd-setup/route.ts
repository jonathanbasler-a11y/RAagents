import { apiDeps } from '@/app/api/_lib/deps';
import { getDdSetup, postDdSetup } from '@/app/api/_lib/dd-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The DD setup of the workspace, with the selection it implies. */
export function GET(): Response {
  return getDdSetup(apiDeps());
}

/** Saves the whole setup; the selection follows from it in the same transaction. */
export async function POST(request: Request): Promise<Response> {
  return postDdSetup(request, apiDeps());
}
