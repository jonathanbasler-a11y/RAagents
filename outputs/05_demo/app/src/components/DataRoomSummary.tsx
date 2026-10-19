'use client';

import Link from 'next/link';
import { planTurn } from '@/shared/data-room';
import { useDataRoom } from './DataRoomProvider';

/** A short card on the DD workspace page: is there a data room, and what do the agents see of it. */
export function DataRoomSummary() {
  const room = useDataRoom();
  if (room.status === 'unavailable') return null;

  let line: string;
  let link: string;
  if (room.dataRoom === undefined) {
    line = room.status === 'error' ? 'The data room could not be loaded.' : 'Loading the data room…';
    link = 'Open the data room';
  } else if (room.dataRoom === null) {
    line = 'No data room yet. The agents have no documents to work from.';
    link = 'Set up the data room';
  } else {
    const { asOf, documents } = room.dataRoom;
    const shown = planTurn(
      documents.map((document) => ({ id: document.id, provided: document.provided, publishedAt: document.publishedAt, withdrawn: document.withdrawnAt !== null, size: document.chars })),
      asOf,
      room.limits.turnChars,
    ).filter((entry) => entry.state === 'shown').length;
    line =
      documents.length === 0
        ? `The data room is empty (as of ${asOf}). Add the first document.`
        : `${documents.length} ${documents.length === 1 ? 'document' : 'documents'} as of ${asOf}: ${shown} shown to the agents, ${documents.length - shown} not shown.`;
    link = 'Open the data room';
  }

  return (
    <section className="sheet data-room-card" aria-labelledby="data-room-card-title">
      <div>
        <h2 id="data-room-card-title">Data room</h2>
        <p aria-busy={room.dataRoom === undefined && room.status === 'loading'}>{line}</p>
      </div>
      <Link className="btn" href="/data-room">
        {link}
      </Link>
    </section>
  );
}
