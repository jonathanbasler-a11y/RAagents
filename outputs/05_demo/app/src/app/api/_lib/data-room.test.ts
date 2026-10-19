import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import type { ApiErrorBody, DataRoomDocumentResponse, DataRoomResponse, NewDocument } from '@/shared/contracts';
import { MAX_DOCUMENT_CHARS, MAX_TURN_DOCUMENT_CHARS } from '@/shared/data-room';
import { getDataRoom, getDocument, postDataRoom, postDocument, postDocumentAction } from './data-room';
import { apiHarness, jsonOf, postRequest, type ApiHarness } from './test-support';

const AS_OF = '2026-10-12';

const PRACTICE = {
  asOf: AS_OF,
  documents: [
    { id: 'DR-01', title: 'Overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', url: null, provided: true, text: 'Overview text.', origin: 'practice-pack' },
    { id: 'DR-09', title: 'Paediatric study plan', sourceType: 'company-disclosure', publishedAt: null, url: null, provided: false, text: null, origin: 'practice-pack' },
  ] satisfies NewDocument[],
};

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(options: Parameters<typeof apiHarness>[0] = {}, practice: typeof PRACTICE | null = PRACTICE): ApiHarness {
  harness = apiHarness({ ...options, overrides: { practiceRoom: () => practice, ...options.overrides } });
  return harness;
}

const start = (api: ApiHarness, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postDataRoom(postRequest('/api/data-room', body, headers), api.deps);
const add = (api: ApiHarness, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postDocument(postRequest('/api/data-room/documents', body, headers), api.deps);
const act = (api: ApiHarness, id: string, body: unknown, headers: Record<string, string | undefined> = {}) =>
  postDocumentAction(postRequest(`/api/data-room/documents/${id}`, body, headers), api.deps, id);

const GOOD_DOC = { title: 'Clinical summary', sourceType: 'company-disclosure', publishedAt: '2026-07-30', url: null, provided: true, text: 'Topline table text.' };

describe('GET /api/data-room', () => {
  it('says there is no data room yet, whether the practice case can be loaded, and the limits', async () => {
    const api = setup();

    const response = getDataRoom(api.deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf<DataRoomResponse>(response)).toEqual({
      workspaceId: 'demo',
      dataRoom: null,
      practiceAvailable: true,
      limits: { documentChars: MAX_DOCUMENT_CHARS, turnChars: MAX_TURN_DOCUMENT_CHARS },
    });
  });

  it('says the practice case is not available when the pack is not installed', async () => {
    const api = setup({}, null);

    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).practiceAvailable).toBe(false);
  });

  it('says the practice case is not available, and logs why, when the pack is broken', async () => {
    const logs = captureLogs();
    const api = setup({ overrides: { practiceRoom: () => { throw new Error('pack.yaml is not valid YAML'); } } });

    const body = await jsonOf<DataRoomResponse>(getDataRoom(api.deps));

    expect(body.practiceAvailable).toBe(false);
    expect(logs.all()).toMatch(/practice data room.*pack\.yaml is not valid YAML/);
  });

  it('lists the documents without their text, in id order, with their length and state', async () => {
    const api = setup();
    await start(api, { practice: true });
    await act(api, 'DR-01', { action: 'withdraw', reason: 'wrong file' });

    const body = await jsonOf<DataRoomResponse>(getDataRoom(api.deps));

    expect(body.practiceAvailable).toBe(true);
    expect(body.dataRoom?.asOf).toBe(AS_OF);
    expect(body.dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01', 'DR-09']);
    expect(body.dataRoom?.documents[0]).toMatchObject({ id: 'DR-01', chars: 'Overview text.'.length, withdrawnReason: 'wrong file', origin: 'practice-pack', provided: true });
    expect(body.dataRoom?.documents[1]).toMatchObject({ id: 'DR-09', chars: 0, provided: false });
    expect(JSON.stringify(body)).not.toContain('Overview text.');
    expect(body.dataRoom?.documents[0]).not.toHaveProperty('text');
  });

  it('answers 500 with a correlation id and a generic message when the database fails, and logs the cause', async () => {
    const logs = captureLogs();
    const api = setup({ overrides: { runtime: () => { throw new Error('disk is gone: /secret/path'); } } });

    const response = getDataRoom(api.deps);

    expect(response.status).toBe(500);
    const body = await jsonOf<ApiErrorBody>(response);
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('/secret/path');
    expect(logs.all()).toContain(body.correlationId);
  });
});

describe('GET /api/data-room/documents/[id]', () => {
  it('returns the whole document with its text', async () => {
    const api = setup();
    await start(api, { practice: true });

    const response = getDocument(api.deps, 'DR-01');

    expect(response.status).toBe(200);
    expect((await jsonOf<DataRoomDocumentResponse>(response)).document).toMatchObject({ id: 'DR-01', title: 'Overview', text: 'Overview text.', sourceType: 'company-disclosure' });
  });

  it.each(['DR-77', 'nonsense', '../etc', 'DR-1'])('answers 404 document_not_found for %s', async (id) => {
    const api = setup();
    await start(api, { practice: true });

    const response = getDocument(api.deps, id);

    expect(response.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('document_not_found');
  });

  it('answers 404 when there is no data room at all', async () => {
    const api = setup();

    expect(getDocument(api.deps, 'DR-01').status).toBe(404);
  });
});

describe('POST /api/data-room: start', () => {
  it('starts an empty data room with an as-of date', async () => {
    const api = setup();

    const response = await start(api, { asOf: '2026-09-01' });

    expect(response.status).toBe(200);
    expect(await jsonOf<DataRoomResponse>(response)).toMatchObject({ dataRoom: { asOf: '2026-09-01', documents: [] } });
  });

  it('starts it with the fictional practice case: its as-of date and its documents', async () => {
    const api = setup();

    const body = await jsonOf<DataRoomResponse>(await start(api, { practice: true }));

    expect(body.dataRoom?.asOf).toBe(AS_OF);
    expect(body.dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01', 'DR-09']);
  });

  it('allows one data room per workspace: a second start is 409 data_room_exists and changes nothing', async () => {
    const api = setup();
    await start(api, { asOf: '2026-09-01' });

    const response = await start(api, { practice: true });

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('data_room_exists');
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.asOf).toBe('2026-09-01');
  });

  it.each([
    ['nothing', {}],
    ['both', { asOf: AS_OF, practice: true }],
    ['practice false', { practice: false }],
    ['a date that is not a date', { asOf: '2026-02-30' }],
    ['a date as a number', { asOf: 20261012 }],
    ['an array', []],
    ['text', 'hello'],
  ])('answers 400 for %s, and starts nothing', async (_label, body) => {
    const api = setup();

    const response = await start(api, body);

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('invalid_request');
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom).toBeNull();
  });

  it('says the practice case is not installed when it is not, with a message that names it', async () => {
    const api = setup({}, null);

    const response = await start(api, { practice: true });

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).message).toMatch(/practice/i);
  });

  it('refuses a cross-site or non-JSON POST with 403 before it opens the database', async () => {
    captureLogs();
    const api = setup();

    const crossSite = await start(api, { asOf: AS_OF }, { 'sec-fetch-site': 'cross-site' });
    const plain = await start(api, { asOf: AS_OF }, { 'content-type': 'text/plain' });

    expect(crossSite.status).toBe(403);
    expect(plain.status).toBe(403);
    expect(api.runtimeCalls()).toBe(0);
  });

  it('answers 500 with a correlation id when the store fails in an unexpected way', async () => {
    const logs = captureLogs();
    const api = setup({ overrides: { practiceRoom: () => { throw new Error('boom'); } } });

    const response = await start(api, { practice: true });

    expect(response.status).toBe(500);
    expect(logs.all()).toContain((await jsonOf<ApiErrorBody>(response)).correlationId);
  });
});

