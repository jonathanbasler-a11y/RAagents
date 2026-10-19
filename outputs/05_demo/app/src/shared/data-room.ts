import {
  DOCUMENT_SOURCE_TYPES,
  type DataRoom,
  type DataRoomDocument,
  type DataRoomTrace,
  type DocumentOrigin,
  type DocumentSourceType,
  type NewDocument,
  type NotShownReason,
} from './contracts';

// The data room rules. Pure and free of server imports, so the API, the store, the prompt builder and the page
// use the same code. A document dated after the room's as-of date is refused when it is added and, as a second
// wall, never shown to an agent even if one got in.

export const MAX_DOCUMENT_CHARS = 12_000;
/** The most document text one turn puts in the prompt, across all documents. */
export const MAX_TURN_DOCUMENT_CHARS = 48_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_URL_CHARS = 500;
export const MAX_REASON_CHARS = 300;

export const DOCUMENT_ID_PATTERN = /^DR-\d{2,3}$/;

export const SOURCE_TYPE_LABELS: Record<DocumentSourceType, string> = {
  'company-disclosure': 'company disclosure',
  'agency-record': 'agency record',
  registry: 'registry entry',
  publication: 'publication',
};

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type AsOfCheck = { ok: true; asOf: string } | { ok: false; message: string };

export function checkAsOf(value: unknown): AsOfCheck {
  if (!isIsoDate(value)) return { ok: false, message: 'The as-of date must be a real date written YYYY-MM-DD.' };
  return { ok: true, asOf: value };
}

/** A document ready to store: every field settled, text normalised. `id` is left to the store when undefined. */
export interface NormalizedDocument {
  id: string | undefined;
  title: string;
  sourceType: DocumentSourceType;
  publishedAt: string | null;
  url: string | null;
  provided: boolean;
  text: string | null;
  origin: DocumentOrigin;
}

export type DocumentCheck = { ok: true; document: NormalizedDocument } | { ok: false; message: string };

function normaliseText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
}

function checkUrl(value: unknown): { ok: true; url: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') return { ok: true, url: null };
  const message = `The address must start with http:// or https://, hold no user name or password, and be at most ${MAX_URL_CHARS} characters.`;
  if (typeof value !== 'string') return { ok: false, message };
  const url = value.trim();
  if (url.length > MAX_URL_CHARS) return { ok: false, message };
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username !== '' || parsed.password !== '') return { ok: false, message };
  } catch {
    return { ok: false, message };
  }
  return { ok: true, url };
}

/**
 * Checks a document a person or a loader wants to put in the room dated at or before `asOf`, and returns it in its
 * normal form. Unknown keys are ignored. A provided document needs text and a date; a document that is only listed
 * (not provided) has neither text nor, necessarily, a date.
 */
export function checkNewDocument(value: unknown, asOf: string, origin: DocumentOrigin = 'added'): DocumentCheck {
  const refuse = (message: string): DocumentCheck => ({ ok: false, message });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse('A document must be an object.');
  const input = value as Partial<Record<keyof NewDocument, unknown>>;

  let id: string | undefined;
  if (input.id !== undefined && input.id !== null) {
    if (typeof input.id !== 'string' || !DOCUMENT_ID_PATTERN.test(input.id)) return refuse('The id must look like DR-07 (DR- and two or three digits).');
    id = input.id;
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '' || title.length > MAX_TITLE_CHARS || /[\r\n]/.test(title)) {
    return refuse(`The title is required: one line of at most ${MAX_TITLE_CHARS} characters.`);
  }

  if (!(DOCUMENT_SOURCE_TYPES as readonly unknown[]).includes(input.sourceType)) {
    return refuse(`The source type must be one of: ${DOCUMENT_SOURCE_TYPES.join(', ')}.`);
  }
  const sourceType = input.sourceType as DocumentSourceType;

  if (typeof input.provided !== 'boolean') return refuse('provided must be true or false.');
  const provided = input.provided;

  const url = checkUrl(input.url);
  if (!url.ok) return refuse(url.message);

  let publishedAt: string | null = null;
  if (input.publishedAt !== undefined && input.publishedAt !== null) {
    if (!isIsoDate(input.publishedAt)) return refuse('The date must be a real date written YYYY-MM-DD.');
    publishedAt = input.publishedAt;
  } else if (provided) {
    return refuse('A provided document needs its date, written YYYY-MM-DD.');
  }
  if (publishedAt !== null && publishedAt > asOf) {
    return refuse(`The document is dated ${publishedAt}, after the as-of date ${asOf}. A later source is never shown to the agents.`);
  }

  let text: string | null = null;
  if (provided) {
    if (typeof input.text !== 'string') return refuse('A provided document needs its text.');
    if (input.text.includes('\u0000')) return refuse('The text must not contain NUL characters.');
    text = normaliseText(input.text);
    if (text === '') return refuse('A provided document needs its text.');
    if (text.length > MAX_DOCUMENT_CHARS) return refuse(`The text is ${text.length} characters; the most one document may have is ${MAX_DOCUMENT_CHARS} characters.`);
  } else if (input.text !== undefined && input.text !== null && input.text !== '') {
    return refuse('A document that is marked not provided cannot have text.');
  }

  return { ok: true, document: { id, title, sourceType, publishedAt, url: url.url, provided, text, origin } };
}

