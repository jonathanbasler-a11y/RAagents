import { afterEach, describe, expect, it, vi } from 'vitest';
import { HashingBusyError } from '@/server/accounts/crypto';
import { tokenHash } from '@/server/accounts/session-lookup';
import { ADMIN_PASSWORD, accountHarness, formPost, sessionTokenOf, withSession, type AccountHarness } from './account-test-support';
import { getLoginPage, postLogin, postLogout } from './sign-in';

const harnesses: AccountHarness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

function setup(options: Parameters<typeof accountHarness>[0] = {}) {
  const harness = accountHarness(options);
  harnesses.push(harness);
  return harness;
}

const login = (fields: Record<string, string>, headers: Record<string, string> = {}) => formPost('/api/login', fields, headers);
const location = (response: Response) => response.headers.get('location');

describe('postLogin', () => {
  it('does not exist when sign-in is off', async () => {
    const harness = setup({ setting: { state: 'off' } });
    expect((await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps)).status).toBe(404);
  });

  it('refuses a cross-site sign-in before it opens the database', async () => {
    const harness = setup();
    const store = vi.spyOn(harness.deps, 'store');
    const response = await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }, { 'sec-fetch-site': 'cross-site' }), harness.deps);
    expect(response.status).toBe(403);
    expect(store).not.toHaveBeenCalled();
  });

  it('refuses a body over 8 KB', async () => {
    const harness = setup();
    expect((await postLogin(login({ username: 'admin', password: 'x'.repeat(9000) }), harness.deps)).status).toBe(413);
  });

  it('says sign-in is not set up when the settings are broken', async () => {
    const harness = setup({ setting: { state: 'misconfigured', reason: 'no admin password' } });
    expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))).toBe('/login?error=setup');
  });

  it('signs the admin in with the password from the settings: a session cookie and the page they were going to', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const response = await postLogin(login({ username: ' Admin ', password: ADMIN_PASSWORD, next: '/team' }), harness.deps);

    expect(response.status).toBe(303);
    expect(location(response)).toBe('/team');
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-raagents_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
    const token = sessionTokenOf(response)!;
    expect(harness.store.findSession(token)).toMatchObject({ username: 'admin', role: 'admin' });
  });

  it('refuses the old admin password once the settings name a new one, even before a restart', async () => {
    const harness = setup({ setting: { state: 'on', admin: { username: 'admin', password: 'the-new-long-admin-password' }, trustedProxyHops: 0 } });
    await harness.addServerAdmin();
    const response = await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps);
    expect(location(response)).toBe('/login?error=wrong');
    expect(sessionTokenOf(response)).toBeNull();
  });

  it('takes a one-time password however it is typed and sends the person to choose their own', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    const response = await postLogin(login({ username: 'member-one', password: ` ${oneTime.toUpperCase().replace(/-/g, ' ')} `, next: '/team' }), harness.deps);
    expect(location(response)).toBe('/account/password?next=%2Fteam');
    expect(harness.store.findSession(sessionTokenOf(response)!)).toMatchObject({ mustChangePassword: true });
  });

  it('gives the same answer for a wrong password, an unknown name and a disabled account with its right password', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    const disabledOneTime = await harness.addMember('member-two');
    harness.store.setPersonDisabled({ username: 'member-two', disabled: true, actor: 'admin' });
    const verify = vi.spyOn(harness.deps.passwords(), 'verify');

    for (const [username, password] of [
      ['member-one', 'not the password'],
      ['nobody', oneTime],
      ['member-two', disabledOneTime],
    ]) {
      const response = await postLogin(login({ username, password, next: '/team' }), harness.deps);
      expect(location(response), username).toBe('/login?error=wrong&next=%2Fteam');
      expect(sessionTokenOf(response), username).toBeNull();
    }
    // An unknown name is checked against the dummy hash, so it takes as long as a real check.
    expect(verify).toHaveBeenCalledWith(oneTime, harness.deps.passwords().dummy);
  });

  it('never asks the session store for a session for a disabled account, even with its right password', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    harness.store.setPersonDisabled({ username: 'member-one', disabled: true, actor: 'admin' });
    const open = vi.spyOn(harness.store, 'openSession');
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=wrong');
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses an expired one-time password and says so', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    harness.advance(7 * 24 * 60 * 60 * 1000);
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=expired');
  });

  it('stops checking passwords for a name after 10 failures, refusing even the right one, until the window passes', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    for (let i = 0; i < 10; i++) await postLogin(login({ username: 'member-one', password: 'wrong password' }), harness.deps);
    const verify = vi.spyOn(harness.deps.passwords(), 'verify');

    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=locked');
    expect(verify).not.toHaveBeenCalled();
    harness.advance(15 * 60 * 1000);
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/account/password');
  });

  it('limits one machine on one name to 5 failures, counting the address the load balancer added', async () => {
    const harness = setup({ hops: 1 });
    const oneTime = await harness.addMember('member-one');
    const from = (address: string) => ({ 'x-forwarded-for': `198.51.100.99, ${address}` });
    for (let i = 0; i < 5; i++) await postLogin(login({ username: 'member-one', password: 'wrong password' }, from('203.0.113.7')), harness.deps);

    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }, from('203.0.113.7')), harness.deps))).toBe('/login?error=locked');
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }, from('203.0.113.8')), harness.deps))).toBe('/account/password');
  });

  it('keeps no lockout on the admin name, which anyone could otherwise use to lock the owner out', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    for (let i = 0; i < 12; i++) await postLogin(login({ username: 'admin', password: 'wrong password' }), harness.deps);
    expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))).toBe('/');
  });

  it('counts sign-ins made at the same moment against the budget before any password is checked', async () => {
    const harness = setup();
    await harness.addMember('member-one');
    const responses = await Promise.all(Array.from({ length: 30 }, () => postLogin(login({ username: 'member-one', password: 'wrong password' }), harness.deps)));
    expect(responses.filter((response) => location(response) === '/login?error=locked')).toHaveLength(20);
  });

  it('says the server is busy, without counting a failure, when too many passwords are being checked', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    const verify = vi.spyOn(harness.deps.passwords(), 'verify');
    for (let i = 0; i < 12; i++) verify.mockRejectedValueOnce(new HashingBusyError());
    for (let i = 0; i < 12; i++) {
      expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=busy');
    }
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/account/password');
  });

  it('does not count a sign-in the database could not answer as a failed attempt', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    const find = vi.spyOn(harness.store, 'findAccountForSignIn');
    for (let i = 0; i < 12; i++) find.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    for (let i = 0; i < 12; i++) await expect(postLogin(login({ username: 'member-one', password: oneTime }), harness.deps)).rejects.toThrow('database is locked');
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/account/password');
  });

  it('limits successful sign-ins of one account, since each one is kept for good', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    for (let i = 0; i < 20; i++) expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))).toBe('/');
    expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))).toBe('/login?error=many');
    harness.advance(15 * 60 * 1000);
    expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))).toBe('/');
  });

  it('keeps the per-name budget for a member whose name the settings give to the admin', async () => {
    const harness = setup({ setting: { state: 'on', admin: { username: 'member-one', password: ADMIN_PASSWORD }, trustedProxyHops: 0 } });
    const oneTime = await harness.addMember('member-one');
    for (let i = 0; i < 10; i++) await postLogin(login({ username: 'member-one', password: 'wrong password' }), harness.deps);
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=locked');
  });

  it('answers wrong, not a server error, when the account is disabled while its password is being checked', async () => {
    const harness = setup();
    const oneTime = await harness.addMember('member-one');
    vi.spyOn(harness.store, 'openSession').mockImplementationOnce(() => {
      harness.store.setPersonDisabled({ username: 'member-one', disabled: true, actor: 'admin' });
      throw new Error('a disabled account cannot get a session');
    });
    expect(location(await postLogin(login({ username: 'member-one', password: oneTime }), harness.deps))).toBe('/login?error=wrong');
  });

  it('notes refused sign-ins in the log once a minute at most, with a count and no name', async () => {
    const harness = setup();
    await harness.addMember('member-one');
    const warn = vi.spyOn(harness.deps.log, 'warn');
    for (let i = 0; i < 40; i++) await postLogin(login({ username: 'member-one', password: 'wrong password' }), harness.deps);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain('member-one');
  });

  it('treats a name too long to exist as an unknown name', async () => {
    const harness = setup();
    expect(location(await postLogin(login({ username: 'x'.repeat(7000), password: 'anything' }), harness.deps))).toBe('/login?error=wrong');
  });

  it('sends a person to a non-Latin path in a form that fits a Location header', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    expect(location(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD, next: '/日' }), harness.deps))).toBe('/%E6%97%A5');
  });
});

