import { describe, expect, it } from 'vitest';
import type { DataRoom, DataRoomDocument } from './contracts';
import {
  MAX_DOCUMENT_CHARS,
  MAX_TURN_DOCUMENT_CHARS,
  checkAsOf,
  checkNewDocument,
  dataRoomTrace,
  documentsForTurn,
  isIsoDate,
  nextDocumentId,
  planTurn,
} from './data-room';

const AS_OF = '2026-10-12';

function doc(overrides: Partial<DataRoomDocument> & Pick<DataRoomDocument, 'id'>): DataRoomDocument {
  return {
    title: `Title of ${overrides.id}`,
    sourceType: 'company-disclosure',
    publishedAt: '2026-07-01',
    url: null,
    provided: true,
    origin: 'added',
    text: 'Some text.',
    addedAt: '2026-10-12T08:00:00.000Z',
    withdrawnAt: null,
    withdrawnReason: null,
    ...overrides,
  };
}

function room(documents: DataRoomDocument[], asOf = AS_OF): DataRoom {
  return { workspaceId: 'demo', asOf, createdAt: '2026-10-12T08:00:00.000Z', documents };
}

describe('isIsoDate', () => {
  it.each(['2026-10-12', '2024-02-29', '2000-01-01'])('accepts the real date %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-5', '2026-10-12T00:00:00Z', '12/10/2026', '', ' 2026-10-12', 20261012, null, undefined])(
    'refuses %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe('checkAsOf', () => {
  it('accepts a date and returns it', () => {
    expect(checkAsOf('2026-10-12')).toEqual({ ok: true, asOf: '2026-10-12' });
  });

  it('refuses anything else with a message that names the format', () => {
    const result = checkAsOf('12 October');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/YYYY-MM-DD/);
    expect(checkAsOf(undefined).ok).toBe(false);
  });
});

describe('checkNewDocument', () => {
  const good = { title: 'Licensor overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', url: null, provided: true, text: 'Overview.' };

  it('accepts a provided document and returns it in its normal form', () => {
    const result = checkNewDocument({ ...good, title: '  Licensor overview  ', text: 'Line one.\r\nLine two.\r\n', url: 'https://example.org/a' }, AS_OF);

    expect(result).toEqual({
      ok: true,
      document: {
        id: undefined,
        title: 'Licensor overview',
        sourceType: 'company-disclosure',
        publishedAt: '2026-07-14',
        url: 'https://example.org/a',
        provided: true,
        text: 'Line one.\nLine two.',
        origin: 'added',
      },
    });
  });

  it('keeps a given id and origin, and a missing url becomes null', () => {
    const withoutUrl = Object.fromEntries(Object.entries(good).filter(([key]) => key !== 'url'));
    const result = checkNewDocument({ ...withoutUrl, id: 'DR-07' }, AS_OF, 'practice-pack');

    expect(result.ok && result.document).toMatchObject({ id: 'DR-07', origin: 'practice-pack', url: null });
  });

  it('accepts a listed document that was not provided: no text and no date needed', () => {
    const result = checkNewDocument({ title: 'Paediatric study plan', sourceType: 'company-disclosure', provided: false, text: null, publishedAt: null }, AS_OF);

    expect(result).toMatchObject({ ok: true, document: { provided: false, text: null, publishedAt: null } });
  });

  it('ignores keys it does not know', () => {
    expect(checkNewDocument({ ...good, extra: 'x', addedAt: 'y' }, AS_OF).ok).toBe(true);
  });

  it.each([
    ['not an object', null, /object/],
    ['an array', [], /object/],
    ['no title', { ...good, title: undefined }, /title/],
    ['an empty title', { ...good, title: '   ' }, /title/],
    ['a title over two lines', { ...good, title: 'one\ntwo' }, /title/],
    ['a title over the limit', { ...good, title: 'x'.repeat(201) }, /title/],
    ['an unknown source type', { ...good, sourceType: 'rumour' }, /source type/],
    ['a provided flag that is not a boolean', { ...good, provided: 'yes' }, /provided/],
    ['a provided document with no text', { ...good, text: '   ' }, /text/],
    ['text that is not a string', { ...good, text: 5 }, /text/],
    ['text over the limit', { ...good, text: 'x'.repeat(MAX_DOCUMENT_CHARS + 1) }, /characters/],
    ['text with a NUL character', { ...good, text: 'a\u0000b' }, /text/],
    ['a provided document with no date', { ...good, publishedAt: null }, /date/],
    ['a date that does not exist', { ...good, publishedAt: '2026-02-30' }, /date/],
    ['a url that is not http or https', { ...good, url: 'file:///etc/passwd' }, /address/],
    ['a javascript url', { ...good, url: 'javascript:alert(1)' }, /address/],
    ['a url over the limit', { ...good, url: `https://example.org/${'a'.repeat(600)}` }, /address/],
    ['an id that does not fit DR-nn', { ...good, id: 'doc-7' }, /id/],
    ['text on a document that is not provided', { ...good, provided: false }, /not provided/],
  ])('refuses %s', (_label, value, message) => {
    const result = checkNewDocument(value, AS_OF);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(message);
  });

  it('refuses a document dated after the as-of date, and says so', () => {
    const result = checkNewDocument({ ...good, publishedAt: '2026-10-13' }, AS_OF);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/after the as-of date 2026-10-12/);
  });

  it('accepts a document dated on the as-of date (positive control for the wall above)', () => {
    expect(checkNewDocument({ ...good, publishedAt: AS_OF }, AS_OF).ok).toBe(true);
  });

  it('refuses a later date on a document that is not provided too', () => {
    const result = checkNewDocument({ title: 'Plan', sourceType: 'company-disclosure', provided: false, text: null, publishedAt: '2027-01-01' }, AS_OF);

    expect(result.ok).toBe(false);
  });

  it('counts the text after trimming and line-ending changes against the limit', () => {
    expect(checkNewDocument({ ...good, text: `${'x'.repeat(MAX_DOCUMENT_CHARS)}\r\n\r\n` }, AS_OF).ok).toBe(true);
  });
});

