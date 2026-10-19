import type { Metadata } from 'next';
import { FindingsPanel } from '@/components/FindingsPanel';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Findings' };

/** "/findings": what the agents drafted from the data room, and what a person decided. The register is loaded by the app shell's provider. */
export default function FindingsPage() {
  return <FindingsPanel />;
}
