import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';
import { ACCESS_COOKIE, createAccessToken } from '@/server/access-gate';

const SECRET = 'a-session-secret-of-at-least-32-chars!';

function request(path: string, init: { method?: string; host?: string; cookie?: string } = {}): NextRequest {
  const headers = new Headers({ host: init.host ?? 'localhost:3200' });
  if (init.cookie !== undefined) headers.set('cookie', `${ACCESS_COOKIE}=${init.cookie}`);
  return new NextRequest(`http://localhost:3200${path}`, { method: init.method ?? 'GET', headers });
}

function passedThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy without the access gate', () => {
  it('lets a loopback request through, as before', async () => {
    expect(passedThrough(await proxy(request('/')))).toBe(true);
    expect(passedThrough(await proxy(request('/api/rooms/team/messages')))).toBe(true);
  });
});

describe('proxy with the access gate on', () => {
  function gateOn() {
    vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
    vi.stubEnv('RAAGENTS_SESSION_SECRET', SECRET);
  }

  it('shows the login page in place of a page without a session: an internal rewrite, no Location header', async () => {
    // Next.js parses a Location set by the proxy as a full URL (a relative one crashes the request
    // with a 500, seen on a real server), and inside a container the request URL names the internal
    // address. A rewrite needs neither and answers the load balancer's health check of / with 200.
    gateOn();
    const response = await proxy(request('/team?thread=t1'));
    expect(response.headers.get('location')).toBeNull();
    const target = new URL(response.headers.get('x-middleware-rewrite') ?? 'http://none.invalid/');
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('next')).toBe('/team?thread=t1');
  });

  it('answers 401 with JSON to an API request without a session', async () => {
    gateOn();
    const response = await proxy(request('/api/rooms/team/turns', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ error: 'sign_in_required' });
  });

  it('lets a request with a valid session through', async () => {
    gateOn();
    const token = await createAccessToken(SECRET, Date.now());
    expect(passedThrough(await proxy(request('/team', { cookie: token })))).toBe(true);
    expect(passedThrough(await proxy(request('/api/rooms/team/messages', { cookie: token })))).toBe(true);
  });

  it('keeps the health check open for the load balancer', async () => {
    gateOn();
    expect(passedThrough(await proxy(request('/api/health')))).toBe(true);
  });

  it('still applies the host check first: a wrong Host is refused before anything else', async () => {
    gateOn();
    const token = await createAccessToken(SECRET, Date.now());
    const response = await proxy(request('/team', { host: 'attacker.example', cookie: token }));
    expect(response.status).toBe(421);
  });
});
