import { apiDeps } from '@/app/api/_lib/deps';
import { getBriefing } from '@/app/api/_lib/briefing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The briefing, built from the register, the tags and the checklist. JSON, or a Markdown download with ?format=markdown. */
export function GET(request: Request): Response {
  return getBriefing(request, apiDeps());
}
