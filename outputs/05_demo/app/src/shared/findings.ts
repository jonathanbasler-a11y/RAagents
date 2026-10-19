import {
  FINDING_CONFIDENCE_LEVELS,
  type CheckedFinding,
  type DocumentSourceType,
  type FindingBasis,
  type FindingConfidence,
  type ProposalRefusalCode,
  type RefusedClaim,
} from './contracts';

export type { CheckedFinding, RefusedClaim } from './contracts';

// The findings rules. Pure and free of server imports, so the API, the store and the tests use the same code.
// "No source, no finding": a claim becomes a finding only with a quote that is really in a document the agent was
// shown in that turn, dated on or before the as-of date and not withdrawn. Anything else becomes an open question
// with the reason. The agent never sets the basis, the status or the owner.

export const MAX_CLAIM_CHARS = 600;
export const MIN_QUOTE_CHARS = 15;
export const MAX_QUOTE_CHARS = 600;
export const MAX_CONFIDENCE_REASON_CHARS = 300;
export const MAX_ASSUMPTIONS = 5;
export const MAX_ASSUMPTION_CHARS = 200;
/** The most claims one proposal turn may put forward; the rest are refused as too many. */
/** The question a findings proposal turn records. The server writes it; the button shows it. The browser's own text is not used. */
export const FINDINGS_REQUEST_TEXT = 'Propose findings from your last answer, in the findings format.';

export const MAX_PROPOSED_PER_TURN = 8;
const MAX_REFUSAL_MESSAGE_CHARS = 300;

/** A company disclosure is what the seller states; everything else is a primary record. */
export function basisOf(sourceType: DocumentSourceType): FindingBasis {
  return sourceType === 'company-disclosure' ? 'attributed' : 'primary-record';
}

/**
 * Makes two spellings of the same words equal: accents in one form, curly quotes and apostrophes straight, dashes
 * and minus signs a hyphen, every run of spaces and line breaks one space. Case and words are left alone.
 */
