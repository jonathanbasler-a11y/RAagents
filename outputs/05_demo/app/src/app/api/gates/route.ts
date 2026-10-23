import { apiDeps } from '@/app/api/_lib/deps';
import { getGates } from '@/app/api/_lib/gates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The three gates: the facts, the recommended call, every decision and every dissent. */
export function GET(): Response {
  return getGates(apiDeps());
}
