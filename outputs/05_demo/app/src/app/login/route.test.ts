import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

function open(query = ''): Request {
  return new Request(`http://localhost:3200/login${query}`);
}

function gateOn() {
  vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
  vi.stubEnv('RAAGENTS_SESSION_SECRET', 'a-session-secret-of-at-least-32-chars!');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /login', () => {
  it('sends the person home when there is no access gate', async () => {
    const response = await GET(open());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/');
  });

  it('serves a password form that posts to the sign-in route and carries where the person was going', async () => {
    gateOn();
    const response = await GET(open('?next=%2Fteam'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/login"/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*name="password"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/team"/);
  });

  it('drops a return path that could leave the site before it reaches the form', async () => {
    gateOn();
    const html = await (await GET(open(`?next=${encodeURIComponent('//evil.example/x')}`))).text();
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="next"[^>]*value="\/"/);
    expect(html).not.toContain('evil.example');
  });

  it('escapes the return path so it cannot inject markup', async () => {
    gateOn();
    const html = await (await GET(open(`?next=${encodeURIComponent('/team"><script>alert(1)</script>')}`))).text();
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('says why the last attempt failed', async () => {
    gateOn();
    expect(await (await GET(open('?error=wrong'))).text()).toMatch(/That password is not right/);
    expect(await (await GET(open('?error=locked'))).text()).toMatch(/Too many failed sign-ins/);
  });

  it('says sign-in is not set up when the session secret is missing', async () => {
    vi.stubEnv('RAAGENTS_ACCESS_PASSWORD', 'open sesame');
    expect(await (await GET(open())).text()).toMatch(/Sign-in is not set up/);
  });

  it('shows the hosted notice, escaped', async () => {
    gateOn();
    vi.stubEnv('RAAGENTS_HOSTED_NOTICE', 'Practice copy <b>only</b>');
    const html = await (await GET(open())).text();
    expect(html).toContain('Practice copy &lt;b&gt;only&lt;/b&gt;');
  });
});
