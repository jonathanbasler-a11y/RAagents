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

const nextConfig: NextConfig = {
  // Gzip buffers server-sent events, so streamed replies would arrive in bursts.
  compress: false,
  poweredByHeader: false,
  distDir: distDirFromEnv(process.env.NEXT_DIST_DIR),
};

export default nextConfig;
