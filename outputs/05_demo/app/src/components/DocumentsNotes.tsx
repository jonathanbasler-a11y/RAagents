'use client';

import type { DemoMode } from '@/shared/contracts';
import { useDocumentsConnected } from './DataRoomProvider';
import { homeLedeText, phaseLineText } from './labels';

// The few sentences that say whether the agents can read documents. They follow the data room, so a page never
// says "no documents are connected" while it is not known, or after a data room was started.

/** The line in the header. */
export function PhaseLine({ mode }: { mode: DemoMode }) {
  const { documents, shown } = useDocumentsConnected();
  return <p className="doc-control">{phaseLineText(documents, mode, shown)}</p>;
}

/** The lede of the DD workspace page. */
export function HomeLede() {
  const { documents } = useDocumentsConnected();
  return <p className="lede">{homeLedeText(documents)}</p>;
}
