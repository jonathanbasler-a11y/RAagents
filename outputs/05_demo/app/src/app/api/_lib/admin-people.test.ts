import { afterEach, describe, expect, it, vi } from 'vitest';
import { HashingBusyError } from '@/server/accounts/crypto';
import type { ApiErrorBody } from '@/shared/contracts';
import type { OneTimePasswordResponse, PeopleResponse, PersonResponse } from '@/shared/accounts';
import { ADMIN_PASSWORD, accountHarness, formPost, sessionTokenOf, withSession, type AccountHarness } from './account-test-support';
import { getPeople, postPerson, postPersonAction } from './admin-people';
import { postLogin } from './sign-in';

const harnesses: AccountHarness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

/** The admin from the server settings, signed in, and a member waiting for their own password, signed in too. */
async function setup(options: Parameters<typeof accountHarness>[0] = {}) {
  const harness = accountHarness(options);
  harnesses.push(harness);
  if (options.setting?.state === 'off') return { harness, admin: 'T'.repeat(43), member: 'U'.repeat(43) };
  await harness.addServerAdmin();
  const admin = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
  const oneTime = await harness.addMember('member-one');
  const member = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'member-one', password: oneTime }), harness.deps))!;
  return { harness, admin, member };
}

const json = <T>(response: Response) => response.json() as Promise<T>;

function post(url: string, token: string, body: unknown, headers: Record<string, string> = {}): Request {
  return withSession(url, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: JSON.stringify(body),
  });
}

