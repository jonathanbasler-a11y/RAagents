import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// The route only wires the handler (src/app/api/_lib/sign-in.test.ts) to the real dependencies.
afterEach(() => {
  vi.unstubAllEnvs();
});

const signIn = () =>
  new Request('http://localhost:3200/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: 'username=admin&password=a-long-admin-password-1',
  });

describe('POST /api/login', () => {
  it('does not exist when sign-in is off', async () => {
    expect((await POST(signIn())).status).toBe(404);
  });

  it('reads the settings: a short admin password means sign-in is not set up', async () => {
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'short');
    const response = await POST(signIn());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?error=setup');
  });
});
