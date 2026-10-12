import { NextResponse, type NextRequest } from 'next/server';
import { decideRequest } from '@/server/request-gate';

// Next.js 16's request gate (the former middleware.ts). With no `matcher` it runs before every
// request: pages, /api routes and static assets. Why and how it decides: server/request-gate.ts.
export function proxy(request: NextRequest): NextResponse {
  const decision = decideRequest(
    {
      method: request.method,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      forwardedHost: request.headers.get('x-forwarded-host'),
    },
    process.env,
  );
  if (decision.allow) return NextResponse.next();
  return new NextResponse(decision.message, {
    status: decision.status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
