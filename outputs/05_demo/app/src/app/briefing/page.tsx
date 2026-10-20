import type { Metadata } from 'next';
import { BriefingPanel } from '@/components/BriefingPanel';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Briefing' };

/** "/briefing": what the regulatory lead takes into the cross-functional discussion. Built fresh from the register each time. */
export default function BriefingPage() {
  return <BriefingPanel />;
}
