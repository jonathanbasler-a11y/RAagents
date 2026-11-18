import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// The route only wires the handler (src/app/api/_lib/sign-in.test.ts) to the real dependencies.
afterEach(() => {
  vi.unstubAllEnvs();
});

const signOut = () => new Request('http://localhost:3200/api/logout', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });

describe('POST /api/logout', () => {
  it('does not exist when sign-in is off', async () => {
    expect((await POST(signOut())).status).toBe(404);
  });

  it('clears the cookie and shows the login page when sign-in is set up wrongly too', async () => {
    vi.stubEnv('RAAGENTS_REQUIRE_SIGN_IN', '1');
    const response = await POST(signOut());
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
});
