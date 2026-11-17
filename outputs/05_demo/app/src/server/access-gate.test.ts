import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { SessionView } from '@/shared/accounts';
import {
  CLEAR_SESSION_COOKIE,
  SESSION_COOKIE,
  clientAddress,
  countedSession,
  createAttemptThrottle,
  decideAccess,
  readAccessSetting,
  safeNextPath,
  sessionCookieHeader,
  type AccessSetting,
} from './access-gate';

const ADMIN_PASSWORD = 'a-long-admin-password-1';
const ON: AccessSetting = { state: 'on', method: 'password', admin: { username: 'admin', password: ADMIN_PASSWORD }, trustedProxyHops: 0 };

const MEMBER: SessionView = {
  accountId: 'acc-member',
  username: 'member-one',
  role: 'member',
  managedBy: 'app',
  mustChangePassword: false,
  expiresAt: '2026-10-30T00:00:00.000Z',
  displayName: null,
};
const ADMIN: SessionView = { ...MEMBER, accountId: 'acc-admin', username: 'admin', role: 'admin', managedBy: 'server' };

function request(method: string, pathname: string, search = '') {
  return { method, pathname, search };
}

function never(): never {
  throw new Error('the session lookup was called');
}

describe('readAccessSetting', () => {
  it('is off when no admin password is set, so local use is unchanged', () => {
    expect(readAccessSetting({})).toEqual({ state: 'off' });
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: '' })).toEqual({ state: 'off' });
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: '   ' })).toEqual({ state: 'off' });
    expect(readAccessSetting({ RAAGENTS_REQUIRE_SIGN_IN: '0' })).toEqual({ state: 'off' });
  });

  it('locks, never opens, when sign-in is required but no admin password is set', () => {
    expect(readAccessSetting({ RAAGENTS_REQUIRE_SIGN_IN: '1' }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_REQUIRE_SIGN_IN: 'yes', RAAGENTS_ADMIN_PASSWORD: ' ' }).state).toBe('misconfigured');
  });

  it('locks when only the old shared-password settings are set', () => {
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: 'open sesame' }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_SESSION_SECRET: 'x'.repeat(40) }).state).toBe('misconfigured');
  });

  it('locks a short admin password', () => {
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: 'x'.repeat(15) }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: 'x'.repeat(16) }).state).toBe('on');
  });

  it('locks an admin username the accounts table would refuse', () => {
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, RAAGENTS_ADMIN_USERNAME: 'the owner' }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, RAAGENTS_ADMIN_USERNAME: 'server' }).state).toBe('misconfigured');
  });

  it('locks a trusted-proxy setting other than 0 or 1', () => {
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, RAAGENTS_TRUSTED_PROXY_HOPS: '2' }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, RAAGENTS_TRUSTED_PROXY_HOPS: 'yes' }).state).toBe('misconfigured');
  });

  it('is on with the admin password, defaulting the admin username to "admin" and trusting no proxy', () => {
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD })).toEqual(ON);
  });

  it('trims the settings, which secret stores often end with a newline, and lower-cases the username', () => {
    expect(
      readAccessSetting({
        RAAGENTS_ADMIN_PASSWORD: `${ADMIN_PASSWORD}\n`,
        RAAGENTS_ADMIN_USERNAME: ' Owner ',
        RAAGENTS_TRUSTED_PROXY_HOPS: '1',
      }),
    ).toEqual({ state: 'on', method: 'password', admin: { username: 'owner', password: ADMIN_PASSWORD }, trustedProxyHops: 1 });
  });

  it('ignores the old settings once an admin password is set', () => {
    expect(readAccessSetting({ RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD, RAAGENTS_ACCESS_PASSWORD: 'old' })).toEqual(ON);
  });
});

const COMPANY_ENV = {
  RAAGENTS_OIDC_ISSUER: 'https://idp.example.test',
  RAAGENTS_OIDC_CLIENT_ID: 'client-123',
  RAAGENTS_OIDC_REDIRECT_URI: 'https://app.example.test/api/auth/callback',
  RAAGENTS_ADMIN_EMAIL: ' Owner@Example.TEST \n',
} as const;

const reasonOf = (setting: AccessSetting) => (setting.state === 'misconfigured' ? setting.reason : `not locked: ${setting.state}`);

