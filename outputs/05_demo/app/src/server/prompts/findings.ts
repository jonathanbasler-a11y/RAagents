import 'server-only';
import type { DataRoom } from '@/shared/contracts';
import { FINDINGS_REQUEST_TEXT, MAX_PROPOSED_PER_TURN, MIN_QUOTE_CHARS, type ProposalContext } from '@/shared/findings';
import { neutraliseUntrusted } from './fence';

// What a findings proposal turn adds to the agent's prompt. It rides on the turn, gated on the person's request
// (a button in the agent's own room), never in the shared rules or a persona. The agent proposes; code checks every
// claim (src/shared/findings.ts); a person decides. Nothing here makes a claim a finding.

export { FINDINGS_REQUEST_TEXT };

export const PROPOSE_FINDINGS_INSTRUCTIONS: readonly string[] = [
  'This turn is a findings proposal. The person asked you to turn the points of your last answer into findings that can be checked against the documents of the data room. You decide nothing: code checks every claim, and a person accepts or rejects each finding.',
  `Write one sentence saying how many findings you propose, then one \`\`\`json block with exactly this shape and nothing after it: {"findings": [{"claim": "…", "documentId": "DR-03", "quote": "…", "confidence": "high", "confidenceReason": "…", "assumptions": ["…"]}], "unsupported": [{"claim": "…", "reason": "…"}]}.`,
  `A finding states what ONE document says. "documentId" is that document's id in the data room. "quote" is copied exactly, word for word, from that document: one contiguous sentence or table row of at least ${MIN_QUOTE_CHARS} characters that shows the claim. If your point compares two documents, propose one finding for each document and say in the claim how they differ. For a company disclosure, write the claim as what the author states ("the licensor states …"), never as a fact.`,
  `"confidence" is high, medium or low: how sure you are that the quote shows the claim, not how likely the claim is to be true. "confidenceReason" is one short sentence. "assumptions" lists what the claim takes for granted (an empty list if nothing).`,
  `Put at most ${MAX_PROPOSED_PER_TURN} findings. Anything in your last answer that no document supports, including every "not found in the data room" point, goes in "unsupported" with a short reason: it becomes an open question, not a finding. Inferences and recommendations are not findings; leave them out of "findings".`,
];

/**
 * What the checker needs to know about the room for one turn. `shownIds` are the documents the agents really saw in the
 * turn (its trace). A quote is looked for in the original text and in the text as the fence changed it, because the
 * model copies from what it was shown.
 */
export function proposalContextFor(room: DataRoom, shownIds: readonly string[]): ProposalContext {
  return {
    asOf: room.asOf,
    documents: new Map(
      room.documents.map((document) => [
        document.id,
        {
          sourceType: document.sourceType,
          title: document.title,
          publishedAt: document.publishedAt,
          withdrawn: document.withdrawnAt !== null,
          texts: document.text === null ? [] : [document.text, neutraliseUntrusted(document.text).trim()],
        },
      ]),
    ),
    shownIds: new Set(shownIds),
  };
}
