import type { Metadata } from 'next';
import { DataRoomPanel } from '@/components/DataRoomPanel';

// Rendered per request, like every page here.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Data room' };

/** "/data-room": the documents the agents work from. The data room itself is loaded by the app shell's provider. */
export default function DataRoomPage() {
  return <DataRoomPanel />;
}