describe('readAccessSetting with company sign-in', () => {
  it('company sign-in is on with issuer, client id, redirect and admin e-mail', () => {
    expect(readAccessSetting(COMPANY_ENV)).toEqual({
      state: 'on',
      method: 'oidc',
      admin: { username: 'admin', email: 'owner@example.test' },
      oidc: {
        issuer: 'https://idp.example.test',
        clientId: 'client-123',
        redirectUri: 'https://app.example.test/api/auth/callback',
        scopes: 'openid email profile',
        emailClaim: 'email',
        label: 'Sign in with your company account',
      },
      trustedProxyHops: 0,
    });
  });

  it('takes the optional scopes, e-mail claim, label, admin username and proxy setting', () => {
    const setting = readAccessSetting({
      ...COMPANY_ENV,
      RAAGENTS_OIDC_SCOPES: '  openid   email ',
      RAAGENTS_OIDC_EMAIL_CLAIM: 'upn',
      RAAGENTS_OIDC_LABEL: ' Sign in with Example ',
      RAAGENTS_ADMIN_USERNAME: 'Owner',
      RAAGENTS_TRUSTED_PROXY_HOPS: '1',
    });
    expect(setting).toMatchObject({
      state: 'on',
      method: 'oidc',
      admin: { username: 'owner', email: 'owner@example.test' },
      oidc: { scopes: 'openid email', emailClaim: 'upn', label: 'Sign in with Example' },
      trustedProxyHops: 1,
    });
  });

  it('accepts a callback on this computer over plain http', () => {
    for (const redirect of ['http://localhost:3200/api/auth/callback', 'http://127.0.0.1:3200/api/auth/callback']) {
      expect(readAccessSetting({ ...COMPANY_ENV, RAAGENTS_OIDC_REDIRECT_URI: redirect }).state, redirect).toBe('on');
    }
  });

  it('a password set as well locks the app', () => {
    const setting = readAccessSetting({ ...COMPANY_ENV, RAAGENTS_ADMIN_PASSWORD: ADMIN_PASSWORD });
    expect(setting.state).toBe('misconfigured');
    expect(reasonOf(setting)).toContain('RAAGENTS_ADMIN_PASSWORD');
  });

  it.each([
    ['a missing client id', { RAAGENTS_OIDC_CLIENT_ID: ' ' }, 'RAAGENTS_OIDC_CLIENT_ID'],
    ['a client id with a space', { RAAGENTS_OIDC_CLIENT_ID: 'client 123' }, 'RAAGENTS_OIDC_CLIENT_ID'],
    ['a missing admin e-mail', { RAAGENTS_ADMIN_EMAIL: '' }, 'RAAGENTS_ADMIN_EMAIL'],
    ['an admin e-mail without @', { RAAGENTS_ADMIN_EMAIL: 'owner.example.test' }, 'RAAGENTS_ADMIN_EMAIL'],
    ['an issuer that is not https', { RAAGENTS_OIDC_ISSUER: 'http://idp.example.test' }, 'RAAGENTS_OIDC_ISSUER'],
    ['an issuer that is not a web address', { RAAGENTS_OIDC_ISSUER: 'idp.example.test' }, 'RAAGENTS_OIDC_ISSUER'],
    ['a missing redirect', { RAAGENTS_OIDC_REDIRECT_URI: '' }, 'RAAGENTS_OIDC_REDIRECT_URI'],
    ['a redirect whose path is not the callback', { RAAGENTS_OIDC_REDIRECT_URI: 'https://app.example.test/callback' }, 'RAAGENTS_OIDC_REDIRECT_URI'],
    ['a redirect with a query', { RAAGENTS_OIDC_REDIRECT_URI: 'https://app.example.test/api/auth/callback?x=1' }, 'RAAGENTS_OIDC_REDIRECT_URI'],
    ['an http redirect on another host', { RAAGENTS_OIDC_REDIRECT_URI: 'http://app.example.test/api/auth/callback' }, 'RAAGENTS_OIDC_REDIRECT_URI'],
    ['scopes without openid', { RAAGENTS_OIDC_SCOPES: 'email profile' }, 'RAAGENTS_OIDC_SCOPES'],
    ['an e-mail claim that is not a plain name', { RAAGENTS_OIDC_EMAIL_CLAIM: 'e mail' }, 'RAAGENTS_OIDC_EMAIL_CLAIM'],
    ['a label over 60 characters', { RAAGENTS_OIDC_LABEL: 'x'.repeat(61) }, 'RAAGENTS_OIDC_LABEL'],
    ['an admin username the accounts table would refuse', { RAAGENTS_ADMIN_USERNAME: 'the owner' }, 'RAAGENTS_ADMIN_USERNAME'],
    ['a trusted-proxy setting other than 0 or 1', { RAAGENTS_TRUSTED_PROXY_HOPS: '2' }, 'RAAGENTS_TRUSTED_PROXY_HOPS'],
  ])('locks the app for %s', (_name, change, named) => {
    const setting = readAccessSetting({ ...COMPANY_ENV, ...change });
    expect(setting.state).toBe('misconfigured');
    expect(reasonOf(setting)).toContain(named);
  });

  it('locks, never opens, when company settings are set but the issuer is missing', () => {
    for (const name of ['RAAGENTS_OIDC_CLIENT_ID', 'RAAGENTS_OIDC_REDIRECT_URI', 'RAAGENTS_ADMIN_EMAIL', 'RAAGENTS_OIDC_LABEL']) {
      const setting = readAccessSetting({ [name]: 'something' });
      expect(setting.state, name).toBe('misconfigured');
      expect(reasonOf(setting), name).toContain('RAAGENTS_OIDC_ISSUER');
    }
  });

  it('RAAGENTS_REQUIRE_SIGN_IN with neither method names both settings', () => {
    const reason = reasonOf(readAccessSetting({ RAAGENTS_REQUIRE_SIGN_IN: '1' }));
    expect(reason).toContain('RAAGENTS_ADMIN_PASSWORD');
    expect(reason).toContain('RAAGENTS_OIDC_ISSUER');
  });

  it('counts a server-admin session only under the username the settings name, as with passwords', () => {
    const setting = readAccessSetting(COMPANY_ENV);
    expect(countedSession(setting, ADMIN)).toEqual(ADMIN);
    expect(countedSession(setting, { ...ADMIN, username: 'old-admin' })).toBeNull();
    expect(countedSession(setting, MEMBER)).toEqual(MEMBER);
  });
});

