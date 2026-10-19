import { apiDeps } from '@/app/api/_lib/deps';
import { postFindingDecision } from '@/app/api/_lib/findings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

/** A person accepts or rejects a draft finding, once. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return postFindingDecision(request, apiDeps(), id);
}
