import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '@/proxy';
import { decideRequest, type GateInput } from '@/server/request-gate';

// Mutation sweep, guard 8 (BUILD-LEARNINGS Part 9.11): the Host-header gate and the Origin
// check. request-gate.test.ts and proxy.test.ts pin the decision table. Two edges stayed green
// when changed: the Origin's scheme, and the X-Forwarded-Host header being passed from the
// request into the decision.

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(host: string, origin: string, extra: Partial<GateInput> = {}): GateInput {
  return { method: 'POST', host, origin, ...extra };
}

describe('decideRequest: the scheme of an Origin', () => {
  it('lets an http Origin with the same host and port through (positive control)', () => {
    expect(decideRequest(post('localhost:3200', 'http://localhost:3200'), {})).toEqual({ allow: true });
  });

  it.each(['ftp://localhost:3200', 'ws://localhost:3200', 'chrome-extension://localhost:3200'])(
    'answers 403 to %s: only http and https Origins can match a Host',
    (origin) => {
      expect(decideRequest(post('localhost:3200', origin), {})).toMatchObject({ allow: false, status: 403 });
    },
  );
});

describe('proxy: X-Forwarded-Host', () => {
  function forwardedPost(headers: Record<string, string> = {}): NextRequest {
    return new NextRequest('http://localhost:3200/api/rooms/team/turns', {
      method: 'POST',
      headers: { host: 'localhost:3200', origin: 'https://app.example.test', ...headers },
    });
  }

  it('hands the header to the gate: behind a proxy, the forwarded host is the one the Origin must match', async () => {
    vi.stubEnv('HOST', '0.0.0.0');

    expect((await proxy(forwardedPost({ 'x-forwarded-host': 'app.example.test' }))).headers.get('x-middleware-next')).toBe('1');
  });

  it('still answers 403 when the forwarded host is another name, or when there is no forwarded host at all', async () => {
    vi.stubEnv('HOST', '0.0.0.0');

    expect((await proxy(forwardedPost({ 'x-forwarded-host': 'other.example.test' }))).status).toBe(403);
    expect((await proxy(forwardedPost())).status).toBe(403);
  });

  it('ignores the header on a loopback bind, where nothing sits in front of the server', async () => {
    expect((await proxy(forwardedPost({ 'x-forwarded-host': 'app.example.test' }))).status).toBe(403);
  });
});
