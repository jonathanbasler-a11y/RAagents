import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

function signOut(headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }): Request {
  return new Request('http://localhost:3200/api/logout', { method: 'POST', headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/logout', () => {
  it('does not exist when the access gate is off', async () => {
    expect((await POST(signOut())).status).toBe(404);
  });

  it('clears the session cookie and sends the person to the login page', async () => {
    vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
    vi.stubEnv('RAAGENTS_SESSION_SECRET', 'a-session-secret-of-at-least-32-chars!');
    const response = await POST(signOut());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login');
    expect(response.headers.get('set-cookie')).toMatch(/raagents_access=;.*Max-Age=0/i);
  });

  it('refuses a sign-out sent from another site', async () => {
    vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
    vi.stubEnv('RAAGENTS_SESSION_SECRET', 'a-session-secret-of-at-least-32-chars!');
    expect((await POST(signOut({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  });
});
