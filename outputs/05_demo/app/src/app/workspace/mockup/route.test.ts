import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as route from './route';

// GET /workspace/mockup: the clickable mockup for the workspace page's frame.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockup-route-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /workspace/mockup', () => {
  it('runs on Node, is dynamic and only answers GET', () => {
    const exports = route as Record<string, unknown>;
    expect(exports.runtime).toBe('nodejs');
    expect(exports.dynamic).toBe('force-dynamic');
    expect(typeof exports.GET).toBe('function');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(exports[method]).toBeUndefined();
  });

  it('serves the file named by MOCKUP_HTML_PATH as uncached HTML', async () => {
    const file = path.join(dir, 'mockup.html');
    writeFileSync(file, '<!doctype html><title>Stand-in mockup</title>', 'utf8');
    vi.stubEnv('MOCKUP_HTML_PATH', file);

    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<!doctype html><title>Stand-in mockup</title>');
  });

  it('answers the clear missing-file page when the file is not there', async () => {
    vi.stubEnv('MOCKUP_HTML_PATH', path.join(dir, 'missing.html'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await route.GET();
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(body).toContain('The workspace mockup could not be found');
    expect(body).toContain('MOCKUP_HTML_PATH is set');
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('serves the real mockup from ../ux-mockup/index.html when MOCKUP_HTML_PATH is unset', async () => {
    vi.stubEnv('MOCKUP_HTML_PATH', undefined);

    const response = await route.GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('UX mockup v2');
  });
});
