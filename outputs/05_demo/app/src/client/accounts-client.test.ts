import { describe, expect, it, vi } from 'vitest';
import { createAccountsClient } from './accounts-client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function recording(response: () => Response | Promise<Response>) {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init: init ?? {} });
    return response();
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('createAccountsClient', () => {
  it('reads the list of people without caching', async () => {
    const { calls, fetchFn } = recording(() => json(200, { people: [] }));
    expect(await createAccountsClient({ fetch: fetchFn }).listPeople()).toEqual({ ok: true, data: { people: [] } });
    expect(calls[0]).toMatchObject({ path: '/api/admin/people', init: { cache: 'no-store' } });
  });

  it('creates a person with a JSON post', async () => {
    const { calls, fetchFn } = recording(() => json(201, { person: {}, oneTimePassword: 'k7qm-2xvd-9hpt-4wcn', expiresAt: 'x' }));
    const result = await createAccountsClient({ fetch: fetchFn }).createPerson('member-two');
    expect(result.ok).toBe(true);
    expect(calls[0].path).toBe('/api/admin/people');
    expect(calls[0].init).toMatchObject({ method: 'POST', body: '{"username":"member-two"}' });
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json');
  });

  it('sends each action to the person, with the name escaped', async () => {
    const { calls, fetchFn } = recording(() => json(200, { person: {} }));
    const client = createAccountsClient({ fetch: fetchFn });
    await client.resetPerson('member.two');
    await client.disablePerson('member.two');
    await client.enablePerson('a/b');
    expect(calls.map((call) => [call.path, call.init.body])).toEqual([
      ['/api/admin/people/member.two', '{"action":"reset"}'],
      ['/api/admin/people/member.two', '{"action":"disable"}'],
      ['/api/admin/people/a%2Fb', '{"action":"enable"}'],
    ]);
  });

  it('passes the server error on, with its message and correlation id', async () => {
    const error = { error: 'username_taken', message: 'That username is taken. Choose another.', correlationId: 'corr-1' };
    const { fetchFn } = recording(() => json(409, error));
    expect(await createAccountsClient({ fetch: fetchFn }).createPerson('member-one')).toEqual({ ok: false, status: 409, error, message: error.message });
  });

  it('says the server could not be reached', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await createAccountsClient({ fetch: fetchFn }).listPeople()).toMatchObject({ ok: false, status: 0, error: null });
  });
});
