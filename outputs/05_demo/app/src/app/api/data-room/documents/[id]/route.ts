import { apiDeps } from '@/app/api/_lib/deps';
import { getDocument, postDocumentAction } from '@/app/api/_lib/data-room';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

/** One document with its text. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return getDocument(apiDeps(), id);
}

/** Withdraws the document ({ action: 'withdraw', reason }), the only change a document can have. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return postDocumentAction(request, apiDeps(), id);
}
