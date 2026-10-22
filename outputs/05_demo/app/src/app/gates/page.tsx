import type { Metadata } from 'next';
import { GatesPanel } from '@/components/GatesPanel';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Gates' };

/** "/gates": the three points where a person decides. The gates are loaded by the app shell's provider. */
export default function GatesPage() {
  return <GatesPanel />;
}
