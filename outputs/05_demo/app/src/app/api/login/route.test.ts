import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_COOKIE, decideAccess } from '@/server/access-gate';

const SECRET = 'a-session-secret-of-at-least-32-chars!';

// Fresh module per test: the failed sign-in budget lives in the route module.
async function loadRoute() {
  vi.resetModules();
  return import('./route');
}

function signIn(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3200/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

function gateOn() {
  vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
  vi.stubEnv('RAAGENTS_SESSION_SECRET', SECRET);
}

function sessionCookie(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (header === null) return null;
  const match = new RegExp(`${ACCESS_COOKIE}=([^;]*)`).exec(header);
  return match === null ? null : match[1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/login', () => {
  it('does not exist when the access gate is off', async () => {
    const { POST } = await loadRoute();
    expect((await POST(signIn({ password: 'anything' }))).status).toBe(404);
  });

  it('issues a working session cookie for the right password and sends the person where they were going', async () => {
    gateOn();
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'open sesame', next: '/team' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/team');
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=43200/);
    const token = sessionCookie(response);
    const setting = { state: 'on' as const, password: 'open sesame', secret: SECRET };
    expect(await decideAccess({ method: 'GET', pathname: '/team', search: '', cookie: token }, setting, Date.now())).toEqual({
      kind: 'allow',
    });
  });

  it('sends a wrong password back to the login page with no cookie', async () => {
    gateOn();
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'guess', next: '/team' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?error=wrong&next=%2Fteam');
    expect(sessionCookie(response)).toBeNull();
  });

  it('never redirects off the site after signing in', async () => {
    gateOn();
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'open sesame', next: '//evil.example/x' }));
    expect(response.headers.get('location')).toBe('/');
  });

  it('refuses a sign-in that does not come from this site, even with the right password', async () => {
    gateOn();
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'open sesame' }, { 'sec-fetch-site': 'cross-site' }));
    expect(response.status).toBe(403);
    expect(sessionCookie(response)).toBeNull();
  });

  it('stops accepting sign-ins after 20 failures, the right password included', async () => {
    gateOn();
    const { POST } = await loadRoute();
    for (let i = 0; i < 20; i++) await POST(signIn({ password: `guess ${i}` }));
    const response = await POST(signIn({ password: 'open sesame', next: '/team' }));

    expect(response.headers.get('location')).toBe('/login?error=locked&next=%2Fteam');
    expect(sessionCookie(response)).toBeNull();
  });

  it('lets nobody in when the session secret is missing, and says sign-in is not set up', async () => {
    vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'open sesame' }));

    expect(response.headers.get('location')).toBe('/login?error=setup');
    expect(sessionCookie(response)).toBeNull();
  });

  it('refuses an oversized body without reading it', async () => {
    gateOn();
    const { POST } = await loadRoute();
    const response = await POST(signIn({ password: 'x'.repeat(10_000) }));
    expect(response.status).toBe(413);
  });
});
