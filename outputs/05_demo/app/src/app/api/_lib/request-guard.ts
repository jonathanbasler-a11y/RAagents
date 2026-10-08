import 'server-only';

// The same-origin guard for every POST (plan, Design section 6). A browser marks its own
// requests with Sec-Fetch-Site; only "same-origin" passes, and only with a JSON content
// type, so a cross-site form or a text/plain "simple request" can never start a turn or
// write a row. Callers run it first, before reading the body or touching anything.

export type GuardResult = { ok: true } | { ok: false; reason: 'not_same_origin' | 'not_json' };

/** Media type of the Content-Type header, lower-cased, without parameters. */
function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

export function checkSameOriginJson(request: Request): GuardResult {
  if ((request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase() !== 'same-origin') {
    return { ok: false, reason: 'not_same_origin' };
  }
  if (mediaType(request) !== 'application/json') return { ok: false, reason: 'not_json' };
  return { ok: true };
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; message: string };

/** Largest request body the API reads. A question is at most 8,000 characters. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Reads and parses a JSON body, refusing more than `maxBytes` without reading the rest. */
export async function readJsonBody(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<JsonBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, message: 'The request body is too large.' };
  if (request.body === null) return { ok: false, message: 'The request body must be JSON.' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, message: 'The request body is too large.' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, message: 'The request body must be JSON.' };
  }
}
