import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_DENIAL_MESSAGES, SESSION_COOKIE, decideAccess, readAccessSetting } from '@/server/access-gate';
import { findSessionForProxy } from '@/server/accounts/session-lookup';
import { decideRequest } from '@/server/request-gate';

// Next.js 16's request gate (the former middleware.ts). With no `matcher` it runs before every request: pages, /api routes
// and static assets. Two gates, in order: the host and origin checks (server/request-gate.ts), then sign-in, which is off
// unless an admin password is set (server/access-gate.ts). With sign-in off, nothing here reads a cookie or the database.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const decision = decideRequest(
    {
      method: request.method,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      forwardedHost: request.headers.get('x-forwarded-host'),
    },
    process.env,
  );
  if (!decision.allow) {
    return new NextResponse(decision.message, {
      status: decision.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const setting = readAccessSetting(process.env);
  if (setting.state === 'off') return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const access = decideAccess(
    { method: request.method, pathname: request.nextUrl.pathname, search: request.nextUrl.search },
    setting,
    () => findSessionForProxy(token, new Date()),
  );
  if (access.kind === 'allow') return NextResponse.next();
  if (access.kind === 'login' || access.kind === 'change-password') {
    // The login or password page in place of the page asked for: an internal rewrite, so no Location header. Next.js
    // parses a Location set here as a full URL (a relative one fails the request), and behind a load balancer the URL
    // this server sees names its own internal address.
    const response = NextResponse.rewrite(new URL(access.path, request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const message = ACCESS_DENIAL_MESSAGES[access.error];
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse(message, { status: access.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(
    { error: access.error, message, correlationId: crypto.randomUUID() },
    { status: access.status, headers: { 'Cache-Control': 'no-store' } },
  );
}