describe('the settings template (env.example)', () => {
  it('leaves sign-in and the hosted wording off, as copied', () => {
    const template = parseEnv(readFileSync(fileURLToPath(new URL('../../env.example', import.meta.url)), 'utf8'));
    expect(template).toHaveProperty('RAAGENTS_ADMIN_PASSWORD', '');
    expect(readAccessSetting(template)).toEqual({ state: 'off' });
    expect(template.RAAGENTS_HOSTED_NOTICE).toBe('');
    expect(template.LITESTREAM_REPLICA_URL).toBe('');
  });
});

describe('decideAccess', () => {
  it('lets everything through when the gate is off, without looking for a session', () => {
    const off: AccessSetting = { state: 'off' };
    expect(decideAccess(request('GET', '/'), off, never)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('POST', '/api/rooms/team/turns'), off, never)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('GET', '/admin'), off, never)).toEqual({ kind: 'allow' });
  });

  it('leaves the health check, the login page, sign-in and sign-out open, without looking for a session', () => {
    for (const [method, pathname] of [
      ['GET', '/api/health'],
      ['HEAD', '/api/health'],
      ['GET', '/login'],
      ['HEAD', '/login'],
      ['POST', '/api/login'],
      ['POST', '/api/logout'],
    ]) {
      expect(decideAccess(request(method, pathname), ON, never), `${method} ${pathname}`).toEqual({ kind: 'allow' });
    }
  });

  it('opens those paths only for their own methods and exact spelling', () => {
    const noSession = () => null;
    expect(decideAccess(request('POST', '/api/health'), ON, noSession).kind).toBe('deny');
    expect(decideAccess(request('GET', '/api/login'), ON, noSession).kind).toBe('deny');
    expect(decideAccess(request('PUT', '/api/login'), ON, noSession).kind).toBe('deny');
    expect(decideAccess(request('DELETE', '/api/logout'), ON, noSession).kind).toBe('deny');
    expect(decideAccess(request('GET', '/api/health-report'), ON, noSession).kind).toBe('deny');
    expect(decideAccess(request('GET', '/login-help'), ON, noSession).kind).toBe('login');
    expect(decideAccess(request('GET', '/%6Cogin'), ON, noSession).kind).toBe('login');
  });

  it('shows the login page for a page request without a session, keeping where it was going', () => {
    expect(decideAccess(request('GET', '/'), ON, () => null)).toEqual({ kind: 'login', path: '/login?next=%2F' });
    expect(decideAccess(request('GET', '/team', '?thread=t1'), ON, () => null)).toEqual({
      kind: 'login',
      path: '/login?next=%2Fteam%3Fthread%3Dt1',
    });
  });

  it('answers 401 to an API request without a session, reads and model calls alike', () => {
    const denied = { kind: 'deny', status: 401, error: 'sign_in_required' };
    expect(decideAccess(request('GET', '/api/rooms/team/messages'), ON, () => null)).toEqual(denied);
    expect(decideAccess(request('POST', '/api/rooms/team/turns'), ON, () => null)).toEqual(denied);
    expect(decideAccess(request('POST', '/team'), ON, () => null)).toEqual(denied);
  });

  it('keeps static files and avatars behind the gate too', () => {
    expect(decideAccess(request('GET', '/_next/static/chunks/app.js'), ON, () => null).kind).toBe('login');
    expect(decideAccess(request('GET', '/avatars/rosa.svg'), ON, () => null).kind).toBe('login');
  });

  it('lets a person with a valid session through', () => {
    expect(decideAccess(request('GET', '/team'), ON, () => MEMBER)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('POST', '/api/rooms/team/turns'), ON, () => MEMBER)).toEqual({ kind: 'allow' });
  });

  it('treats a session of a former server admin, under another name, as no session', () => {
    const former: SessionView = { ...ADMIN, username: 'old-admin' };
    expect(decideAccess(request('GET', '/team'), ON, () => former).kind).toBe('login');
    expect(decideAccess(request('GET', '/team'), ON, () => ADMIN)).toEqual({ kind: 'allow' });
  });

  it('limits a session that must choose its own password to the password page', () => {
    const waiting: SessionView = { ...MEMBER, mustChangePassword: true };
    expect(decideAccess(request('GET', '/account/password'), ON, () => waiting)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('POST', '/api/account/password'), ON, () => waiting)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('GET', '/team', '?x=1'), ON, () => waiting)).toEqual({
      kind: 'change-password',
      path: '/account/password?next=%2Fteam%3Fx%3D1',
    });
    expect(decideAccess(request('GET', '/api/selection'), ON, () => waiting)).toEqual({
      kind: 'deny',
      status: 403,
      error: 'password_change_required',
    });
  });

  it('refuses admin paths to a member, however the path is spelled', () => {
    const adminOnly = { kind: 'deny', status: 403, error: 'admin_only' };
    for (const pathname of ['/admin', '/admin/people', '/api/admin/people', '/api/admin/people/member-two', '/%61dmin', '/ADMIN', '/api/%61dmin/people']) {
      expect(decideAccess(request('GET', pathname), ON, () => MEMBER), pathname).toEqual(adminOnly);
    }
    expect(decideAccess(request('POST', '/api/admin/people'), ON, () => MEMBER)).toEqual(adminOnly);
  });

  it('refuses a path whose escapes cannot be decoded rather than guessing', () => {
    expect(decideAccess(request('GET', '/%E0%A4%A'), ON, () => MEMBER)).toEqual({ kind: 'deny', status: 403, error: 'admin_only' });
  });

  it('lets the admin reach the admin paths', () => {
    expect(decideAccess(request('GET', '/admin'), ON, () => ADMIN)).toEqual({ kind: 'allow' });
    expect(decideAccess(request('POST', '/api/admin/people'), ON, () => ADMIN)).toEqual({ kind: 'allow' });
  });

  it('treats a misconfigured gate as closed', () => {
    const broken: AccessSetting = { state: 'misconfigured', reason: 'no admin password' };
    expect(decideAccess(request('GET', '/'), broken, never)).toEqual({ kind: 'login', path: '/login?next=%2F' });
    expect(decideAccess(request('POST', '/api/rooms/team/turns'), broken, never)).toEqual({ kind: 'deny', status: 401, error: 'sign_in_required' });
    expect(decideAccess(request('GET', '/api/health'), broken, never)).toEqual({ kind: 'allow' });
  });
});

