import 'server-only';
import type { DataRoom, DataRoomDocument, DataRoomTrace } from '@/shared/contracts';
import { SOURCE_TYPE_LABELS, compareDocumentIds, dataRoomTrace, documentsForTurn } from '@/shared/data-room';
import type { UntrustedBlock } from './fence';

// What a data room adds to an agent's prompt: an index of the whole room and one fenced block per document,
// plus turn instructions written by code. They lift one rule for these documents only and name what stays
// (BUILD-LEARNINGS Part 5: an exemption names the rule it lifts); a rare-situation rule belongs on the turn,
// never in a persona or the shared rules. A workspace with no data room adds nothing, so its prompts are
// exactly what they were before data rooms existed.

/** The turn instructions that go with the documents. */
export const DATA_ROOM_INSTRUCTIONS: readonly string[] = [
  "The fenced blocks under Room context are the documents of this DD's data room, provided by the app, with an index of the whole room first. Using them is expected: the person put them there for you to work from.",
  'For this turn only, this lifts the statement in your brief and in the shared rules that no documents are connected, for these documents and nothing else. You still have no tools: you cannot search, browse, open other files or save anything.',
  'Cite the document id (for example DR-03) for every fact about the asset, company, site or study that comes from a document. A company disclosure shows what its author claims, so write "the licensor states" rather than stating it as fact. When a company statement and an agency record differ, show both side by side and do not pick one.',
  'The index lists every document in the room: provided, listed but not provided, and any that did not fit. For anything that a missing or unlisted document would cover, say it was "not found in the data room"; never describe what it probably contains, and never say it does not exist. For a document the index marks as not shown, say you could not read it.',
  'Keep fact (what a document says), inference (what you conclude) and recommendation apart, and leave the decisions reserved for people to them.',
];

export interface DataRoomMaterial {
  /** The index, then the shown documents. Fenced by the prompt builder. */
  roomContext: UntrustedBlock[];
  instructions: string[];
  /** What the agents saw; null for a workspace with no data room. */
  trace: DataRoomTrace | null;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

function documentLabel(document: DataRoomDocument): string {
  const kind = SOURCE_TYPE_LABELS[document.sourceType];
  const parts = [document.origin === 'practice-pack' ? `fictional practice document, ${kind}` : kind, `dated ${document.publishedAt ?? 'unknown'}`];
  if (document.url !== null) parts.push(`from ${document.url}`);
  return `Data room document ${document.id}: ${oneLine(document.title)} (${parts.join(', ')})`;
}

/**
 * The data room as agents see it in one turn. A withdrawn document, and one dated after the as-of date, are
 * left out of the index and the blocks as if they were not there; the trace keeps the id and the reason.
 */
export function dataRoomMaterial(room: DataRoom | null): DataRoomMaterial {
  if (room === null) return { roomContext: [], instructions: [], trace: null };

  const turn = documentsForTurn(room);
  const shownIds = new Set(turn.shown.map((document) => document.id));
  const hidden = new Set(turn.notShown.filter((entry) => entry.reason === 'withdrawn' || entry.reason === 'after_as_of').map((entry) => entry.id));

  const listed = room.documents.filter((document) => !hidden.has(document.id));
  const lines = [`Data room as of ${room.asOf}. A document dated after this date is never shown.`];
  if (listed.length === 0) {
    lines.push('The data room has no documents.');
  } else {
    lines.push('Id | Title | Source | Dated | State');
    for (const document of [...listed].sort(compareDocumentIds)) {
      const title = oneLine(document.title);
      if (!document.provided) {
        lines.push(`${document.id} | ${title} | listed, not provided`);
        continue;
      }
      const state = shownIds.has(document.id) ? 'shown' : 'provided but not shown: it did not fit';
      lines.push(`${document.id} | ${title} | ${SOURCE_TYPE_LABELS[document.sourceType]} | dated ${document.publishedAt} | ${state}`);
    }
  }

  return {
    roomContext: [
      { label: 'Data room index, written by the app', text: lines.join('\n') },
      ...turn.shown.map((document) => ({ label: documentLabel(document), text: document.text ?? '' })),
    ],
    instructions: [...DATA_ROOM_INSTRUCTIONS],
    trace: dataRoomTrace(turn),
  };
}
