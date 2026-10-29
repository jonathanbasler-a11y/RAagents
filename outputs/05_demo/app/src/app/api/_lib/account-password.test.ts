import { afterEach, describe, expect, it, vi } from 'vitest';
import { HashingBusyError } from '@/server/accounts/crypto';
import { PasswordChangedMeanwhileError, PersonNotFoundError } from '@/server/accounts/store';
import { getPasswordPage, postPassword } from './account-password';
import { ADMIN_PASSWORD, accountHarness, formPost, sessionTokenOf, withSession, type AccountHarness } from './account-test-support';
import { postLogin } from './sign-in';

const harnesses: AccountHarness[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

function setup(options: Parameters<typeof accountHarness>[0] = {}) {
  const harness = accountHarness(options);
  harnesses.push(harness);
  return harness;
}

const NEW_PASSWORD = 'a sentence I will remember';
const location = (response: Response) => response.headers.get('location');

/** A member who signed in with their one-time password; returns the session token and the one-time password. */
async function waitingMember(harness: AccountHarness) {
  const oneTime = await harness.addMember('member-one');
  const token = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'member-one', password: oneTime }), harness.deps))!;
  return { token, oneTime };
}

function change(token: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const request = formPost('/api/account/password', fields, headers);
  const withCookie = new Headers(request.headers);
  withCookie.set('cookie', `__Host-raagents_session=${token}`);
  return new Request(request, { headers: withCookie });
}

describe('getPasswordPage', () => {
  it('does not exist when sign-in is off', () => {
    const harness = setup({ setting: { state: 'off' } });
    expect(getPasswordPage(new Request('http://localhost:3200/account/password'), harness.deps).status).toBe(404);
  });

  it('sends someone without a session to the login page', () => {
    const harness = setup();
    expect(location(getPasswordPage(new Request('http://localhost:3200/account/password'), harness.deps))).toBe('/login');
  });

  it('asks a person holding a one-time password for it and for their own new password', async () => {
    const harness = setup();
    const { token } = await waitingMember(harness);
    const html = await getPasswordPage(withSession('/account/password?next=%2Fteam', token), harness.deps).text();
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/account\/password"/);
    expect(html).toMatch(/One-time password/);
    expect(html).toMatch(/<input[^>]*name="username"[^>]*value="member-one"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/team"/);
  });

  it('tells the admin from the server settings that their password is set there', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const token = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
    const html = await getPasswordPage(withSession('/account/password', token), harness.deps).text();
    expect(html).toMatch(/set in the server settings/);
    expect(html).not.toMatch(/<form/);
  });

  it('sends a former server admin, under a name the settings no longer use, to sign in', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const token = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
    const renamed = { ...harness.deps, setting: () => ({ state: 'on' as const, admin: { username: 'owner', password: ADMIN_PASSWORD }, trustedProxyHops: 0 as const }) };
    expect(location(getPasswordPage(withSession('/account/password', token), renamed))).toBe('/login');
    expect(location(await postPassword(change(token, { current: ADMIN_PASSWORD, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), renamed))).toBe('/login');
  });

  it('says why the last change failed, and ignores a reason it does not know', async () => {
    const harness = setup();
    const { token } = await waitingMember(harness);
    expect(await getPasswordPage(withSession('/account/password?error=mismatch', token), harness.deps).text()).toMatch(/two new passwords are not the same/);
    const odd = getPasswordPage(withSession('/account/password?error=constructor', token), harness.deps);
    expect(odd.status).toBe(200);
    expect(await odd.text()).not.toMatch(/role="alert"/);
  });
});

