import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';

// Hardening: every route carries the same small set of security headers, and every route
// except the mockup also carries a Content-Security-Policy. The mockup route (frame content of
// /workspace) sends its own, stricter CSP (see src/app/workspace/_lib/mockup-html.ts); a second
// CSP header would be intersected with it, so the rule below leaves that one route out.

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const ALL_ROUTES = '/:path*';

async function rules(): Promise<HeaderRule[]> {
  if (typeof nextConfig.headers !== 'function') throw new Error('next.config.ts must define headers()');
  return (await nextConfig.headers()) as HeaderRule[];
}

function toRecord(rule: HeaderRule): Record<string, string> {
  return Object.fromEntries(rule.headers.map((header) => [header.key, header.value]));
}

async function headersFor(source: string): Promise<Record<string, string>> {
  const rule = (await rules()).find((candidate) => candidate.source === source);
  if (!rule) throw new Error(`no header rule for ${source}`);
  return toRecord(rule);
}

/** The headers a request path would receive, matching sources the way Next.js does (path-to-regexp). */
async function headersAt(requestPath: string): Promise<Record<string, string>> {
  const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
    pathToRegexp: (source: string) => RegExp;
  };
  const received: Record<string, string> = {};
  for (const rule of await rules()) {
    if (pathToRegexp(rule.source).test(requestPath)) Object.assign(received, toRecord(rule));
  }
  return received;
}

const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

describe('security headers', () => {
  it('has one rule for every route with the four base headers, once each', async () => {
    const all = await rules();
    const base = all.find((rule) => rule.source === ALL_ROUTES);

    expect(base).toBeDefined();
    // "/:path*" matches "/" and every nested path: pages, API routes and static files.
    const keys = base!.headers.map((header) => header.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(await headersFor(ALL_ROUTES)).toEqual(BASE_HEADERS);
  });

  it('sets the base headers on every kind of route, the mockup included', async () => {
    for (const requestPath of ['/', '/team', '/chat/dara', '/workspace', '/workspace/mockup', '/api/health', '/_next/static/chunks/app.js', '/avatars/dara.svg']) {
      expect(await headersAt(requestPath)).toMatchObject(BASE_HEADERS);
    }
  });

  it('keeps the frame policy loose enough for the workspace page, which frames the mockup from the same origin', async () => {
    const headers = await headersAt('/workspace');

    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(Object.values(headers).join(' ')).not.toMatch(/\bDENY\b/i);
    expect(headers['Content-Security-Policy']).toContain("frame-src 'self'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'self'");
  });
});

describe('Content-Security-Policy', () => {
  it('is the agreed policy, as one header, on pages, API routes and static files', async () => {
    for (const requestPath of ['/', '/team', '/chat/dara', '/workspace', '/workspace/other', '/api/health', '/api/rooms/team/turns', '/_next/static/chunks/app.js', '/avatars/dara.svg']) {
      expect((await headersAt(requestPath))['Content-Security-Policy']).toBe(EXPECTED_CSP);
    }
    const sources = (await rules()).filter((rule) => rule.headers.some((header) => header.key === 'Content-Security-Policy'));
    expect(sources).toHaveLength(1);
    expect(sources[0].headers).toHaveLength(1);
  });

  it('is left off /workspace/mockup (with and without a trailing slash), which sends its own', async () => {
    expect(await headersAt('/workspace/mockup')).not.toHaveProperty('Content-Security-Policy');
    expect(await headersAt('/workspace/mockup/')).not.toHaveProperty('Content-Security-Policy');
  });

  it('still covers look-alike paths of the mockup (positive control for the exclusion)', async () => {
    for (const requestPath of ['/workspace/mockups', '/workspace/mockup-v2', '/workspace', '/mockup']) {
      expect((await headersAt(requestPath))['Content-Security-Policy']).toBe(EXPECTED_CSP);
    }
  });

  it('allows only this origin for scripts, connections, frames, forms and images (plus data: images)', () => {
    const directives = new Map(EXPECTED_CSP.split('; ').map((part) => [part.split(' ')[0], part.split(' ').slice(1)]));

    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('connect-src')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    // The pages use inline scripts and styles (Next.js hydration data, style attributes). Per-request
    // nonces would be stricter but are deferred. 'unsafe-eval' is left out on purpose: only
    // `next dev` needs it, and the demo never runs dev.
    expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(EXPECTED_CSP).not.toMatch(/unsafe-eval|https?:|\*/);
  });
});

describe('the rest of the config is unchanged', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('keeps compress and poweredByHeader off', () => {
    // compress off: gzip buffers server-sent events, so streamed replies would arrive in bursts.
    expect(nextConfig.compress).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  async function distDirFor(value: string | undefined): Promise<string | undefined> {
    vi.resetModules();
    vi.stubEnv('NEXT_DIST_DIR', value);
    const fresh = (await import('../../next.config')).default;
    return fresh.distDir;
  }

  it('uses .next unless NEXT_DIST_DIR names a .next-<label> folder', async () => {
    expect(await distDirFor(undefined)).toBe('.next');
    expect(await distDirFor('')).toBe('.next');
    expect(await distDirFor('.next-harden1')).toBe('.next-harden1');
  });

  it('refuses a NEXT_DIST_DIR outside the .next naming scheme', async () => {
    await expect(distDirFor('../elsewhere')).rejects.toThrow(/NEXT_DIST_DIR/);
  });
});
