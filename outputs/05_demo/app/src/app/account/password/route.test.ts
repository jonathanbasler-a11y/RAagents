import { describe, expect, it } from 'vitest';
import { GET } from './route';

// The route only wires the page (src/app/api/_lib/account-password.test.ts) to the real dependencies.
describe('GET /account/password', () => {
  it('does not exist when sign-in is off', () => {
    expect(GET(new Request('http://localhost:3200/account/password')).status).toBe(404);
  });
});
