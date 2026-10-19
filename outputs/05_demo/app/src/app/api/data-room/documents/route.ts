import { apiDeps } from '@/app/api/_lib/deps';
import { postDocument } from '@/app/api/_lib/data-room';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Adds one document to the data room. */
export async function POST(request: Request): Promise<Response> {
  return postDocument(request, apiDeps());
}
