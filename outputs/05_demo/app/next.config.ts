import type { NextConfig } from 'next';

// Parallel builders set NEXT_DIST_DIR=.next-<label> so their builds never collide.
// Only ".next" or ".next-<label>" is accepted: those are the names .gitignore,
// ESLint and the type check already leave out.
function distDirFromEnv(value: string | undefined): string {
  if (value === undefined || value === '') return '.next';
  if (!/^\.next(-[A-Za-z0-9_-]+)?$/.test(value)) {
    throw new Error(
      `NEXT_DIST_DIR must be ".next" or ".next-<label>" (letters, digits, "-" or "_"); got "${value}"`,
    );
  }
  return value;
}

// Sent on every route. X-Frame-Options is SAMEORIGIN, as frame-ancestors 'self' below: only the app itself may frame it.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Content-Security-Policy for every route, with no exception. Everything loads from this
// origin only, and the app frames nothing. 'unsafe-inline' stays for scripts and styles because Next.js writes inline
// hydration scripts and the components use style attributes; per-request nonces would be
// stricter and are deferred. There is no 'unsafe-eval' on purpose: only `next dev` (React's
// debugging stacks, hot reload) needs it, and the demo never runs dev. Under `npm run dev` the
// browser console can therefore report blocked eval. A build and `npm start` are unaffected.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Gzip buffers server-sent events, so streamed replies would arrive in bursts.
  compress: false,
  poweredByHeader: false,
  distDir: distDirFromEnv(process.env.NEXT_DIST_DIR),
  async headers() {
    // "/:path*" matches "/" and every nested path: pages, API routes and static files.
    return [
      { source: '/:path*', headers: [...SECURITY_HEADERS, { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }] },
    ];
  },
};

export default nextConfig;