describe('nextDocumentId', () => {
  it('starts at DR-01', () => {
    expect(nextDocumentId([])).toBe('DR-01');
  });

  it('is one past the highest number, whatever the order', () => {
    expect(nextDocumentId(['DR-10', 'DR-00', 'DR-01'])).toBe('DR-11');
  });

  it('never reuses a number below the highest', () => {
    expect(nextDocumentId(['DR-03'])).toBe('DR-04');
  });

  it('grows to three digits and stops there', () => {
    expect(nextDocumentId(['DR-99'])).toBe('DR-100');
    expect(nextDocumentId(['DR-998'])).toBe('DR-999');
    expect(() => nextDocumentId(['DR-999'])).toThrow(RangeError);
  });

  it('ignores ids that do not fit the pattern', () => {
    expect(nextDocumentId(['other', 'DR-x', 'DR-02'])).toBe('DR-03');
  });
});

describe('documentsForTurn', () => {
  it('shows the provided documents in numeric id order', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-10' }), doc({ id: 'DR-02' }), doc({ id: 'DR-100' })]));

    expect(result.shown.map((entry) => entry.id)).toEqual(['DR-02', 'DR-10', 'DR-100']);
    expect(result.notShown).toEqual([]);
    expect(result.asOf).toBe(AS_OF);
  });

  it('keeps a document that is not provided out, and says why', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-01' }), doc({ id: 'DR-09', provided: false, text: null, publishedAt: null })]));

    expect(result.shown.map((entry) => entry.id)).toEqual(['DR-01']);
    expect(result.notShown).toEqual([{ id: 'DR-09', reason: 'not_provided' }]);
  });

  it('keeps a withdrawn document out, and says why', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-01', withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'wrong file' })]));

    expect(result.shown).toEqual([]);
    expect(result.notShown).toEqual([{ id: 'DR-01', reason: 'withdrawn' }]);
  });

  it('keeps a document dated after the as-of date out even if one got into the room', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-01', publishedAt: '2026-10-13' }), doc({ id: 'DR-02', publishedAt: AS_OF })]));

    expect(result.shown.map((entry) => entry.id)).toEqual(['DR-02']);
    expect(result.notShown).toEqual([{ id: 'DR-01', reason: 'after_as_of' }]);
  });

  it('keeps a provided document with no date out: an undated source cannot be placed before the as-of date', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-01', publishedAt: null })]));

    expect(result.shown).toEqual([]);
    expect(result.notShown).toEqual([{ id: 'DR-01', reason: 'after_as_of' }]);
  });

  it('a withdrawn document is reported as withdrawn even when it is also dated late or not provided', () => {
    const result = documentsForTurn(
      room([doc({ id: 'DR-01', publishedAt: '2030-01-01', withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'x' })]),
    );

    expect(result.notShown).toEqual([{ id: 'DR-01', reason: 'withdrawn' }]);
  });

  it('fills the room left in the prompt in id order, and reports what did not fit', () => {
    const result = documentsForTurn(
      room([doc({ id: 'DR-01', text: 'a'.repeat(60) }), doc({ id: 'DR-02', text: 'b'.repeat(60) }), doc({ id: 'DR-03', text: 'c'.repeat(30) })]),
      100,
    );

    expect(result.shown.map((entry) => entry.id)).toEqual(['DR-01', 'DR-03']);
    expect(result.notShown).toEqual([{ id: 'DR-02', reason: 'too_large' }]);
  });

  it('a document that exactly fills the room fits', () => {
    const result = documentsForTurn(room([doc({ id: 'DR-01', text: 'a'.repeat(100) })]), 100);

    expect(result.shown).toHaveLength(1);
  });

  it('uses the default room limit when none is given', () => {
    const big = Math.floor(MAX_TURN_DOCUMENT_CHARS / 2) + 1;
    const result = documentsForTurn(room([doc({ id: 'DR-01', text: 'a'.repeat(big) }), doc({ id: 'DR-02', text: 'b'.repeat(big) })]));

    expect(result.shown.map((entry) => entry.id)).toEqual(['DR-01']);
    expect(result.notShown).toEqual([{ id: 'DR-02', reason: 'too_large' }]);
  });

  it('lists the not-shown documents in id order too', () => {
    const result = documentsForTurn(
      room([doc({ id: 'DR-09', provided: false, text: null, publishedAt: null }), doc({ id: 'DR-03', withdrawnAt: '2026-10-12T09:00:00.000Z', withdrawnReason: 'x' })]),
    );

    expect(result.notShown.map((entry) => entry.id)).toEqual(['DR-03', 'DR-09']);
  });
});

