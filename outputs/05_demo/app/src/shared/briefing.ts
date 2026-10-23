import { CHECKLIST_ITEMS, CHECKLIST_STATE_WORDS } from './checklist';
import {
  CHECKLIST_ITEM_IDS,
  type Briefing,
  type BriefingFinding,
  type BriefingGate,
  type BriefingWarning,
  type ChecklistEntry,
  type ChecklistItemId,
  type DataRoomDocument,
  type Finding,
  type FindingTag,
  type GateView,
  type OpenQuestion,
} from './contracts';
import { SOURCE_TYPE_LABELS } from './data-room';
import { FINDING_BASIS_WORDS, FINDING_CONFIDENCE_WORDS } from './findings';
import { GATE_OPTION_LABELS } from './gates';

// The briefing: what the regulatory lead takes into the cross-functional discussion. It is NOT a decision. It lists what
// was checked, the accepted and tagged findings sorted as positives, risks and neutral, the open questions, and the
// inputs for the regulatory part of the probability of technical and regulatory success (PTRS). Pure and deterministic:
// built by code from the register, the tags and the checklist, with no model call, so nothing in it can be invented.
// Drafts, rejected findings and anything an agent wrote about the case as a whole are not in it.

export interface BriefingRoom {
  asOf: string;
  documents: Array<Pick<DataRoomDocument, 'id' | 'title' | 'sourceType' | 'publishedAt' | 'provided' | 'withdrawnAt'>>;
}