describe('the People API, for anyone but the admin', () => {
  it('does not exist when sign-in is off', async () => {
    const { harness, admin } = await setup({ setting: { state: 'off' } });
    expect((await getPeople(withSession('/api/admin/people', admin), harness.deps)).status).toBe(404);
    expect((await postPerson(post('/api/admin/people', admin, { username: 'member-two' }), harness.deps)).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const { harness } = await setup();
    const response = await getPeople(new Request('http://localhost:3200/api/admin/people'), harness.deps);
    expect(response.status).toBe(401);
    expect((await json<ApiErrorBody>(response)).error).toBe('sign_in_required');
  });

  it('answers 403 to a member, even called directly, and writes nothing', async () => {
    const { harness, member } = await setup();
    expect((await getPeople(withSession('/api/admin/people', member), harness.deps)).status).toBe(403);
    const create = await postPerson(post('/api/admin/people', member, { username: 'member-two' }), harness.deps);
    expect(create.status).toBe(403);
    expect((await json<ApiErrorBody>(create)).error).toBe('admin_only');
    expect(harness.store.findAccountForSignIn('member-two')).toBeNull();
    expect((await postPersonAction(post('/api/admin/people/member-one', member, { action: 'disable' }), harness.deps, 'member-one')).status).toBe(403);
  });
});

describe('getPeople', () => {
  it('lists everyone for the admin, with no password or hash anywhere', async () => {
    const { harness, admin } = await setup();
    const response = await getPeople(withSession('/api/admin/people', admin), harness.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    const body = await json<PeopleResponse>(response);
    expect(body.people.map((person) => [person.username, person.status])).toEqual([
      ['admin', 'active'],
      ['member-one', 'waiting'],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/scrypt|password/i);
  });
});

describe('postPerson', () => {
  it('creates a person and shows their one-time password once; it signs them in to choose their own', async () => {
    const { harness, admin } = await setup();
    const response = await postPerson(post('/api/admin/people', admin, { username: ' Member-Two ' }), harness.deps);

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    const body = await json<OneTimePasswordResponse>(response);
    expect(body.person).toMatchObject({ username: 'member-two', status: 'waiting', createdBy: 'admin' });
    expect(body.oneTimePassword).toMatch(/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/);
    expect(body.expiresAt).toBe(body.person.oneTimeExpiresAt);
    const signedIn = await postLogin(formPost('/api/login', { username: 'member-two', password: body.oneTimePassword }), harness.deps);
    expect(signedIn.headers.get('location')).toBe('/account/password');
    expect(JSON.stringify(await json<PeopleResponse>(await getPeople(withSession('/api/admin/people', admin), harness.deps)))).not.toContain(body.oneTimePassword);
  });

  it('refuses a cross-site or non-JSON request before it opens the database', async () => {
    const { harness, admin } = await setup();
    const store = vi.spyOn(harness.deps, 'store');
    expect((await postPerson(post('/api/admin/people', admin, { username: 'member-two' }, { 'sec-fetch-site': 'cross-site' }), harness.deps)).status).toBe(403);
    expect((await postPerson(post('/api/admin/people', admin, { username: 'member-two' }, { 'content-type': 'text/plain' }), harness.deps)).status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });

  it('refuses a name the rules refuse, saying why, and a name that is taken', async () => {
    const { harness, admin } = await setup();
    const invalid = await postPerson(post('/api/admin/people', admin, { username: 'with space' }), harness.deps);
    expect(invalid.status).toBe(400);
    expect((await json<ApiErrorBody>(invalid)).message).toMatch(/2 to 32 characters/);
    expect((await postPerson(post('/api/admin/people', admin, { nickname: 'x' }), harness.deps)).status).toBe(400);
    const taken = await postPerson(post('/api/admin/people', admin, { username: 'member-one' }), harness.deps);
    expect(taken.status).toBe(409);
    expect((await json<ApiErrorBody>(taken)).error).toBe('username_taken');
  });

  it('says the server is busy when too many passwords are being hashed', async () => {
    const { harness, admin } = await setup();
    vi.spyOn(harness.deps.passwords(), 'hash').mockRejectedValueOnce(new HashingBusyError());
    expect((await postPerson(post('/api/admin/people', admin, { username: 'member-two' }), harness.deps)).status).toBe(429);
    expect(harness.store.findAccountForSignIn('member-two')).toBeNull();
  });
});

describe('postPersonAction', () => {
  const act = (harness: AccountHarness, token: string, username: string, action: unknown) =>
    postPersonAction(post(`/api/admin/people/${username}`, token, { action }), harness.deps, username);

  it('resets a password: a new one-time password, shown once, and the person is signed out everywhere', async () => {
    const { harness, admin, member } = await setup();
    const response = await act(harness, admin, 'member-one', 'reset');
    expect(response.status).toBe(200);
    const body = await json<OneTimePasswordResponse>(response);
    expect(body.person.status).toBe('waiting');
    expect(harness.store.findSession(member)).toBeNull();
    const signedIn = await postLogin(formPost('/api/login', { username: 'member-one', password: body.oneTimePassword }), harness.deps);
    expect(signedIn.headers.get('location')).toBe('/account/password');
  });

  it('disables a person, ending their session at once, and enables them again', async () => {
    const { harness, admin, member } = await setup();
    const disabled = await json<PersonResponse>(await act(harness, admin, 'member-one', 'disable'));
    expect(disabled.person.status).toBe('disabled');
    expect(harness.store.findSession(member)).toBeNull();
    const enabled = await json<PersonResponse>(await act(harness, admin, 'member-one', 'enable'));
    expect(enabled.person.status).toBe('waiting');
  });

  it('refuses actions on the admin from the server settings, on an unknown person and an unknown action', async () => {
    const { harness, admin } = await setup();
    const serverAdmin = await act(harness, admin, 'admin', 'disable');
    expect(serverAdmin.status).toBe(409);
    expect((await json<ApiErrorBody>(serverAdmin)).error).toBe('server_managed_account');
    expect((await act(harness, admin, 'nobody', 'disable')).status).toBe(404);
    expect((await act(harness, admin, 'member-one', 'delete')).status).toBe(400);
    expect((await act(harness, admin, 'member-one', 'constructor')).status).toBe(400);
  });
});
