import 'server-only';
import { SESSION_COOKIE } from '@/server/access-gate';

// HTTP helpers for the account routes: the login, password and admin handlers. The login and password pages are plain
// HTML forms, so their posts are form-encoded and every answer is a 303 back to a page.

export const MAX_FORM_BYTES = 8 * 1024;

/** A browser marks its own requests with Sec-Fetch-Site; only "same-origin" passes, so a form on another site cannot post here. */
export function isSameOriginRequest(request: Request): boolean {
  return (request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase() === 'same-origin';
}

/** The form fields, or null when the body is larger than `maxBytes` (stops reading at the limit). */
export async function readFormBody(request: Request, maxBytes: number = MAX_FORM_BYTES): Promise<URLSearchParams | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (request.body === null) return new URLSearchParams();
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
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

/** The session cookie's value, or null. */
export function sessionTokenFrom(request: Request): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}

export function seeOther(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie !== undefined) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export function plainText(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export function htmlPage(html: string): Response {
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
