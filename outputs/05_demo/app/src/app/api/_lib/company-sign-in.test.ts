import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeProvider, type FakeProvider } from '@/server/accounts/oidc-test-support';
import { getPasswordPage, postPassword } from './account-password';
import { ADMIN_EMAIL, accountHarness, companySetting, formPost, withSession, type AccountHarness } from './account-test-support';
import { getCompanySignInCallback, getCompanySignInStart } from './company-sign-in';
import { getLoginPage } from './sign-in';

const harnesses: AccountHarness[] = [];
afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.cleanup();
});

function setup(adminUsername = 'admin') {
  const provider = createFakeProvider();
  const harness = accountHarness({ setting: companySetting(adminUsername), oidcFetch: provider.fetch });
  harnesses.push(harness);
  const log = { warn: vi.fn(), error: vi.fn() };
  harness.deps.log = log;
  harness.store.bootstrapServerAdminByEmail({ username: 'admin', email: ADMIN_EMAIL });
  harness.store.addPersonByEmail({ email: 'jane.doe@example.test', actor: 'admin' });
  return { provider, harness, log };
}

const location = (response: Response) => response.headers.get('location') ?? '';
const cookies = (response: Response) => response.headers.getSetCookie();
const signInCookieOf = (response: Response) => /__Host-raagents_signin=([^;]*)/.exec(cookies(response).join('\n'))?.[1] ?? null;

async function start(deps: AccountHarness['deps'], next = '/team') {
  return getCompanySignInStart(new Request(`http://localhost:3200/api/auth/start?next=${encodeURIComponent(next)}`), deps);
}

/** The callback as the server sees it behind a load balancer: an internal address, not the registered one. */
function callback(query: URLSearchParams | string, signInCookie: string | null) {
  const headers = new Headers();
  if (signInCookie !== null) headers.set('cookie', `__Host-raagents_signin=${signInCookie}`);
  return new Request(`http://10.0.0.5:8501/api/auth/callback?${query.toString()}`, { headers });
}

/** Start, sign in at the provider, come back. Returns the callback's answer, and what the browser held. */
async function signIn(ctx: { provider: FakeProvider; harness: AccountHarness }, next = '/team') {
  const started = await start(ctx.harness.deps, next);
  const cookie = signInCookieOf(started);
  const query = ctx.provider.authorize(new URL(location(started)));
  const response = await getCompanySignInCallback(callback(query, cookie), ctx.harness.deps);
  return { response, cookie, query };
}

