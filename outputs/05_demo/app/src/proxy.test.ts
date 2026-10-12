import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

// The handler is thin: the decision table is tested in server/request-gate.test.ts. These
// tests prove the headers are read from the request and the answers are built right.

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost:3200${path}`, init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it('lets a loopback Host through on a page, an API route and a static asset', () => {
    for (const path of ['/', '/api/health', '/_next/static/chunks/app.js', '/avatars/dara.svg']) {
      const response = proxy(request(path, { headers: { host: '127.0.0.1:3200' } }));

      // NextResponse.next() marks "continue" with this header and carries no status of its own.
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('answers 421 to a rebinding host on every kind of route', async () => {
    for (const path of ['/', '/api/health', '/api/rooms/team/turns', '/_next/static/chunks/app.js']) {
      const response = proxy(request(path, { headers: { host: 'rebind.attacker.example.test:3200' } }));

      expect(response.status).toBe(421);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
      expect(await response.text()).toMatch(/Misdirected/);
    }
  });

  it('answers 403 to a POST from another origin', () => {
    const response = proxy(
      request('/api/rooms/team/turns', {
        method: 'POST',
        headers: { host: 'localhost:3200', origin: 'https://evil.example.test' },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('lets a same-origin POST through', () => {
    const response = proxy(
      request('/api/rooms/team/turns', {
        method: 'POST',
        headers: { host: 'localhost:3200', origin: 'http://localhost:3200' },
      }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('reads ALLOWED_HOSTS at request time', () => {
    const hostHeader = { host: 'app.example.test' };

    expect(proxy(request('/', { headers: hostHeader })).status).toBe(421);

    vi.stubEnv('ALLOWED_HOSTS', 'app.example.test');
    expect(proxy(request('/', { headers: hostHeader })).headers.get('x-middleware-next')).toBe('1');
  });

  it('reads HOST at request time: bound beyond loopback and unrestricted, any Host passes', () => {
    vi.stubEnv('HOST', '0.0.0.0');

    expect(proxy(request('/', { headers: { host: '3200-workspace.example.test' } })).headers.get('x-middleware-next')).toBe('1');
  });
});
