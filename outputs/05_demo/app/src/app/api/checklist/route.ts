import { apiDeps } from '@/app/api/_lib/deps';
import { getChecklist } from '@/app/api/_lib/checklist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The regulatory checklist: every item, its state, and how many accepted findings back it. */
export function GET(): Response {
  return getChecklist(apiDeps());
}