describe('getCompanySignInStart', () => {
  it('sends the browser to the provider with PKCE, state and nonce, and a short-lived private cookie', async () => {
    const { harness } = setup();
    const response = await start(harness.deps);
    expect(response.status).toBe(303);
    const target = new URL(location(response));
    expect(target.origin + target.pathname).toBe('https://idp.example.test/authorize');
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('state')).toMatch(/.{20,}/);
    expect(target.searchParams.get('nonce')).toMatch(/.{20,}/);
    const cookie = cookies(response).find((line) => line.startsWith('__Host-raagents_signin='))!;
    expect(cookie).toMatch(/^__Host-raagents_signin=[A-Za-z0-9_-]{43};/);
    for (const part of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) expect(cookie).toContain(part);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('goes back to the login page when the provider cannot be reached', async () => {
    const { provider, harness } = setup();
    provider.state.up = false;
    const response = await start(harness.deps);
    expect(location(response)).toBe('/login?error=provider&next=%2Fteam');
    expect(signInCookieOf(response) ?? '').toBe('');
  });

  it('does not exist without company sign-in, and says sign-in is not set up when the settings are broken', async () => {
    const off = accountHarness({ setting: { state: 'off' } });
    const withPasswords = accountHarness();
    const broken = accountHarness({ setting: { state: 'misconfigured', reason: 'x' } });
    harnesses.push(off, withPasswords, broken);
    expect((await start(off.deps)).status).toBe(404);
    expect((await start(withPasswords.deps)).status).toBe(404);
    expect(location(await start(broken.deps))).toBe('/login?error=setup');
  });
});

describe('getCompanySignInCallback', () => {
  it('callback signs in a listed person and binds them', async () => {
    const ctx = setup();
    const { response } = await signIn(ctx);
    expect(response.status).toBe(303);
    expect(location(response)).toBe('/team');
    const sessionValue = /__Host-raagents_session=([^;]+)/.exec(cookies(response).join('\n'))?.[1] ?? '';
    expect(sessionValue).toMatch(/^.{43}$/);
    expect(ctx.harness.store.findSession(sessionValue)).toMatchObject({ username: 'jane.doe', role: 'member', displayName: 'Jane Doe' });
    expect(ctx.harness.store.findIdentityAccount('jane.doe@example.test')).toMatchObject({ subject: 'sub-jane', issuer: 'https://idp.example.test' });
    expect(cookies(response).some((line) => line.startsWith('__Host-raagents_signin=;') && line.includes('Max-Age=0'))).toBe(true);
  });

  it('callback matches e-mail without regard to case', async () => {
    const ctx = setup();
    ctx.provider.state.person = { ...ctx.provider.state.person, email: 'JANE.DOE@EXAMPLE.TEST' };
    expect(location((await signIn(ctx)).response)).toBe('/team');
  });

  it('gives the admin from the settings the admin role', async () => {
    const ctx = setup();
    ctx.provider.state.person = { sub: 'sub-owner', email: 'Owner@Example.test', name: 'Owner' };
    const { response } = await signIn(ctx, '/admin');
    expect(location(response)).toBe('/admin');
    const sessionValue = /__Host-raagents_session=([^;]+)/.exec(cookies(response).join('\n'))![1];
    expect(ctx.harness.store.findSession(sessionValue)).toMatchObject({ username: 'admin', role: 'admin', managedBy: 'server' });
  });

  it('callback refuses a second subject for a bound e-mail', async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.provider.state.person = { ...ctx.provider.state.person, sub: 'sub-someone-else' };
    const { response } = await signIn(ctx);
    expect(location(response)).toBe('/login?error=identity_mismatch&next=%2Fteam');
    expect(cookies(response).join('\n')).not.toContain('__Host-raagents_session=');
    const kinds = ctx.harness.db.prepare(`SELECT kind FROM account_identity_events ORDER BY id`).all().map((row) => (row as { kind: string }).kind);
    expect(kinds.at(-1)).toBe('refused_mismatch');
  });

  it('after the admin re-invites a person whose identity changed at the provider, they sign in again', async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.provider.state.person = { ...ctx.provider.state.person, sub: 'sub-jane-recreated' };
    expect(location((await signIn(ctx)).response)).toBe('/login?error=identity_mismatch&next=%2Fteam');
    ctx.harness.store.reinvitePerson({ username: 'jane.doe', actor: 'admin' });
    expect(location((await signIn(ctx)).response)).toBe('/team');
    expect(ctx.harness.store.findIdentityAccount('jane.doe@example.test')?.subject).toBe('sub-jane-recreated');
  });

  it('refuses a person who is not on the list', async () => {
    const ctx = setup();
    ctx.provider.state.person = { sub: 'sub-john', email: 'john@example.test', name: 'John' };
    const { response } = await signIn(ctx);
    expect(location(response)).toBe('/login?error=not_listed&next=%2Fteam');
    expect(cookies(response).join('\n')).not.toContain('__Host-raagents_session=');
  });

  it('refuses a disabled person and records it', async () => {
    const ctx = setup();
    ctx.harness.store.setPersonDisabled({ username: 'jane.doe', disabled: true, actor: 'admin' });
    const { response } = await signIn(ctx);
    expect(location(response)).toBe('/login?error=disabled&next=%2Fteam');
    const kinds = ctx.harness.db.prepare(`SELECT kind FROM account_identity_events ORDER BY id`).all().map((row) => (row as { kind: string }).kind);
    expect(kinds.at(-1)).toBe('refused_disabled');
  });

  it('refuses the admin account of earlier settings once the settings name another admin username', async () => {
    const ctx = setup('owner');
    ctx.provider.state.person = { sub: 'sub-owner', email: ADMIN_EMAIL, name: 'Owner' };
    expect(location((await signIn(ctx)).response)).toBe('/login?error=not_listed&next=%2Fteam');
  });

  it('says the sign-in went stale when the transaction is missing, used twice or older than 10 minutes', async () => {
    const ctx = setup();
    const { query, cookie } = await signIn(ctx);
    expect(location(await getCompanySignInCallback(callback(query, cookie), ctx.harness.deps))).toBe('/login?error=stale');
    expect(location(await getCompanySignInCallback(callback(query, null), ctx.harness.deps))).toBe('/login?error=stale');
    expect(location(await getCompanySignInCallback(callback(query, 'not-a-transaction'), ctx.harness.deps))).toBe('/login?error=stale');

    const started = await start(ctx.harness.deps);
    const late = ctx.provider.authorize(new URL(location(started)));
    ctx.harness.advance(10 * 60 * 1000 + 1);
    expect(location(await getCompanySignInCallback(callback(late, signInCookieOf(started)), ctx.harness.deps))).toBe('/login?error=stale');
  });

  it('callback provider error goes back to the login page and logs the code only', async () => {
    const ctx = setup();
    ctx.provider.state.next = { tokenStatus: 500 };
    const { response, query } = await signIn(ctx);
    expect(location(response)).toBe('/login?error=provider&next=%2Fteam');
    const logged = JSON.stringify([...ctx.log.warn.mock.calls, ...ctx.log.error.mock.calls]);
    expect(logged).toContain('provider');
    for (const secret of [query.get('code')!, query.get('state')!, 'jane', 'Jane']) expect(logged).not.toContain(secret);
  });

  it('two tabs signing in at once: the tab whose sign-in was replaced is told to sign in again, the other signs in', async () => {
    const ctx = setup();
    const tabA = await start(ctx.harness.deps);
    const tabB = await start(ctx.harness.deps);
    // The browser keeps one sign-in cookie: tab B's start replaced tab A's.
    const cookie = signInCookieOf(tabB);
    const answerA = ctx.provider.authorize(new URL(location(tabA)));
    const answerB = ctx.provider.authorize(new URL(location(tabB)));
    expect(location(await getCompanySignInCallback(callback(answerA, cookie), ctx.harness.deps))).toBe('/login?error=stale');
    expect(location(await getCompanySignInCallback(callback(answerB, cookie), ctx.harness.deps))).toBe('/team');
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it('a refusal sent with another sign-in\'s state cannot use up the sign-in in progress', async () => {
    const ctx = setup();
    const started = await start(ctx.harness.deps);
    const cookie = signInCookieOf(started);
    const forged = new URLSearchParams({ error: 'access_denied', state: 'not-this-sign-in' });
    expect(location(await getCompanySignInCallback(callback(forged, cookie), ctx.harness.deps))).toBe('/login?error=stale');
    const answer = ctx.provider.authorize(new URL(location(started)));
    expect(location(await getCompanySignInCallback(callback(answer, cookie), ctx.harness.deps))).toBe('/team');
  });

  it('says the person declined at the provider', async () => {
    const ctx = setup();
    const started = await start(ctx.harness.deps);
    const state = new URL(location(started)).searchParams.get('state')!;
    const response = await getCompanySignInCallback(callback(new URLSearchParams({ error: 'access_denied', state }), signInCookieOf(started)), ctx.harness.deps);
    expect(location(response)).toBe('/login?error=denied&next=%2Fteam');
  });

  it('keeps every sign-in on this site: a next that leaves it becomes /', async () => {
    for (const next of ['https://elsewhere.example.test/', '//elsewhere.example.test/x', '/\\elsewhere']) {
      const ctx = setup();
      expect(location((await signIn(ctx, next)).response), next).toBe('/');
    }
  });

  it('logs no e-mail, name, code or token on any refusal', async () => {
    const ctx = setup();
    await signIn(ctx);
    ctx.provider.state.person = { ...ctx.provider.state.person, sub: 'sub-someone-else' };
    await signIn(ctx);
    ctx.provider.state.person = { sub: 'sub-john', email: 'john@example.test', name: 'John Smith' };
    await signIn(ctx);
    const logged = JSON.stringify([...ctx.log.warn.mock.calls, ...ctx.log.error.mock.calls]);
    for (const secret of ['jane', 'Jane', 'john', 'John', 'example.test', 'sub-']) expect(logged).not.toContain(secret);
  });

  it('does not exist without company sign-in', async () => {
    const withPasswords = accountHarness();
    harnesses.push(withPasswords);
    expect((await getCompanySignInCallback(callback('code=x&state=y', null), withPasswords.deps)).status).toBe(404);
  });
});

describe('the login and password pages with company sign-in', () => {
  it('the login page has the company button and no password field', async () => {
    const { harness } = setup();
    const html = await getLoginPage(new Request('http://localhost:3200/login?next=%2Fteam'), harness.deps).text();
    expect(html).toContain('href="/api/auth/start?next=%2Fteam"');
    expect(html).toContain('Sign in with your company account');
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toContain('action="/api/login"');
  });

  it('escapes the label from the settings', async () => {
    const setting = companySetting();
    if (setting.state === 'on' && setting.method === 'oidc') setting.oidc.label = '<b>Go</b>';
    const harness = accountHarness({ setting });
    harnesses.push(harness);
    const html = await getLoginPage(new Request('http://localhost:3200/login'), harness.deps).text();
    expect(html).toContain('&lt;b&gt;Go&lt;/b&gt;');
  });

  it('shows the plain sentence for each company sign-in refusal', async () => {
    const { harness } = setup();
    for (const code of ['not_listed', 'disabled', 'identity_mismatch', 'stale', 'provider', 'denied', 'no_email', 'unverified_email']) {
      const html = await getLoginPage(new Request(`http://localhost:3200/login?error=${code}`), harness.deps).text();
      expect(html, code).toMatch(/role="alert">[^<]{20,}</);
    }
  });

  it('the password page and its API do not exist with company sign-in', async () => {
    const ctx = setup();
    const { response } = await signIn(ctx);
    const sessionValue = /__Host-raagents_session=([^;]+)/.exec(cookies(response).join('\n'))![1];
    expect(getPasswordPage(withSession('/account/password', sessionValue), ctx.harness.deps).status).toBe(404);
    const post = formPost('/api/account/password', { current: 'x', password: 'y', repeat: 'y' }, { cookie: `__Host-raagents_session=${sessionValue}` });
    expect((await postPassword(post, ctx.harness.deps)).status).toBe(404);
  });
});
