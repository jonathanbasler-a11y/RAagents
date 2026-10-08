import { describe, expect, it } from 'vitest';
import { checkSameOriginJson, readJsonBody } from './request-guard';

function request(headers: Record<string, string>, body: BodyInit | null = '{}'): Request {
  return new Request('http://localhost/api/anything', { method: 'POST', headers, body });
}

describe('checkSameOriginJson', () => {
  it('lets a same-origin JSON POST through (positive control)', () => {
    expect(checkSameOriginJson(request({ 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }))).toEqual({ ok: true });
    expect(checkSameOriginJson(request({ 'sec-fetch-site': 'same-origin', 'content-type': 'Application/JSON; charset=utf-8' }))).toEqual({ ok: true });
  });

  it.each([
    ['no Sec-Fetch-Site header', { 'content-type': 'application/json' }],
    ['a cross-site request', { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }],
    ['a same-site request from another origin', { 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }],
    ['a request the user typed', { 'sec-fetch-site': 'none', 'content-type': 'application/json' }],
  ])('refuses %s', (_name, headers) => {
    expect(checkSameOriginJson(request(headers))).toEqual({ ok: false, reason: 'not_same_origin' });
  });

  it.each([
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['a look-alike type', 'application/jsonx'],
  ])('refuses a same-origin POST sent as %s', (_name, contentType) => {
    expect(checkSameOriginJson(request({ 'sec-fetch-site': 'same-origin', 'content-type': contentType }))).toEqual({
      ok: false,
      reason: 'not_json',
    });
  });

  it('refuses a same-origin POST with no content type', () => {
    const bare = new Request('http://localhost/api/anything', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });

    expect(checkSameOriginJson(bare)).toEqual({ ok: false, reason: 'not_json' });
  });
});

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    await expect(readJsonBody(request({}, '{"a":1}'))).resolves.toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuses a body that is not JSON, an empty body and a body over the size cap', async () => {
    await expect(readJsonBody(request({}, 'not json'))).resolves.toEqual({ ok: false, message: expect.stringMatching(/JSON/) });
    await expect(readJsonBody(request({}, null))).resolves.toEqual({ ok: false, message: expect.stringMatching(/JSON/) });
    await expect(readJsonBody(request({}, JSON.stringify({ text: 'x'.repeat(200) })), 100)).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/too large/),
    });
  });
});
