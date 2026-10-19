import { apiDeps } from '@/app/api/_lib/deps';
import { getFindings } from '@/app/api/_lib/findings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The findings register: the findings and the open questions of the workspace. */
export function GET(): Response {
  return getFindings(apiDeps());
}
