import { describe, expect, it } from 'vitest';
import { GET, POST } from './route';
import { POST as ACT } from './[username]/route';

// The routes only wire the handlers (src/app/api/_lib/admin-people.test.ts) to the real dependencies.
describe('/api/admin/people', () => {
  it('does not exist when sign-in is off', async () => {
    expect(GET(new Request('http://localhost:3200/api/admin/people')).status).toBe(404);
    const post = new Request('http://localhost:3200/api/admin/people', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: '{"username":"member-two"}',
    });
    expect((await POST(post)).status).toBe(404);
    const act = new Request('http://localhost:3200/api/admin/people/member-two', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: '{"action":"disable"}',
    });
    expect((await ACT(act, { params: Promise.resolve({ username: 'member-two' }) })).status).toBe(404);
  });
});
