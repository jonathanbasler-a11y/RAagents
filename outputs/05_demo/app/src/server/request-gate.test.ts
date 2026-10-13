import { describe, expect, it } from 'vitest';
import {
  decideRequest,
  exposureWarning,
  isLoopbackBind,
  matchesAllowedHost,
  parseAllowedHosts,
  parseHostHeader,
  type GateInput,
} from './request-gate';

// Fake names only: *.example.test is reserved for documentation and tests.

const get = (host: string | null, extra: Partial<GateInput> = {}): GateInput => ({
  method: 'GET',
  host,
  origin: null,
  ...extra,
});
const post = (host: string | null, origin: string | null, extra: Partial<GateInput> = {}): GateInput => ({
  method: 'POST',
  host,
  origin,
  ...extra,
});

describe('parseHostHeader', () => {
  it.each([
    ['localhost', { hostname: 'localhost', port: null }],
    ['localhost:3200', { hostname: 'localhost', port: 3200 }],
    ['LocalHost:3200', { hostname: 'localhost', port: 3200 }],
    ['127.0.0.1:80', { hostname: '127.0.0.1', port: 80 }],
    ['[::1]', { hostname: '[::1]', port: null }],
    ['[::1]:3200', { hostname: '[::1]', port: 3200 }],
    ['app.example.test:8443', { hostname: 'app.example.test', port: 8443 }],
  ])('reads %s', (value, expected) => {
    expect(parseHostHeader(value)).toEqual(expected);
  });

  it.each([
    '',
    '   ',
    'evil.example.test@localhost',
    'localhost@evil.example.test',
    'localhost/evil',
    'localhost:99999',
    'localhost:abc',
    'localhost:',
    'two words',
    'a.example.test, b.example.test',
    '[::1',
    'ho_st',
    '.example.test',
    'a..example.test',
    'localhost.',
  ])('rejects the malformed value %j', (value) => {
    expect(parseHostHeader(value)).toBeNull();
  });
});

describe('isLoopbackBind', () => {
  it.each([undefined, '', '  ', 'localhost', '127.0.0.1', '127.0.0.2', '::1', '[::1]'])('treats HOST=%j as loopback', (host) => {
    expect(isLoopbackBind(host)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '[::]', '192.168.1.20', '10.0.0.5', 'app.example.test', '1270.0.0.1'])(
    'treats HOST=%j as beyond loopback',
    (host) => {
      expect(isLoopbackBind(host)).toBe(false);
    },
  );
});

describe('parseAllowedHosts / matchesAllowedHost', () => {
  it('splits on commas, trims, lower-cases and drops empty and malformed entries', () => {
    expect(parseAllowedHosts(' App.Example.Test , *.Preview.Example.Test,, bad entry , host.example.test:3000 ')).toEqual({
      exact: ['app.example.test', 'host.example.test'],
      suffixes: ['preview.example.test'],
    });
    expect(parseAllowedHosts(undefined)).toEqual({ exact: [], suffixes: [] });
    expect(parseAllowedHosts('')).toEqual({ exact: [], suffixes: [] });
  });

  it('matches exact names only exactly', () => {
    const allowed = parseAllowedHosts('app.example.test');

    expect(matchesAllowedHost('app.example.test', allowed)).toBe(true);
    expect(matchesAllowedHost('other.app.example.test', allowed)).toBe(false);
    expect(matchesAllowedHost('example.test', allowed)).toBe(false);
    expect(matchesAllowedHost('xapp.example.test', allowed)).toBe(false);
  });

  it('matches a "*." entry against one or more labels in front, never the bare suffix or a look-alike', () => {
    const allowed = parseAllowedHosts('*.preview.example.test');

    expect(matchesAllowedHost('a.preview.example.test', allowed)).toBe(true);
    expect(matchesAllowedHost('a.b.preview.example.test', allowed)).toBe(true);
    expect(matchesAllowedHost('preview.example.test', allowed)).toBe(false);
    expect(matchesAllowedHost('apreview.example.test', allowed)).toBe(false);
    expect(matchesAllowedHost('a.preview.example.test.evil.example.test', allowed)).toBe(false);
  });
});

describe('decideRequest: loopback bind (the default)', () => {
  const env = {};

  it.each(['localhost', 'localhost:3200', '127.0.0.1', '127.0.0.1:3200', '[::1]', '[::1]:3200', 'LOCALHOST:8080'])(
    'allows Host %s on any port',
    (host) => {
      expect(decideRequest(get(host), env)).toEqual({ allow: true });
    },
  );

  it('answers 421 for a rebinding host that resolves to 127.0.0.1', () => {
    const decision = decideRequest(get('rebind.attacker.example.test:3200'), env);

    expect(decision).toMatchObject({ allow: false, status: 421 });
  });

  it('answers 421 for a missing or empty Host header', () => {
    expect(decideRequest(get(null), env)).toMatchObject({ allow: false, status: 421 });
    expect(decideRequest(get(''), env)).toMatchObject({ allow: false, status: 421 });
  });

  it.each(['evil.example.test@localhost', 'localhost.evil.example.test', 'xlocalhost', '127.0.0.1.evil.example.test', '127.0.0.2', '[::2]', '0.0.0.0'])(
    'answers 421 for the look-alike Host %s',
    (host) => {
      expect(decideRequest(get(host), env)).toMatchObject({ allow: false, status: 421 });
    },
  );

  it('answers 421 first when both the Host and the Origin are wrong', () => {
    expect(decideRequest(post('evil.example.test', 'https://evil.example.test'), env)).toMatchObject({ allow: false, status: 421 });
  });

  it('names no secret and no value in the message', () => {
    const decision = decideRequest(get('rebind.attacker.example.test'), env);

    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.message).not.toContain('attacker');
  });
});

