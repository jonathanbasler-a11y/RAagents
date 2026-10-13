import { apiDeps } from '@/app/api/_lib/deps';
import { getSelection, postSelection } from '@/app/api/_lib/selection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Selected for this DD": the effective selection of the workspace. */
export function GET(): Response {
  return getSelection(apiDeps());
}

/** Flips one switch; answers with the whole new selection. */
export async function POST(request: Request): Promise<Response> {
  return postSelection(request, apiDeps());
}