describe('planTurn', () => {
  const item = (id: string, overrides: Partial<{ provided: boolean; publishedAt: string | null; withdrawn: boolean; size: number }> = {}) => ({
    id,
    provided: true,
    publishedAt: '2026-07-01',
    withdrawn: false,
    size: 10,
    ...overrides,
  });

  it('gives each document one state, in numeric id order', () => {
    const plan = planTurn(
      [
        item('DR-10'),
        item('DR-02', { withdrawn: true }),
        item('DR-03', { provided: false, publishedAt: null }),
        item('DR-04', { publishedAt: '2026-10-13' }),
        item('DR-05', { publishedAt: null }),
        item('DR-06', { size: 1000 }),
        item('DR-100'),
      ],
      AS_OF,
      100,
    );

    expect(plan).toEqual([
      { id: 'DR-02', state: 'withdrawn' },
      { id: 'DR-03', state: 'not_provided' },
      { id: 'DR-04', state: 'after_as_of' },
      { id: 'DR-05', state: 'after_as_of' },
      { id: 'DR-06', state: 'too_large' },
      { id: 'DR-10', state: 'shown' },
      { id: 'DR-100', state: 'shown' },
    ]);
  });

  it('counts only shown documents against the room left, and a withdrawn one takes none', () => {
    const plan = planTurn([item('DR-01', { size: 60, withdrawn: true }), item('DR-02', { size: 60 }), item('DR-03', { size: 60 }), item('DR-04', { size: 40 })], AS_OF, 100);

    expect(plan.map((entry) => entry.state)).toEqual(['withdrawn', 'shown', 'too_large', 'shown']);
  });

  it('agrees with documentsForTurn on the same room', () => {
    const documents = [doc({ id: 'DR-01', text: 'a'.repeat(60) }), doc({ id: 'DR-02', text: 'b'.repeat(60) }), doc({ id: 'DR-09', provided: false, text: null, publishedAt: null })];
    const turn = documentsForTurn(room(documents), 100);
    const plan = planTurn(
      documents.map((entry) => ({ id: entry.id, provided: entry.provided, publishedAt: entry.publishedAt, withdrawn: entry.withdrawnAt !== null, size: entry.text?.length ?? 0 })),
      AS_OF,
      100,
    );

    expect(plan.filter((entry) => entry.state === 'shown').map((entry) => entry.id)).toEqual(turn.shown.map((entry) => entry.id));
    expect(plan.filter((entry) => entry.state !== 'shown')).toEqual(turn.notShown.map((entry) => ({ id: entry.id, state: entry.reason })));
  });
});

describe('dataRoomTrace', () => {
  it('keeps only ids and reasons, never text', () => {
    const turn = documentsForTurn(room([doc({ id: 'DR-01' }), doc({ id: 'DR-09', provided: false, text: null, publishedAt: null })]));

    expect(dataRoomTrace(turn)).toEqual({ asOf: AS_OF, shown: ['DR-01'], notShown: [{ id: 'DR-09', reason: 'not_provided' }] });
    expect(JSON.stringify(dataRoomTrace(turn))).not.toContain('Some text');
  });
});
