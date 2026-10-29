import {
  ACCESS_COOKIE,
  SESSION_TTL_MS,
  createAccessToken,
  createLoginThrottle,
  passwordMatches,
  readAccessSetting,
  safeNextPath,
} from '@/server/access-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sign-in for a hosted copy (server/access-gate.ts). The login page posts a plain HTML form
// here, so the body is form-encoded, not JSON. Every answer is a 303 back to a page: the
// destination after the right password, the login page with a reason otherwise.

const MAX_BODY_BYTES = 8 * 1024;
// One budget for everyone, so guessing is bounded whatever address a request claims.
const throttle = createLoginThrottle({ limit: 20, windowMs: 15 * 60 * 1000 });

function seeOther(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie !== undefined) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function backToLogin(error: 'wrong' | 'locked' | 'setup', next: string): Response {
  const query = new URLSearchParams({ error });
  if (next !== '/') query.set('next', next);
  return seeOther(`/login?${query.toString()}`);
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** The body as text, or null when it is larger than `maxBytes` (stops reading at the limit). */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request): Promise<Response> {
  const setting = readAccessSetting(process.env);
  if (setting.state === 'off') return plain(404, 'Not found.');
  if ((request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase() !== 'same-origin') {
    return plain(403, 'Forbidden: sign in from this site.');
  }

  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null) return plain(413, 'The request body is too large.');
  const fields = new URLSearchParams(body);
  const next = safeNextPath(fields.get('next'));

  if (setting.state === 'misconfigured') return backToLogin('setup', next);
  const now = Date.now();
  if (!throttle.allowed(now)) return backToLogin('locked', next);

  if (await passwordMatches(fields.get('password') ?? '', setting.password)) {
    const token = await createAccessToken(setting.secret, now);
    const cookie = `${ACCESS_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
    return seeOther(next, cookie);
  }
  throttle.recordFailure(now);
  return backToLogin('wrong', next);
}