describe('postPassword', () => {
  it('does not exist when sign-in is off, and refuses a cross-site post', async () => {
    const off = setup({ setting: { state: 'off' } });
    expect((await postPassword(change('T'.repeat(43), {}), off.deps)).status).toBe(404);
    const harness = setup();
    expect((await postPassword(change('T'.repeat(43), {}, { 'sec-fetch-site': 'cross-site' }), harness.deps)).status).toBe(403);
  });

  it('sends someone without a session to the login page', async () => {
    const harness = setup();
    expect(location(await postPassword(change('T'.repeat(43), { current: 'x', password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe('/login');
  });

  it('replaces the one-time password: a fresh session for this browser, every old one ended', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);

    const response = await postPassword(change(token, { current: oneTime.toUpperCase(), password: NEW_PASSWORD, repeat: NEW_PASSWORD, next: '/team' }), harness.deps);

    expect(response.status).toBe(303);
    expect(location(response)).toBe('/team');
    const fresh = sessionTokenOf(response)!;
    expect(fresh).not.toBe(token);
    expect(harness.store.findSession(token)).toBeNull();
    expect(harness.store.findSession(fresh)).toMatchObject({ username: 'member-one', mustChangePassword: false });
    // The new password signs in; the one-time password no longer does.
    expect(location(await postLogin(formPost('/api/login', { username: 'member-one', password: NEW_PASSWORD }), harness.deps))).toBe('/');
    expect(location(await postLogin(formPost('/api/login', { username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=wrong');
  });

  it('refuses a wrong current password, and stops checking after 5 wrong attempts', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    for (let i = 0; i < 5; i++) {
      expect(location(await postPassword(change(token, { current: 'not it', password: NEW_PASSWORD, repeat: NEW_PASSWORD, next: '/team' }), harness.deps))).toBe(
        '/account/password?error=wrong&next=%2Fteam',
      );
    }
    const verify = vi.spyOn(harness.deps.passwords(), 'verify');
    expect(location(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe('/account/password?error=locked');
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses two different new passwords, and a new password the rules refuse, naming the rule', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    expect(location(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: `${NEW_PASSWORD}!` }), harness.deps))).toBe('/account/password?error=mismatch');
    expect(location(await postPassword(change(token, { current: oneTime, password: 'too short', repeat: 'too short' }), harness.deps))).toBe('/account/password?error=too_short');
    expect(location(await postPassword(change(token, { current: oneTime, password: 'member-one forever', repeat: 'member-one forever' }), harness.deps))).toBe(
      '/account/password?error=contains_username',
    );
  });

  it('refuses the current password as the new one on a voluntary change', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    const fresh = sessionTokenOf(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))!;
    expect(location(await postPassword(change(fresh, { current: NEW_PASSWORD, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe(
      '/account/password?error=same_as_current',
    );
  });

  it('refuses a one-time password that expired after the person signed in', async () => {
    const harness = setup();
    const HOUR = 60 * 60 * 1000;
    const oneTime = await harness.addMember('member-one');
    harness.advance(7 * 24 * HOUR - HOUR);
    const token = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'member-one', password: oneTime }), harness.deps))!;
    harness.advance(2 * HOUR);
    expect(location(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe(
      '/account/password?error=expired',
    );
  });

  it('refuses the admin from the server settings', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const token = sessionTokenOf(await postLogin(formPost('/api/login', { username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
    expect(location(await postPassword(change(token, { current: ADMIN_PASSWORD, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe(
      '/account/password?error=server',
    );
  });

  it('sends the person back to sign in when the admin reset their password in the meantime', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    vi.spyOn(harness.store, 'changeOwnPassword').mockImplementationOnce(() => {
      throw new PasswordChangedMeanwhileError();
    });
    const response = await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps);
    expect(location(response)).toBe('/login?error=ended');
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('says the server is busy when the new password cannot be hashed yet', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    vi.spyOn(harness.deps.passwords(), 'hash').mockRejectedValueOnce(new HashingBusyError());
    expect(location(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe('/account/password?error=busy');
  });

  it('sends the person back to sign in when they were disabled in the meantime', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    vi.spyOn(harness.store, 'changeOwnPassword').mockImplementationOnce(() => {
      throw new PersonNotFoundError('with this id');
    });
    const response = await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps);
    expect(location(response)).toBe('/login?error=ended');
  });

  it('says the server is busy without counting a wrong attempt', async () => {
    const harness = setup();
    const { token, oneTime } = await waitingMember(harness);
    vi.spyOn(harness.deps.passwords(), 'verify').mockRejectedValueOnce(new HashingBusyError());
    expect(location(await postPassword(change(token, { current: oneTime, password: NEW_PASSWORD, repeat: NEW_PASSWORD }), harness.deps))).toBe('/account/password?error=busy');
  });
});