describe('countedSession', () => {
  it('is the session itself when sign-in is on', () => {
    expect(countedSession(ON, MEMBER)).toBe(MEMBER);
    expect(countedSession(ON, ADMIN)).toBe(ADMIN);
  });

  it('is nobody while sign-in is off or misconfigured, whatever the cookie says', () => {
    expect(countedSession({ state: 'off' }, MEMBER)).toBeNull();
    expect(countedSession({ state: 'misconfigured', reason: 'x' }, ADMIN)).toBeNull();
    expect(countedSession(ON, null)).toBeNull();
  });

  it('is nobody for a server admin under a name the settings no longer use', () => {
    expect(countedSession(ON, { ...ADMIN, username: 'old-admin' })).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/team')).toBe('/team');
    expect(safeNextPath('/findings?item=x')).toBe('/findings?item=x');
  });

  it('falls back to the home page for anything that could leave the site or loop', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'team',
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/login',
      '/login?next=/',
      '/api/login',
      '/api',
      '/_next/static/chunks/app.js',
      '/account/password',
      '/team\u0000',
      '/team\nx',
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe('/');
    }
  });

  it('returns a path that fits in a Location header, whatever was typed', () => {
    expect(safeNextPath('/日')).toBe('/%E6%97%A5');
    expect(safeNextPath('/team?q=é')).toBe('/team?q=%C3%A9');
  });
});

