import { ACCESS_COOKIE, readAccessSetting } from '@/server/access-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign-out for a hosted copy: clears this browser's session cookie and shows the login page. */
export async function POST(request: Request): Promise<Response> {
  const plain = (status: number, text: string) =>
    new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (readAccessSetting(process.env).state === 'off') return plain(404, 'Not found.');
  if ((request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase() !== 'same-origin') {
    return plain(403, 'Forbidden: sign out from this site.');
  }
  const headers = new Headers({ Location: '/login', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', `${ACCESS_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 303, headers });
}