describe('postLogout', () => {
  it('ends the session in the database, clears the cookie and shows the login page', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const token = sessionTokenOf(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;

    const response = await postLogout(withSession('/api/logout', token, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), harness.deps);

    expect(response.status).toBe(303);
    expect(location(response)).toBe('/login');
    expect(response.headers.get('set-cookie')).toBe('__Host-raagents_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    expect(harness.store.findSession(token)).toBeNull();
    expect(harness.db.prepare(`SELECT kind FROM account_events WHERE kind = 'signed_out'`).all()).toHaveLength(1);
  });

  it('clears the cookie even when the database cannot be written', async () => {
    const harness = setup();
    vi.spyOn(harness.deps.store(), 'closeSession').mockImplementation(() => {
      throw new Error('database is locked');
    });
    const response = await postLogout(withSession('/api/logout', 'T'.repeat(43), { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), harness.deps);
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(location(response)).toBe('/login');
  });

  it('refuses a cross-site sign-out, and does not exist when sign-in is off', async () => {
    const harness = setup();
    const crossSite = await postLogout(withSession('/api/logout', 'T'.repeat(43), { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), harness.deps);
    expect(crossSite.status).toBe(403);
    const off = setup({ setting: { state: 'off' } });
    expect((await postLogout(withSession('/api/logout', 'T'.repeat(43), { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), off.deps)).status).toBe(404);
  });

  it('records the sign-out against the right session only', async () => {
    const harness = setup();
    await harness.addServerAdmin();
    const first = sessionTokenOf(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
    const second = sessionTokenOf(await postLogin(login({ username: 'admin', password: ADMIN_PASSWORD }), harness.deps))!;
    await postLogout(withSession('/api/logout', first, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), harness.deps);
    expect(harness.store.findSession(first)).toBeNull();
    expect(harness.store.findSession(second)).not.toBeNull();
    expect(harness.db.prepare('SELECT revoked_at FROM account_sessions WHERE token_hash = ?').get(tokenHash(second))).toEqual({ revoked_at: null });
  });
});

describe('getLoginPage', () => {
  const page = (query = '') => new Request(`http://localhost:3200/login${query}`);

  it('sends the person home when sign-in is off', () => {
    const harness = setup({ setting: { state: 'off' } });
    const response = getLoginPage(page(), harness.deps);
    expect(response.status).toBe(307);
    expect(location(response)).toBe('/');
  });

  it('serves a form with a username and a password field that posts to the sign-in route, keeping where the person was going', async () => {
    const harness = setup();
    const response = getLoginPage(page('?next=%2Fteam'), harness.deps);
    const html = await response.text();
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/login"/);
    expect(html).toMatch(/<input[^>]*name="username"[^>]*autocomplete="username"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*name="password"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/team"/);
  });

  it('drops a return path that could leave the site, and escapes the rest', async () => {
    const harness = setup();
    expect(await getLoginPage(page(`?next=${encodeURIComponent('//evil.example/x')}`), harness.deps).text()).not.toContain('evil.example');
    const html = await getLoginPage(page(`?next=${encodeURIComponent('/team"><script>alert(1)</script>')}`), harness.deps).text();
    expect(html).not.toContain('<script>');
  });

  it('says why the last attempt failed, and ignores a reason it does not know without failing', async () => {
    const harness = setup();
    expect(await getLoginPage(page('?error=wrong'), harness.deps).text()).toMatch(/That username and password do not match/);
    expect(await getLoginPage(page('?error=locked'), harness.deps).text()).toMatch(/Too many failed sign-ins/);
    expect(await getLoginPage(page('?error=expired'), harness.deps).text()).toMatch(/one-time password has expired/);
    expect(await getLoginPage(page('?error=busy'), harness.deps).text()).toMatch(/busy/);
    for (const odd of ['constructor', '__proto__', 'toString']) {
      const response = getLoginPage(page(`?error=${odd}`), harness.deps);
      expect(response.status, odd).toBe(200);
      expect(await response.text(), odd).not.toMatch(/role="alert"/);
    }
  });

  it('says sign-in is not set up when the settings are broken', async () => {
    const harness = setup({ setting: { state: 'misconfigured', reason: 'no admin password' } });
    expect(await getLoginPage(page(), harness.deps).text()).toMatch(/Sign-in is not set up/);
  });

  it('shows the hosted notice, escaped', async () => {
    vi.stubEnv('RAAGENTS_HOSTED_NOTICE', 'Practice copy <b>only</b>');
    const harness = setup();
    expect(await getLoginPage(page(), harness.deps).text()).toContain('Practice copy &lt;b&gt;only&lt;/b&gt;');
    vi.unstubAllEnvs();
  });
});
