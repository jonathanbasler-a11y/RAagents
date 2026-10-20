import { apiDeps } from '@/app/api/_lib/deps';
import { postChecklistState } from '@/app/api/_lib/checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ item: string }>;
}

/** A person moves one checklist item to one of the four states. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { item } = await context.params;
  return postChecklistState(request, apiDeps(), item);
}
