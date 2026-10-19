import { redirect } from 'next/navigation';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

/** "/workspace": the old illustrative page. The workspace is now the landing page, so this sends everyone there. */
export default function WorkspacePage(): never {
  redirect('/');
}