describe('decideRequest: ALLOWED_HOSTS', () => {
  const env = { ALLOWED_HOSTS: 'app.example.test, *.preview.example.test' };

  it('allows the listed names (any port) and still allows loopback', () => {
    expect(decideRequest(get('app.example.test'), env)).toEqual({ allow: true });
    expect(decideRequest(get('app.example.test:8443'), env)).toEqual({ allow: true });
    expect(decideRequest(get('x.preview.example.test'), env)).toEqual({ allow: true });
    expect(decideRequest(get('localhost:3200'), env)).toEqual({ allow: true });
  });

  it('refuses everything else', () => {
    expect(decideRequest(get('other.example.test'), env)).toMatchObject({ allow: false, status: 421 });
    expect(decideRequest(get('preview.example.test'), env)).toMatchObject({ allow: false, status: 421 });
  });

  it('an empty ALLOWED_HOSTS adds nothing', () => {
    expect(decideRequest(get('app.example.test'), { ALLOWED_HOSTS: ' , ' })).toMatchObject({ allow: false, status: 421 });
  });
});

describe('decideRequest: server bound beyond loopback (HOST=0.0.0.0, as a hosted service does)', () => {
  const env = { HOST: '0.0.0.0' };

  it('skips the Host check when ALLOWED_HOSTS is not set, so a served hostname still works', () => {
    expect(decideRequest(get('3200-workspace.example.test'), env)).toEqual({ allow: true });
    expect(decideRequest(get(null), env)).toEqual({ allow: true });
  });

  it('applies the Host check again as soon as ALLOWED_HOSTS is set', () => {
    const restricted = { ...env, ALLOWED_HOSTS: '3200-workspace.example.test' };

    expect(decideRequest(get('3200-workspace.example.test'), restricted)).toEqual({ allow: true });
    expect(decideRequest(get('rebind.attacker.example.test'), restricted)).toMatchObject({ allow: false, status: 421 });
  });

  it('keeps the loopback rules for a loopback HOST', () => {
    expect(decideRequest(get('rebind.attacker.example.test'), { HOST: '127.0.0.1' })).toMatchObject({ allow: false, status: 421 });
    expect(decideRequest(get('rebind.attacker.example.test'), { HOST: '::1' })).toMatchObject({ allow: false, status: 421 });
  });
});