describe('POST /api/data-room/documents: add', () => {
  it('needs a data room first (409 no_data_room)', async () => {
    const api = setup();

    const response = await add(api, GOOD_DOC);

    expect(response.status).toBe(409);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('no_data_room');
  });

  it('adds the document under the next id and answers with it, text included', async () => {
    const api = setup();
    await start(api, { practice: true });

    const response = await add(api, { ...GOOD_DOC, url: 'https://example.org/summary' });

    expect(response.status).toBe(200);
    expect((await jsonOf<DataRoomDocumentResponse>(response)).document).toMatchObject({
      id: 'DR-10',
      title: 'Clinical summary',
      origin: 'added',
      url: 'https://example.org/summary',
      text: 'Topline table text.',
      withdrawnAt: null,
    });
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.documents.map((entry) => entry.id)).toEqual(['DR-01', 'DR-09', 'DR-10']);
  });

  it('takes only the fields it knows: a smuggled id, origin or withdrawal is ignored', async () => {
    const api = setup();
    await start(api, { asOf: AS_OF });

    const body = await jsonOf<DataRoomDocumentResponse>(
      await add(api, { ...GOOD_DOC, id: 'DR-50', origin: 'practice-pack', withdrawnAt: '2026-01-01T00:00:00.000Z', withdrawnReason: 'x', addedAt: '2000-01-01' }),
    );

    expect(body.document).toMatchObject({ id: 'DR-01', origin: 'added', withdrawnAt: null, withdrawnReason: null });
    expect(body.document.addedAt).not.toBe('2000-01-01');
  });

  it('lists a document as not provided without text', async () => {
    const api = setup();
    await start(api, { asOf: AS_OF });

    const response = await add(api, { title: 'Stability report', sourceType: 'company-disclosure', publishedAt: null, provided: false, text: null });

    expect((await jsonOf<DataRoomDocumentResponse>(response)).document).toMatchObject({ provided: false, text: null });
  });

  it('refuses a document dated after the as-of date with a 400 that says so, and adds nothing', async () => {
    const api = setup();
    await start(api, { practice: true });

    const response = await add(api, { ...GOOD_DOC, publishedAt: '2026-10-13' });

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).message).toMatch(/after the as-of date 2026-10-12/);
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.documents).toHaveLength(2);
  });

  it.each([
    ['no title', { ...GOOD_DOC, title: '' }, /title/],
    ['an unknown source type', { ...GOOD_DOC, sourceType: 'rumour' }, /source type/],
    ['text over the limit', { ...GOOD_DOC, text: 'x'.repeat(MAX_DOCUMENT_CHARS + 1) }, /characters/],
    ['a provided document with no text', { ...GOOD_DOC, text: '' }, /text/],
    ['a bad address', { ...GOOD_DOC, url: 'ftp://example.org' }, /address/],
    ['not an object', 'hello', /JSON|object|request/i],
  ])('answers 400 for %s', async (_label, body, message) => {
    const api = setup();
    await start(api, { asOf: AS_OF });

    const response = await add(api, body);

    expect(response.status).toBe(400);
    expect((await jsonOf<ApiErrorBody>(response)).message).toMatch(message);
  });

  it('refuses a cross-site POST with 403 and writes nothing', async () => {
    captureLogs();
    const api = setup();
    await start(api, { asOf: AS_OF });

    expect((await add(api, GOOD_DOC, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.documents).toEqual([]);
  });
});