describe('clientAddress', () => {
  it('trusts no forwarded address when no proxy is trusted', () => {
    expect(clientAddress('203.0.113.7', 0)).toBeNull();
  });

  it('takes the entry the load balancer added: the right-most one', () => {
    expect(clientAddress('198.51.100.1, 203.0.113.7', 1)).toBe('203.0.113.7');
    expect(clientAddress('2001:db8::1', 1)).toBe('2001:db8::1');
  });

  it('ignores a missing or malformed entry, and an address with a port', () => {
    expect(clientAddress('1.2.3.4:5678', 1)).toBeNull();
    expect(clientAddress(null, 1)).toBeNull();
    expect(clientAddress('', 1)).toBeNull();
    expect(clientAddress('203.0.113.7, not-an-address', 1)).toBeNull();
    expect(clientAddress('999.0.0.1', 1)).toBeNull();
  });
});

describe('createAttemptThrottle', () => {
  const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

  it('refuses further attempts once a key has spent its budget, until the window passes', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 3; i++) expect(throttle.reserve([{ key: 'user:a', limit: 3 }], NOW)).not.toBeNull();
    expect(throttle.reserve([{ key: 'user:a', limit: 3 }], NOW + 999)).toBeNull();
    expect(throttle.reserve([{ key: 'user:a', limit: 3 }], NOW + 1000)).not.toBeNull();
  });

  it('reserves before any await: attempts made at once cannot get past the budget', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 100 });
    const tickets = Array.from({ length: 50 }, () => throttle.reserve([{ key: 'user:a', limit: 5 }], NOW));
    expect(tickets.filter((ticket) => ticket !== null)).toHaveLength(5);
  });

  it('gives a reservation back on success, so a right password costs nothing', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 10; i++) throttle.reserve([{ key: 'user:a', limit: 2 }], NOW)?.refund();
    expect(throttle.reserve([{ key: 'user:a', limit: 2 }], NOW)).not.toBeNull();
  });

  it('gives a reservation back once, however often refund is called', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 100 });
    for (let i = 0; i < 2; i++) throttle.reserve([{ key: 'user:a', limit: 3 }], NOW);
    const ticket = throttle.reserve([{ key: 'user:a', limit: 3 }], NOW);
    ticket?.refund();
    ticket?.refund();
    expect(throttle.reserve([{ key: 'user:a', limit: 3 }], NOW)).not.toBeNull();
    expect(throttle.reserve([{ key: 'user:a', limit: 3 }], NOW)).toBeNull();
  });

  it('refuses when any one of the keys is over its budget, and then records nothing', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 100 });
    throttle.reserve([{ key: 'client:x', limit: 1 }], NOW);
    expect(throttle.reserve([{ key: 'user:a', limit: 5 }, { key: 'client:x', limit: 1 }], NOW)).toBeNull();
    for (let i = 0; i < 5; i++) expect(throttle.reserve([{ key: 'user:a', limit: 5 }], NOW)).not.toBeNull();
  });

  it('keeps at most maxKeys keys, dropping the least recently used', () => {
    const throttle = createAttemptThrottle({ windowMs: 1000, maxKeys: 2 });
    throttle.reserve([{ key: 'k1', limit: 1 }], NOW);
    throttle.reserve([{ key: 'k2', limit: 1 }], NOW);
    throttle.reserve([{ key: 'k3', limit: 1 }], NOW);
    expect(throttle.size()).toBe(2);
    expect(throttle.reserve([{ key: 'k1', limit: 1 }], NOW)).not.toBeNull();
    expect(throttle.reserve([{ key: 'k3', limit: 1 }], NOW)).toBeNull();
  });
});

describe('session cookie', () => {
  it('is host-only, script-proof, sent only over HTTPS and kept for the session length', () => {
    expect(sessionCookieHeader('tok')).toBe(`${SESSION_COOKIE}=tok; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(CLEAR_SESSION_COOKIE).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  });

  it('is never built from a token that could break the header', () => {
    expect(() => sessionCookieHeader('a;b')).toThrow();
  });
});