export interface BriefingInput {
  /** Null when the workspace has no data room. */
  dataRoom: BriefingRoom | null;
  findings: readonly Finding[];
  tags: readonly FindingTag[];
  openQuestions: readonly OpenQuestion[];
  /** Every checklist item, in order (Store.listChecklist). */
  checklist: readonly ChecklistEntry[];
  /** The gates as they stand (Store.listGates). The gates are built from a briefing, so the caller builds this one without them first. */
  gates?: readonly GateView[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id, 'en', { numeric: true });

export function buildBriefing(input: BriefingInput): Briefing {
  const withdrawn = new Set((input.dataRoom?.documents ?? []).filter((document) => document.withdrawnAt !== null).map((document) => document.id));
  const tagOf = new Map(input.tags.map((entry) => [entry.findingId, entry]));
  const accepted = input.findings.filter((entry) => entry.status === 'accepted').sort(byId);

  const shown = (entry: Finding): BriefingFinding => {
    const tag = tagOf.get(entry.id);
    return {
      id: entry.id,
      claim: entry.claim,
      quote: entry.quote,
      documentId: entry.documentId,
      documentTitle: entry.documentTitle,
      sourceType: entry.sourceType,
      basis: entry.basis,
      publishedAt: entry.publishedAt,
      confidence: entry.confidence,
      checklistItem: tag?.checklistItem ?? null,
      category: tag?.category ?? null,
      documentWithdrawn: withdrawn.has(entry.documentId),
      decisionNote: entry.decisionNote,
    };
  };

  const sorted = accepted.map(shown);
  const tagged = sorted.filter((entry) => entry.category !== null);
  const unsorted = sorted.filter((entry) => entry.category === null);
  const drafts = input.findings.filter((entry) => entry.status === 'draft').length;
  const rejected = input.findings.filter((entry) => entry.status === 'rejected').length;

  const rows = CHECKLIST_ITEM_IDS.map((item) => {
    const entry = input.checklist.find((candidate) => candidate.item === item);
    return {
      item,
      label: CHECKLIST_ITEMS[item].label,
      hint: CHECKLIST_ITEMS[item].hint,
      state: entry?.state ?? ('not_checked' as const),
      reason: entry?.reason ?? null,
      findingIds: tagged.filter((candidate) => candidate.checklistItem === item).map((candidate) => candidate.id),
    };
  });

  const warnings: BriefingWarning[] = [];
  if (input.dataRoom === null) {
    warnings.push({ code: 'no_data_room', message: 'There is no data room, so there are no findings to build a briefing from.' });
  }
  if (drafts > 0) {
    warnings.push({
      code: 'drafts_pending',
      message: `${plural(drafts, 'draft finding is', 'draft findings are')} not decided and ${drafts === 1 ? 'is' : 'are'} not in this briefing.`,
    });
  }
  if (unsorted.length > 0) {
    warnings.push({
      code: 'untagged_accepted',
      message: `${plural(unsorted.length, 'accepted finding has', 'accepted findings have')} no checklist item or kind, so ${unsorted.length === 1 ? 'it is' : 'they are'} listed under "Not yet sorted".`,
    });
  }
  const onWithdrawn = sorted.filter((entry) => entry.documentWithdrawn).map((entry) => entry.id);
  if (onWithdrawn.length > 0) {
    warnings.push({
      code: 'withdrawn_document',
      message: `Accepted ${onWithdrawn.length === 1 ? 'finding' : 'findings'} ${onWithdrawn.join(', ')} ${onWithdrawn.length === 1 ? 'rests' : 'rest'} on ${onWithdrawn.length === 1 ? 'a document' : 'documents'} withdrawn from the data room after ${onWithdrawn.length === 1 ? 'it was' : 'they were'} accepted.`,
    });
  }
  const checkedOnWithdrawn = rows.filter((row) => {
    if (row.state !== 'checked') return false;
    const behind = tagged.filter((entry) => entry.checklistItem === row.item);
    return behind.length > 0 && behind.every((entry) => entry.documentWithdrawn);
  });
  if (checkedOnWithdrawn.length > 0) {
    warnings.push({
      code: 'checked_on_withdrawn',
      message: `${checkedOnWithdrawn.map((row) => row.label).join(' and ')} ${checkedOnWithdrawn.length === 1 ? 'is' : 'are'} marked checked, but every accepted finding behind ${checkedOnWithdrawn.length === 1 ? 'it' : 'them'} rests on a document withdrawn since.`,
    });
  }
  const notChecked = rows.filter((row) => row.state === 'not_checked').length;
  if (notChecked > 0) {
    warnings.push({
      code: 'items_not_checked',
      message: `${notChecked} of ${rows.length} checklist ${notChecked === 1 ? 'item is' : 'items are'} not checked.`,
    });
  }
  const cannot = rows.filter((row) => row.state === 'could_not_check');
  if (cannot.length > 0) {
    warnings.push({
      code: 'items_could_not_check',
      message: `${plural(cannot.length, 'checklist item', 'checklist items')} could not be checked: ${cannot.map((row) => row.label).join(', ')}.`,
    });
  }

  const outdated = (input.gates ?? []).filter((gate) => gate.status === 'outdated');
  if (outdated.length > 0) {
    warnings.push({
      code: 'gate_outdated',
      message: `${outdated.length === 1 ? 'A gate was' : 'Gates were'} decided on facts that have changed since: ${outdated.map((gate) => gate.title).join(', ')}.`,
    });
  }

  return {
    asOf: input.dataRoom?.asOf ?? null,
    documents: (input.dataRoom?.documents ?? []).map((document) => ({
      id: document.id,
      title: document.title,
      sourceType: document.sourceType,
      publishedAt: document.publishedAt,
      provided: document.provided,
      withdrawn: document.withdrawnAt !== null,
    })),
    counts: { acceptedTagged: tagged.length, acceptedUntagged: unsorted.length, drafts, rejected, openQuestions: input.openQuestions.length },
    warnings,
    checklist: rows,
    positives: tagged.filter((entry) => entry.category === 'positive'),
    risks: tagged.filter((entry) => entry.category === 'risk'),
    neutral: tagged.filter((entry) => entry.category === 'neutral'),
    unsorted,
    ptrsInputs: tagged.filter((entry) => entry.checklistItem === 'ptrs-inputs'),
    openQuestions: [...input.openQuestions].sort(byId).map((question) => ({ id: question.id, claim: question.claim, reason: question.reason, documentId: question.documentId })),
    couldNotCheck: cannot.map((row) => ({ item: row.item, label: row.label, reason: row.reason ?? '' })),
    gateDecisions: (input.gates ?? []).map((gate) => {
      const latest = gate.decisions[0];
      return {
        gate: gate.id,
        title: gate.title,
        status: gate.status,
        latest:
          latest === undefined
            ? null
            : { id: latest.id, option: latest.option, recommended: latest.recommended, reason: latest.reason, actor: latest.actor, createdAt: latest.createdAt },
        dissents: (latest?.dissents ?? []).map((note) => ({ id: note.id, role: note.role, reason: note.reason })),
      };
    }),
  };
}

const NOT_A_DECISION =
  "This is a briefing, not a decision. Deal-breakers, the overall assessment and the recommendation are reserved for people. Each claim below was drafted by an agent and accepted by a person, and is shown beside the words of the document it rests on. A finding from the seller's own document is what the seller states, not verified fact.";

function findingBlock(entry: BriefingFinding): string[] {
  const heading = entry.checklistItem === null ? 'Not yet tagged' : CHECKLIST_ITEMS[entry.checklistItem as ChecklistItemId].label;
  const lines = [
    `### ${entry.id} · ${heading}`,
    '',
    entry.claim,
    '',
    `> ${entry.quote}`,
    '',
    `- Source: ${entry.documentId}, ${entry.documentTitle} (${SOURCE_TYPE_LABELS[entry.sourceType]}, dated ${entry.publishedAt}).`,
    `- Basis: ${FINDING_BASIS_WORDS[entry.basis]}. Confidence in the quote: ${FINDING_CONFIDENCE_WORDS[entry.confidence]}.`,
  ];
  if (entry.decisionNote) lines.push(`- Note from the person who accepted it: ${entry.decisionNote}`);
  if (entry.documentWithdrawn) lines.push('- Its document has been withdrawn from the data room since it was accepted.');
  lines.push('');
  return lines;
}

function section(title: string, findings: readonly BriefingFinding[]): string[] {
  return [`## ${title}`, '', ...(findings.length === 0 ? ['None accepted and tagged yet.', ''] : findings.flatMap(findingBlock))];
}

export const GATE_DECISIONS_NOTE = 'Gate decisions are about the due diligence process. They are not a view on the deal.';

/** What a gate says in the briefing, after its title: not decided, or who decided what, when and why. The page and the Markdown both use it. */
export function gateSentence(row: BriefingGate): string {
  const latest = row.latest;
  if (latest === null) return 'Not decided yet.';
  const followed = latest.option === latest.recommended ? 'the recommended call' : `not the recommended call (${GATE_OPTION_LABELS[latest.recommended]})`;
  const head = row.status === 'outdated' ? 'Decided on earlier facts' : 'Decided';
  const call = row.status === 'outdated' ? GATE_OPTION_LABELS[latest.option] : `${GATE_OPTION_LABELS[latest.option]}, ${followed}`;
  const reason = latest.reason === null ? '' : ` Reason: ${latest.reason}${latest.reason.endsWith('.') ? '' : '.'}`;
  const stale = row.status === 'outdated' ? ' The facts changed since; decide again.' : '';
  return `${head}: ${call}, on ${latest.createdAt.slice(0, 10)} by ${latest.actor}.${reason}${stale}`;
}

function gateLines(rows: readonly BriefingGate[]): string[] {
  const lines = ['## Gate decisions', '', GATE_DECISIONS_NOTE, ''];
  for (const row of rows) {
    lines.push(`- **${row.title}**: ${gateSentence(row)}`);
    for (const note of row.dissents) lines.push(`  - Dissent from ${note.role}: ${note.reason}`);
  }
  lines.push('');
  return lines;
}

/** The briefing as Markdown. `generatedAt` is passed in so the text is the same for the same register and the same time. */
export function briefingToMarkdown(briefing: Briefing, generatedAt: string): string {
  const lines: string[] = [
    '# Regulatory due diligence briefing',
    '',
    briefing.asOf === null
      ? `No data room · prepared ${generatedAt} from the findings register and the checklist.`
      : `Data room as of ${briefing.asOf} · prepared ${generatedAt} from the findings register and the checklist.`,
    '',
    `> ${NOT_A_DECISION}`,
    '',
    '## Before you read',
    '',
    ...(briefing.warnings.length === 0 ? ['No warnings.'] : briefing.warnings.map((warning) => `- ${warning.message}`)),
    '',
    ...(briefing.gateDecisions.length === 0 ? [] : gateLines(briefing.gateDecisions)),
    '## What was checked',
    '',
    ...briefing.checklist.map((row) => {
      const reason = row.reason === null ? '' : ` ${row.state === 'checked' ? 'Note' : 'Reason'}: ${row.reason}${row.reason.endsWith('.') ? '' : '.'}`;
      const behind = row.findingIds.length === 0 ? '' : ` Findings: ${row.findingIds.join(', ')}.`;
      return `- **${row.label}**: ${CHECKLIST_STATE_WORDS[row.state]}.${reason}${behind}`;
    }),
    '',
  ];
  if (briefing.documents.length > 0) {
    lines.push(
      `Documents in the data room: ${briefing.documents
        .map((document) => `${document.id} ${document.title} (${SOURCE_TYPE_LABELS[document.sourceType]}${document.provided ? '' : ', listed, not provided'}${document.withdrawn ? ', withdrawn' : ''})`)
        .join('; ')}.`,
      '',
    );
  }
  lines.push(...section('Positives', briefing.positives), ...section('Risks', briefing.risks), ...section('Neutral', briefing.neutral));
  if (briefing.unsorted.length > 0) lines.push('## Not yet sorted', '', 'Accepted, but nobody has said which checklist item they support or what kind they are.', '', ...briefing.unsorted.flatMap(findingBlock));

  const questions = [
    ...briefing.openQuestions.map((question) => `- ${question.id}: ${question.claim} Not a finding: ${question.reason}`),
    ...briefing.couldNotCheck.map((entry) => `- Could not check: ${entry.label}. ${entry.reason}`),
  ];
  lines.push('## Open questions', '', ...(questions.length === 0 ? ['None.'] : questions), '');

  const ptrs = briefing.checklist.find((row) => row.item === 'ptrs-inputs');
  lines.push(
    '## Inputs to the regulatory part of PTRS',
    '',
    'The app computes no number. These are the accepted findings tagged to this item; check that the right information feeds the calculation.',
    '',
    `State of this item: ${CHECKLIST_STATE_WORDS[ptrs?.state ?? 'not_checked']}.`,
    '',
    ...(briefing.ptrsInputs.length === 0 ? ['No accepted finding is tagged to this item yet.'] : briefing.ptrsInputs.map((entry) => `- ${entry.id}: ${entry.claim} (${entry.documentId})`)),
    '',
    '## Possible mitigations',
    '',
    'For the regulatory lead and the functions to add. The app does not draft mitigations.',
    '',
  );
  return lines.join('\n');
}