/** The next free id: one past the highest DR number, so a number is never reused. DR-00 is left to an index document. */
export function nextDocumentId(existing: readonly string[]): string {
  let highest = 0;
  for (const id of existing) {
    if (DOCUMENT_ID_PATTERN.test(id)) highest = Math.max(highest, Number(id.slice(3)));
  }
  const next = highest + 1;
  if (next > 999) throw new RangeError('the data room has no free document id left (DR-999 is the last)');
  return `DR-${String(next).padStart(2, '0')}`;
}

const numberOf = (id: string): number => (DOCUMENT_ID_PATTERN.test(id) ? Number(id.slice(3)) : Number.MAX_SAFE_INTEGER);

/** Orders documents by their DR number, so DR-100 comes after DR-11. */
export const compareDocumentIds = (a: { id: string }, b: { id: string }): number => numberOf(a.id) - numberOf(b.id) || a.id.localeCompare(b.id);

/** What one turn puts in front of the agents, and what it leaves out and why. */
export interface TurnDocuments {
  asOf: string;
  /** In id order. */
  shown: DataRoomDocument[];
  /** In id order. */
  notShown: Array<{ id: string; reason: NotShownReason }>;
}

export type DocumentTurnState = 'shown' | NotShownReason;

/** What the plan needs to know about a document: no text, so a list on a page can use it too. */
export interface TurnPlanItem {
  id: string;
  provided: boolean;
  publishedAt: string | null;
  withdrawn: boolean;
  /** Characters of text. */
  size: number;
}

/**
 * What one turn does with each document, in numeric id order. The rule, in one place: a document is left out when it was
 * withdrawn, was never provided, is undated or dated after the as-of date, or does not fit the room left in the prompt
 * (`limit` characters in all; a later, smaller document may still fit after one that did not).
 */
export function planTurn(items: readonly TurnPlanItem[], asOf: string, limit: number = MAX_TURN_DOCUMENT_CHARS): Array<{ id: string; state: DocumentTurnState }> {
  let used = 0;
  return [...items].sort(compareDocumentIds).map((item) => {
    let state: DocumentTurnState;
    if (item.withdrawn) state = 'withdrawn';
    else if (!item.provided) state = 'not_provided';
    else if (item.publishedAt === null || item.publishedAt > asOf) state = 'after_as_of';
    else if (used + item.size > limit) state = 'too_large';
    else {
      used += item.size;
      state = 'shown';
    }
    return { id: item.id, state };
  });
}

/**
 * The documents a turn shows, in id order. A document is left out, and the reason kept, when it was withdrawn, was
 * never provided, is undated or dated after the as-of date, or does not fit the room left in the prompt (`limit`
 * characters of text in all; a later, smaller document may still fit after one that did not).
 */
export function documentsForTurn(room: DataRoom, limit: number = MAX_TURN_DOCUMENT_CHARS): TurnDocuments {
  const byId = new Map(room.documents.map((document) => [document.id, document]));
  const plan = planTurn(
    room.documents.map((document) => ({
      id: document.id,
      // A provided document with no text cannot be shown; the store never makes one, and this keeps the rule safe if one appears.
      provided: document.provided && document.text !== null,
      publishedAt: document.publishedAt,
      withdrawn: document.withdrawnAt !== null,
      size: document.text?.length ?? 0,
    })),
    room.asOf,
    limit,
  );
  const shown: DataRoomDocument[] = [];
  const notShown: TurnDocuments['notShown'] = [];
  for (const { id, state } of plan) {
    if (state === 'shown') shown.push(byId.get(id) as DataRoomDocument);
    else notShown.push({ id, reason: state });
  }
  return { asOf: room.asOf, shown, notShown };
}

/** The part of a turn's documents that goes in the turn's trace: ids and reasons, never text. */
export function dataRoomTrace(turn: TurnDocuments): DataRoomTrace {
  return { asOf: turn.asOf, shown: turn.shown.map((document) => document.id), notShown: turn.notShown.map((entry) => ({ ...entry })) };
}
