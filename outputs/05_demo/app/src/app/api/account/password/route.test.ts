import { describe, expect, it } from 'vitest';
import { POST } from './route';

// The route only wires the handler (src/app/api/_lib/account-password.test.ts) to the real dependencies.
describe('POST /api/account/password', () => {
  it('does not exist when sign-in is off', async () => {
    const request = new Request('http://localhost:3200/api/account/password', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    expect((await POST(request)).status).toBe(404);
  });
});
