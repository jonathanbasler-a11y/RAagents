import { apiDeps } from '@/app/api/_lib/deps';
import { postFindingTag } from '@/app/api/_lib/findings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

/** A person tags a finding they accepted without a tag: which checklist item it supports, and what kind of finding it is. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return postFindingTag(request, apiDeps(), id);
}
