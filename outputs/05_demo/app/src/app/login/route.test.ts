import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

// The route only wires the page (src/app/api/_lib/sign-in.test.ts) to the real dependencies.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /login', () => {
  it('sends the person home when sign-in is off', () => {
    const response = GET(new Request('http://localhost:3200/login'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/');
  });

  it('serves the sign-in form when sign-in is on', async () => {
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'a-long-admin-password-1');
    const html = await GET(new Request('http://localhost:3200/login')).text();
    expect(html).toMatch(/<form[^>]*action="\/api\/login"/);
  });
});
