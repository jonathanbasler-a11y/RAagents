import { apiDeps } from '@/app/api/_lib/deps';
import { postGateDecision } from '@/app/api/_lib/gates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ gate: string }>;
}

/** A person decides at a gate. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { gate } = await context.params;
  return postGateDecision(request, apiDeps(), gate);
}