describe('decideRequest: Origin on POST', () => {
  const env = {};

  it('allows a POST whose Origin host equals the Host', () => {
    expect(decideRequest(post('localhost:3200', 'http://localhost:3200'), env)).toEqual({ allow: true });
    expect(decideRequest(post('127.0.0.1:3200', 'http://127.0.0.1:3200'), env)).toEqual({ allow: true });
    expect(decideRequest(post('[::1]:3200', 'http://[::1]:3200'), env)).toEqual({ allow: true });
  });

  it('allows a POST without an Origin header (non-browser clients, same-origin simple requests)', () => {
    expect(decideRequest(post('localhost:3200', null), env)).toEqual({ allow: true });
  });

  it('answers 403 when the Origin is another site, another port or another host name', () => {
    expect(decideRequest(post('localhost:3200', 'https://evil.example.test'), env)).toMatchObject({ allow: false, status: 403 });
    expect(decideRequest(post('localhost:3200', 'http://localhost:3201'), env)).toMatchObject({ allow: false, status: 403 });
    expect(decideRequest(post('localhost:3200', 'http://127.0.0.1:3200'), env)).toMatchObject({ allow: false, status: 403 });
  });

  it('answers 403 for an Origin that is "null" or not a URL', () => {
    expect(decideRequest(post('localhost:3200', 'null'), env)).toMatchObject({ allow: false, status: 403 });
    expect(decideRequest(post('localhost:3200', 'not a url'), env)).toMatchObject({ allow: false, status: 403 });
    expect(decideRequest(post('localhost:3200', ''), env)).toMatchObject({ allow: false, status: 403 });
  });

  it('treats a default port as equal to no port', () => {
    expect(decideRequest(post('localhost', 'http://localhost:80'), env)).toEqual({ allow: true });
    expect(decideRequest(post('localhost:80', 'http://localhost'), env)).toEqual({ allow: true });
    expect(decideRequest(post('localhost:443', 'https://localhost'), env)).toEqual({ allow: true });
    expect(decideRequest(post('localhost:443', 'http://localhost'), env)).toMatchObject({ allow: false, status: 403 });
  });

  it('does not check the Origin on a safe method', () => {
    expect(decideRequest(get('localhost:3200', { origin: 'https://evil.example.test' }), env)).toEqual({ allow: true });
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'post'])('checks the Origin on %s too', (method) => {
    expect(decideRequest({ method, host: 'localhost:3200', origin: 'https://evil.example.test' }, env)).toMatchObject({
      allow: false,
      status: 403,
    });
  });

  it('checks the Origin even when the Host check is skipped (bound beyond loopback)', () => {
    const exposed = { HOST: '0.0.0.0' };

    expect(decideRequest(post('app.example.test', 'https://app.example.test'), exposed)).toEqual({ allow: true });
    expect(decideRequest(post('app.example.test', 'https://evil.example.test'), exposed)).toMatchObject({ allow: false, status: 403 });
  });

  it('accepts the proxy-forwarded host as the match only when bound beyond loopback', () => {
    const forwarded = { forwardedHost: 'app.example.test' };

    expect(decideRequest(post('localhost:3200', 'https://app.example.test', forwarded), { HOST: '0.0.0.0' })).toEqual({ allow: true });
    // Loopback bind: nothing is in front of the server, so the header is not trusted.
    expect(decideRequest(post('localhost:3200', 'https://app.example.test', forwarded), {})).toMatchObject({ allow: false, status: 403 });
  });

  it('only reads the first value of a forwarded host list', () => {
    const decision = decideRequest(
      post('localhost:3200', 'https://evil.example.test', { forwardedHost: 'app.example.test, evil.example.test' }),
      { HOST: '0.0.0.0' },
    );

    expect(decision).toMatchObject({ allow: false, status: 403 });
  });

  it('answers 403 when an Origin is present but the Host is missing and the Host check is skipped', () => {
    expect(decideRequest(post(null, 'https://app.example.test'), { HOST: '0.0.0.0' })).toMatchObject({ allow: false, status: 403 });
  });
});

describe('exposureWarning', () => {
  it('is null for a loopback bind', () => {
    expect(exposureWarning({})).toBeNull();
    expect(exposureWarning({ HOST: '127.0.0.1' })).toBeNull();
    expect(exposureWarning({ HOST: 'localhost', ALLOWED_HOSTS: 'app.example.test' })).toBeNull();
  });

  it('warns that the port must stay private because the app has no login, and says the Host check is off', () => {
    const text = exposureWarning({ HOST: '0.0.0.0' });

    expect(text).toMatch(/no login/i);
    expect(text).toMatch(/private/i);
    expect(text).toMatch(/ALLOWED_HOSTS/);
    expect(text).toMatch(/not checked|skipped|off/i);
  });

  it('says the Host check is on when ALLOWED_HOSTS is set, and still warns', () => {
    const text = exposureWarning({ HOST: '0.0.0.0', ALLOWED_HOSTS: 'app.example.test' });

    expect(text).toMatch(/no login/i);
    expect(text).toMatch(/private/i);
    expect(text).not.toMatch(/not checked|skipped|off/i);
  });

  it('prints no host name from the settings', () => {
    expect(exposureWarning({ HOST: '10.9.8.7', ALLOWED_HOSTS: 'secret-name.example.test' })).not.toMatch(/10\.9\.8\.7|secret-name/);
  });
});