describe('POST /api/data-room/documents/[id]: withdraw', () => {
  it('withdraws a document and answers with it, reason and time included, text kept', async () => {
    const api = setup();
    await start(api, { practice: true });

    const response = await act(api, 'DR-01', { action: 'withdraw', reason: '  pasted into the wrong room  ' });

    expect(response.status).toBe(200);
    const { document } = await jsonOf<DataRoomDocumentResponse>(response);
    expect(document).toMatchObject({ id: 'DR-01', withdrawnReason: 'pasted into the wrong room', text: 'Overview text.' });
    expect(document.withdrawnAt).not.toBeNull();
  });

  it('a second withdrawal answers with the first, unchanged', async () => {
    const api = setup();
    await start(api, { practice: true });
    await act(api, 'DR-01', { action: 'withdraw', reason: 'first' });

    const second = await jsonOf<DataRoomDocumentResponse>(await act(api, 'DR-01', { action: 'withdraw', reason: 'second' }));

    expect(second.document.withdrawnReason).toBe('first');
  });

  it('answers 404 for a document that is not there, 409 when there is no data room', async () => {
    const api = setup();
    expect((await act(api, 'DR-01', { action: 'withdraw', reason: 'x' })).status).toBe(409);
    await start(api, { practice: true });

    const response = await act(api, 'DR-77', { action: 'withdraw', reason: 'x' });

    expect(response.status).toBe(404);
    expect((await jsonOf<ApiErrorBody>(response)).error).toBe('document_not_found');
    expect((await act(api, 'not-an-id', { action: 'withdraw', reason: 'x' })).status).toBe(404);
  });

  it.each([
    ['a different action', { action: 'delete', reason: 'x' }],
    ['no action', { reason: 'x' }],
    ['no reason', { action: 'withdraw' }],
    ['an empty reason', { action: 'withdraw', reason: '   ' }],
    ['a reason over 300 characters', { action: 'withdraw', reason: 'x'.repeat(301) }],
    ['a reason that is not text', { action: 'withdraw', reason: 5 }],
  ])('answers 400 for %s, and withdraws nothing', async (_label, body) => {
    const api = setup();
    await start(api, { practice: true });

    const response = await act(api, 'DR-01', body);

    expect(response.status).toBe(400);
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.documents[0].withdrawnAt).toBeNull();
  });

  it('refuses a cross-site POST with 403', async () => {
    captureLogs();
    const api = setup();
    await start(api, { practice: true });

    expect((await act(api, 'DR-01', { action: 'withdraw', reason: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await jsonOf<DataRoomResponse>(getDataRoom(api.deps))).dataRoom?.documents[0].withdrawnAt).toBeNull();
  });
});