export function foldForMatch(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the quote is in any of the texts (the original and the one the model was shown), up to `foldForMatch`. */
export function quoteIsInDocument(quote: string, texts: readonly string[]): boolean {
  const wanted = foldForMatch(quote);
  if (wanted === '') return false;
  return texts.some((text) => foldForMatch(text).includes(wanted));
}

export type ProposalParse = { ok: true; findings: unknown[]; unsupported: unknown[] } | { ok: false; message: string };

const SHAPE = 'The reply must carry JSON like {"findings": [...], "unsupported": [...]}.';

function shapeOf(value: unknown): ProposalParse | null {
  if (Array.isArray(value)) return { ok: true, findings: value, unsupported: [] };
  if (typeof value !== 'object' || value === null) return null;
  const { findings, unsupported } = value as { findings?: unknown; unsupported?: unknown };
  if (!Array.isArray(findings)) return { ok: false, message: `${SHAPE} The "findings" entry is missing or is not a list.` };
  if (unsupported !== undefined && !Array.isArray(unsupported)) return { ok: false, message: `${SHAPE} The "unsupported" entry is not a list.` };
  return { ok: true, findings, unsupported: unsupported ?? [] };
}

/**
 * Finds the JSON in an agent's reply: a fenced block, the whole reply, or the outermost braces or brackets. The
 * first candidate that parses and has the shape wins. A reply with no such JSON proposes nothing.
 */
export function parseProposalReply(reply: string): ProposalParse {
  const candidates: string[] = [];
  for (const match of reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
  candidates.push(reply.trim());
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = reply.indexOf(open);
    const end = reply.lastIndexOf(close);
    if (start >= 0 && end > start) candidates.push(reply.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    // JSON that parses as an object or a list is the proposal, well-formed or not: a fragment inside a bad one is not.
    const shaped = shapeOf(value);
    if (shaped !== null) return shaped;
  }
  return { ok: false, message: `${SHAPE} No JSON with a "findings" list was found.` };
}

/** What the checker needs to know about a document of the room. */
export interface DocumentFacts {
  sourceType: DocumentSourceType;
  title: string;
  publishedAt: string | null;
  withdrawn: boolean;
  /** The texts a quote may be found in: the original, and the one the model was shown. */
  texts: readonly string[];
}

export interface ProposalContext {
  /** The data room's as-of date. */
  asOf: string;
  documents: ReadonlyMap<string, DocumentFacts>;
  /** The documents the agent was actually shown in the turn (the turn's trace). */
  shownIds: ReadonlySet<string>;
}

export type FindingCheck = { ok: true; finding: CheckedFinding } | { ok: false; code: ProposalRefusalCode; message: string };

const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function stripQuoteMarks(quote: string): string {
  return quote.trim().replace(/^["“”„]+/, '').replace(/["“”„]+$/, '').trim();
}

/** Checks one proposed claim against the room and the turn. Unknown fields are ignored. */
export function checkProposedFinding(raw: unknown, context: ProposalContext): FindingCheck {
  const refuse = (code: ProposalRefusalCode, message: string): FindingCheck => ({ ok: false, code, message });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return refuse('not_an_object', 'A proposed finding must be an object with a claim, a document and a quote.');
  const input = raw as Record<string, unknown>;

  if (!nonEmptyText(input.claim)) return refuse('claim_missing', 'The claim is missing.');
  const claim = input.claim.trim();
  if (claim.length > MAX_CLAIM_CHARS) return refuse('claim_too_long', `The claim is longer than ${MAX_CLAIM_CHARS} characters.`);

  if (!nonEmptyText(input.documentId)) return refuse('document_missing', 'No document is named. A finding needs the id of the document that shows it.');
  const documentId = input.documentId.trim();
  const document = context.documents.get(documentId);
  if (document === undefined) return refuse('document_unknown', `${documentId} is not a document of the data room.`);
  if (document.withdrawn) return refuse('document_withdrawn', `${documentId} has been withdrawn from the data room.`);
  if (document.publishedAt === null || document.publishedAt > context.asOf) {
    return refuse('document_after_as_of', `${documentId} is not dated on or before the as-of date ${context.asOf}.`);
  }
  if (!context.shownIds.has(documentId)) return refuse('document_not_shown', `${documentId} was not shown to the agent in this turn, so it cannot support a finding.`);

  if (!nonEmptyText(input.quote)) return refuse('quote_missing', `No quote is given. A finding needs a verbatim quote from ${documentId}.`);
  const quote = stripQuoteMarks(input.quote);
  const folded = foldForMatch(quote);
  if (folded.length < MIN_QUOTE_CHARS) return refuse('quote_too_short', `The quote is shorter than ${MIN_QUOTE_CHARS} characters, too little to show anything.`);
  if (folded.length > MAX_QUOTE_CHARS) return refuse('quote_too_long', `The quote is longer than ${MAX_QUOTE_CHARS} characters. Quote the sentence that shows it.`);
  if (!quoteIsInDocument(quote, document.texts)) {
    return refuse('quote_not_in_document', `The quote is not in ${documentId}. A finding needs a verbatim quote from the document.`);
  }

  if (!(FINDING_CONFIDENCE_LEVELS as readonly unknown[]).includes(input.confidence)) {
    return refuse('confidence_invalid', `The confidence must be one of: ${FINDING_CONFIDENCE_LEVELS.join(', ')}.`);
  }
  if (!nonEmptyText(input.confidenceReason) || input.confidenceReason.trim().length > MAX_CONFIDENCE_REASON_CHARS) {
    return refuse('confidence_reason_missing', `The reason for the confidence is required: 1 to ${MAX_CONFIDENCE_REASON_CHARS} characters.`);
  }

  const assumptions = input.assumptions === undefined || input.assumptions === null ? [] : input.assumptions;
  if (
    !Array.isArray(assumptions) ||
    assumptions.length > MAX_ASSUMPTIONS ||
    !assumptions.every((item) => nonEmptyText(item) && item.trim().length <= MAX_ASSUMPTION_CHARS)
  ) {
    return refuse('assumptions_invalid', `The assumptions must be a list of at most ${MAX_ASSUMPTIONS} short sentences (up to ${MAX_ASSUMPTION_CHARS} characters each).`);
  }

  return {
    ok: true,
    finding: {
      claim,
      quote,
      documentId,
      documentTitle: document.title,
      sourceType: document.sourceType,
      basis: basisOf(document.sourceType),
      publishedAt: document.publishedAt,
      confidence: input.confidence as FindingConfidence,
      confidenceReason: input.confidenceReason.trim(),
      assumptions: (assumptions as string[]).map((item) => item.trim()),
    },
  };
}

export interface ProposalResult {
  checked: CheckedFinding[];
  refused: RefusedClaim[];
  /** Set when the reply held no proposal at all: nothing is stored. */
  parseError: string | null;
}

const claimOf = (raw: unknown): string => {
  const claim = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { claim?: unknown }).claim : undefined;
  return nonEmptyText(claim) ? claim.trim().slice(0, MAX_CLAIM_CHARS) : '(no claim given)';
};

const documentOf = (raw: unknown): string | null => {
  const id = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { documentId?: unknown }).documentId : undefined;
  return nonEmptyText(id) ? id.trim() : null;
};

/** Reads an agent's reply and sorts its claims into findings and refusals. The first eight claims count; the rest are too many. */
export function checkProposal(reply: string, context: ProposalContext): ProposalResult {
  const parsed = parseProposalReply(reply);
  if (!parsed.ok) return { checked: [], refused: [], parseError: parsed.message };

  const checked: CheckedFinding[] = [];
  const refused: RefusedClaim[] = [];
  parsed.findings.forEach((raw, index) => {
    if (index >= MAX_PROPOSED_PER_TURN) {
      refused.push({ claim: claimOf(raw), code: 'too_many', message: `Only the first ${MAX_PROPOSED_PER_TURN} claims of a turn are taken.`, documentId: documentOf(raw) });
      return;
    }
    const result = checkProposedFinding(raw, context);
    if (result.ok) checked.push(result.finding);
    else refused.push({ claim: claimOf(raw), code: result.code, message: result.message, documentId: documentOf(raw) });
  });

  for (const raw of parsed.unsupported) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const { claim, reason } = raw as { claim?: unknown; reason?: unknown };
    if (!nonEmptyText(claim)) continue;
    refused.push({
      claim: claim.trim().slice(0, MAX_CLAIM_CHARS),
      code: 'declared_unsupported',
      message: nonEmptyText(reason) ? reason.trim().slice(0, MAX_REFUSAL_MESSAGE_CHARS) : 'The agent could not support this from the documents.',
      documentId: null,
    });
  }
  return { checked, refused, parseError: null };
}
