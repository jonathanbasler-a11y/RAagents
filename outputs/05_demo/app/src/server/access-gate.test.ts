import { describe, expect, it } from 'vitest';
import {
  createAccessToken,
  createLoginThrottle,
  decideAccess,
  passwordMatches,
  readAccessSetting,
  safeNextPath,
  type AccessSetting,
} from './access-gate';

const SECRET = 'a-session-secret-of-at-least-32-chars!';
const OTHER_SECRET = 'another-secret-of-at-least-32-chars!!';
const ON: AccessSetting = { state: 'on', password: 'open sesame', secret: SECRET };
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

describe('readAccessSetting', () => {
  it('is off when no access password is set, so local use is unchanged', () => {
    expect(readAccessSetting({})).toEqual({ state: 'off' });
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: '' })).toEqual({ state: 'off' });
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: '   ' })).toEqual({ state: 'off' });
  });

  it('is misconfigured, never open, when the password is set without a long enough session secret', () => {
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: 'pw' }).state).toBe('misconfigured');
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: 'pw', RAAGENTS_SESSION_SECRET: 'short' }).state).toBe(
      'misconfigured',
    );
  });

  it('is on with both values set', () => {
    expect(readAccessSetting({ RAAGENTS_ACCESS_PASSWORD: 'pw', RAAGENTS_SESSION_SECRET: SECRET })).toEqual({
      state: 'on',
      password: 'pw',
      secret: SECRET,
    });
  });
});

describe('access tokens', () => {
  it('verify with the same secret until they expire 12 hours later', async () => {
    const token = await createAccessToken(SECRET, NOW);
    expect(await decideAccess(page('/', token), ON, NOW + 12 * HOUR - 1)).toEqual({ kind: 'allow' });
    expect((await decideAccess(page('/', token), ON, NOW + 12 * HOUR)).kind).toBe('login');
  });

  it('do not verify under another secret', async () => {
    const token = await createAccessToken(OTHER_SECRET, NOW);
    expect((await decideAccess(page('/', token), ON, NOW)).kind).toBe('login');
  });

  it('do not verify when the expiry is edited to extend them', async () => {
    const token = await createAccessToken(SECRET, NOW);
    const [version, expiry, signature] = token.split('.');
    const extended = [version, String(Number(expiry) + 100 * HOUR), signature].join('.');
    expect((await decideAccess(page('/', extended), ON, NOW + 13 * HOUR)).kind).toBe('login');
  });

  it('do not verify when malformed', async () => {
    for (const junk of ['', 'abc', 'v1..', 'v1.123', 'v1.notanumber.sig', 'v2.9999999999999.sig']) {
      expect((await decideAccess(page('/', junk), ON, NOW)).kind).toBe('login');
    }
  });
});

