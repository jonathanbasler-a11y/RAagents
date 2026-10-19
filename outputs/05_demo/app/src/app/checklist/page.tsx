import type { Metadata } from 'next';
import { ChecklistPanel } from '@/components/ChecklistPanel';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Checklist' };

/** "/checklist": the regulatory checklist and its four states. The checklist is loaded by the app shell's provider. */
export default function ChecklistPage() {
  return <ChecklistPanel />;
}
