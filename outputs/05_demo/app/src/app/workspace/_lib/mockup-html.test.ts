import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MOCKUP_CSP, resolveMockupPath, serveMockupHtml } from './mockup-html';

// A stand-in for the mockup: non-ASCII text and a script, so "as-is" means byte for byte.
const SAMPLE = '<!doctype html>\n<html lang="en"><title>Mockup · v2 – café</title><script>location.hash</script></html>\n';

let dir: string;
let log: { error: Mock<(...args: unknown[]) => void> };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-html-test-'));
  log = { error: vi.fn<(...args: unknown[]) => void>() };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fixedId = () => 'ref-1234';

describe('resolveMockupPath', () => {
  it('defaults to ../ux-mockup/index.html from the app folder', () => {
    expect(resolveMockupPath({}, '/home/someone/repo/outputs/05_demo/app')).toBe('/home/someone/repo/outputs/05_demo/ux-mockup/index.html');
  });

  it('uses MOCKUP_HTML_PATH when it is set, relative to the app folder', () => {
    expect(resolveMockupPath({ MOCKUP_HTML_PATH: '/home/someone/elsewhere/mockup.html' }, '/home/someone/app')).toBe(
      '/home/someone/elsewhere/mockup.html',
    );
    expect(resolveMockupPath({ MOCKUP_HTML_PATH: 'fixtures/mockup.html' }, '/home/someone/app')).toBe('/home/someone/app/fixtures/mockup.html');
  });

  it('treats an empty MOCKUP_HTML_PATH as unset', () => {
    expect(resolveMockupPath({ MOCKUP_HTML_PATH: '  ' }, '/home/someone/repo/outputs/05_demo/app')).toBe(
      '/home/someone/repo/outputs/05_demo/ux-mockup/index.html',
    );
  });
});

describe('serveMockupHtml', () => {
  it('serves the file byte for byte as HTML that is never cached', async () => {
    const file = path.join(dir, 'index.html');
    writeFileSync(file, SAMPLE, 'utf8');

    const response = await serveMockupHtml({ path: file, log, newId: fixedId });

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(SAMPLE, 'utf8'))).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('lets only the app frame it, and lets the page run its own inline script but fetch nothing', async () => {
    const file = path.join(dir, 'index.html');
    writeFileSync(file, SAMPLE, 'utf8');

    const response = await serveMockupHtml({ path: file, log, newId: fixedId });
    const csp = response.headers.get('content-security-policy') ?? '';
    const directives = csp.split(';').map((part) => part.trim());

    expect(csp).toBe(MOCKUP_CSP);
    expect(directives).toEqual(
      expect.arrayContaining([
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "frame-ancestors 'self'",
        'sandbox allow-scripts',
      ]),
    );
    expect(csp).not.toMatch(/allow-same-origin|https?:|\*/);
  });

  it('reads from disk only: it never calls fetch', async () => {
    const file = path.join(dir, 'index.html');
    writeFileSync(file, SAMPLE, 'utf8');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await serveMockupHtml({ path: file, log, newId: fixedId });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a clear page when the file is missing, without the server path, and logs the path', async () => {
    const missing = path.join(dir, 'ux-mockup', 'index.html');

    const response = await serveMockupHtml({ path: missing, log, newId: fixedId });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toContain('<h1>The workspace mockup could not be found</h1>');
    expect(body).toContain('outputs/05_demo/ux-mockup/index.html');
    expect(body).toContain('MOCKUP_HTML_PATH');
    expect(body).toContain('The live team chat does not need this file.');
    expect(body).toContain('ref-1234');
    expect(body).not.toContain(dir);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0][0])).toContain(missing);
    expect(String(log.error.mock.calls[0][0])).toContain('ref-1234');
  });

  it('says so when MOCKUP_HTML_PATH named the missing file', async () => {
    const response = await serveMockupHtml({ path: path.join(dir, 'nope.html'), fromEnv: true, log, newId: fixedId });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('MOCKUP_HTML_PATH is set');
    expect(body).not.toContain(dir);
  });

  it('answers a generic error page with a reference when the file cannot be read', async () => {
    const folder = path.join(dir, 'index.html');
    mkdirSync(folder);

    const response = await serveMockupHtml({ path: folder, log, newId: fixedId });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toContain('<h1>The workspace mockup could not be read</h1>');
    expect(body).toContain('ref-1234');
    expect(body).not.toContain(dir);
    expect(String(log.error.mock.calls[0][0])).toContain('EISDIR');
  });
});