describe('decideAccess', () => {
  it('lets everything through when the gate is off', async () => {
    const off: AccessSetting = { state: 'off' };
    expect(await decideAccess(page('/'), off, NOW)).toEqual({ kind: 'allow' });
    expect(await decideAccess(api('POST', '/api/rooms/team/turns'), off, NOW)).toEqual({ kind: 'allow' });
  });

  it('shows the login page for a page request without a session, keeping where it was going', async () => {
    expect(await decideAccess(page('/'), ON, NOW)).toEqual({ kind: 'login', path: '/login?next=%2F' });
    expect(await decideAccess({ ...page('/team'), search: '?thread=t1' }, ON, NOW)).toEqual({
      kind: 'login',
      path: '/login?next=%2Fteam%3Fthread%3Dt1',
    });
  });

  it('answers 401 to an API request without a session, reads and model calls alike', async () => {
    expect(await decideAccess(api('GET', '/api/rooms/team/messages'), ON, NOW)).toEqual({ kind: 'deny', status: 401 });
    expect(await decideAccess(api('POST', '/api/rooms/team/turns'), ON, NOW)).toEqual({ kind: 'deny', status: 401 });
    expect(await decideAccess(api('GET', '/api/data-room/documents/d1'), ON, NOW)).toEqual({ kind: 'deny', status: 401 });
  });

  it('keeps static files and avatars behind the gate too', async () => {
    expect((await decideAccess(page('/_next/static/chunks/app.js'), ON, NOW)).kind).toBe('login');
    expect((await decideAccess(page('/avatars/rosa.svg'), ON, NOW)).kind).toBe('login');
  });

  it('leaves the health check, the login page, sign-in and sign-out open', async () => {
    expect(await decideAccess(api('GET', '/api/health'), ON, NOW)).toEqual({ kind: 'allow' });
    expect(await decideAccess(page('/login'), ON, NOW)).toEqual({ kind: 'allow' });
    expect(await decideAccess(api('POST', '/api/login'), ON, NOW)).toEqual({ kind: 'allow' });
    expect(await decideAccess(api('POST', '/api/logout'), ON, NOW)).toEqual({ kind: 'allow' });
  });

  it('does not open look-alike paths', async () => {
    expect((await decideAccess(api('GET', '/api/health-report'), ON, NOW)).kind).toBe('deny');
    expect((await decideAccess(page('/login-help'), ON, NOW)).kind).toBe('login');
    expect((await decideAccess(api('GET', '/api/login'), ON, NOW)).kind).toBe('deny');
  });

  it('lets every request through with a valid session', async () => {
    const token = await createAccessToken(SECRET, NOW);
    expect(await decideAccess(page('/', token), ON, NOW + HOUR)).toEqual({ kind: 'allow' });
    expect(await decideAccess(api('POST', '/api/rooms/team/turns', token), ON, NOW + HOUR)).toEqual({ kind: 'allow' });
  });

  it('treats a misconfigured gate as closed', async () => {
    const broken: AccessSetting = { state: 'misconfigured', reason: 'no session secret' };
    expect(await decideAccess(page('/'), broken, NOW)).toEqual({ kind: 'login', path: '/login?next=%2F' });
    expect(await decideAccess(api('POST', '/api/rooms/team/turns'), broken, NOW)).toEqual({ kind: 'deny', status: 401 });
    expect(await decideAccess(api('GET', '/api/health'), broken, NOW)).toEqual({ kind: 'allow' });
  });
});

describe('passwordMatches', () => {
  it('accepts only the exact password', async () => {
    expect(await passwordMatches('open sesame', 'open sesame')).toBe(true);
    expect(await passwordMatches('open sesame ', 'open sesame')).toBe(false);
    expect(await passwordMatches('Open sesame', 'open sesame')).toBe(false);
    expect(await passwordMatches('', 'open sesame')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/team')).toBe('/team');
    expect(safeNextPath('/findings?item=x')).toBe('/findings?item=x');
  });

  it('falls back to the home page for anything that could leave the site or loop', () => {
    for (const bad of [null, undefined, '', 'team', '//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/login', '/login?next=/', '/api/login', '/_next/static/chunks/app.js']) {
      expect(safeNextPath(bad)).toBe('/');
    }
  });
});

describe('createLoginThrottle', () => {
  it('refuses further attempts once the failure budget is spent, until the window passes', () => {
    const throttle = createLoginThrottle({ limit: 3, windowMs: 1000 });
    for (let i = 0; i < 3; i++) {
      expect(throttle.allowed(NOW)).toBe(true);
      throttle.recordFailure(NOW);
    }
    expect(throttle.allowed(NOW + 999)).toBe(false);
    expect(throttle.allowed(NOW + 1000)).toBe(true);
  });

  it('counts only failures inside the window', () => {
    const throttle = createLoginThrottle({ limit: 2, windowMs: 1000 });
    throttle.recordFailure(NOW);
    throttle.recordFailure(NOW + 600);
    expect(throttle.allowed(NOW + 900)).toBe(false);
    expect(throttle.allowed(NOW + 1000)).toBe(true); // the first failure has aged out
    throttle.recordFailure(NOW + 1000);
    expect(throttle.allowed(NOW + 1100)).toBe(false);
  });
});

function page(pathname: string, cookie: string | null = null) {
  return { method: 'GET', pathname, search: '', cookie };
}

function api(method: string, pathname: string, cookie: string | null = null) {
  return { method, pathname, search: '', cookie };
}
