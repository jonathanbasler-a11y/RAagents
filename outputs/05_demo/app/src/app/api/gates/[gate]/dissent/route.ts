import { apiDeps } from '@/app/api/_lib/deps';
import { postGateDissent } from '@/app/api/_lib/gates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ gate: string }>;
}

/** A person records a disagreement under a decision. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { gate } = await context.params;
  return postGateDissent(request, apiDeps(), gate);
}
