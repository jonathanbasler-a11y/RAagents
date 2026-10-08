import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Serves UX mockup v2 for the workspace page's frame: the single offline HTML file in the repo,
// read from disk on every request and sent byte for byte. Another session maintains that file;
// this module never changes or copies it, and never fetches anything.

/** From the app folder (the working directory of next build, next start and vitest). */
const DEFAULT_MOCKUP_FILE = join('..', 'ux-mockup', 'index.html');

/** Shown on the error pages instead of a server path. */
const MOCKUP_REPO_PATH = 'outputs/05_demo/ux-mockup/index.html';

/**
 * The mockup runs its own inline script and styles, and nothing else: it can fetch nothing,
 * submit no form and load no plugin. Only the app may frame it, and the browser sandboxes it
 * even when it is opened on its own, so it never runs with the app's origin.
 */
export const MOCKUP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ');

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': MOCKUP_CSP,
  'X-Content-Type-Options': 'nosniff',
} as const;

export interface ServeMockupOptions {
  /** The file to serve. Default: resolveMockupPath(). */
  path?: string;
  /** Whether MOCKUP_HTML_PATH chose the file; it changes the missing-file advice. Default: whether it is set. */
  fromEnv?: boolean;
  /** Where a read failure goes, with the full path. Default: console (the server log). */
  log?: Pick<Console, 'error'>;
  /** The reference shown on an error page and logged with the failure. Default: a random UUID. */
  newId?: () => string;
}

function pathFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const value = env.MOCKUP_HTML_PATH?.trim();
  return value ? value : undefined;
}

/** MOCKUP_HTML_PATH (relative paths from the app folder) if set, else ../ux-mockup/index.html from the app folder. */
export function resolveMockupPath(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = process.cwd()): string {
  // A runtime path: the ignore comment keeps Turbopack from tracing the whole project.
  return resolve(/* turbopackIgnore: true */ cwd, pathFromEnv(env) ?? DEFAULT_MOCKUP_FILE);
}

/** The mockup file as HTML (200), or a plain error page: 404 when the file is missing, 500 when it cannot be read. */
export async function serveMockupHtml(options: ServeMockupOptions = {}): Promise<Response> {
  const path = options.path ?? resolveMockupPath();
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ path);
    return new Response(new Uint8Array(bytes), { status: 200, headers: HTML_HEADERS });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const missing = code === 'ENOENT' || code === 'ENOTDIR';
    const reference = (options.newId ?? randomUUID)();
    (options.log ?? console).error(
      `[workspace] mockup file ${missing ? 'not found' : 'could not be read'}: ${path} (${code ?? String(error)}; correlation ${reference})`,
    );
    const fromEnv = options.fromEnv ?? pathFromEnv(process.env) !== undefined;
    return new Response(missing ? missingPage(fromEnv, reference) : unreadablePage(reference), {
      status: missing ? 404 : 500,
      headers: HTML_HEADERS,
    });
  }
}

function missingPage(fromEnv: boolean, reference: string): string {
  return errorPage('The workspace mockup could not be found', [
    fromEnv
      ? 'MOCKUP_HTML_PATH is set, and the file it names is not there.'
      : `The workspace shows the clickable mockup from <code>${MOCKUP_REPO_PATH}</code>, next to the app folder. That file is not there.`,
    `To fix it, start the app from <code>outputs/05_demo/app</code> in a full copy of the repository, or set <code>MOCKUP_HTML_PATH</code> to the mockup file. Then reload this page.`,
    'The live team chat does not need this file.',
    `Reference <code>${escapeHtml(reference)}</code>: the server log has the path the app looked at.`,
  ]);
}

function unreadablePage(reference: string): string {
  return errorPage('The workspace mockup could not be read', [
    `Something at the mockup’s location (<code>${MOCKUP_REPO_PATH}</code>, or <code>MOCKUP_HTML_PATH</code> if set) could not be read as a file.`,
    'The live team chat does not need this file.',
    `Reference <code>${escapeHtml(reference)}</code>: the server log has the details.`,
  ]);
}

function errorPage(title: string, paragraphs: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;background:#eef1f4;color:#172233;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
main{max-width:640px;margin:48px auto;padding:20px 24px;background:#fbfcfd;border:1px solid #c2362b;border-radius:4px}
h1{font:400 24px/1.2 'Iowan Old Style','Charter',Georgia,serif;margin:0 0 12px}
p{margin:8px 0}
code{font:13px ui-monospace,'SF Mono',Menlo,Consolas,monospace;background:rgba(23,34,51,.05);padding:0 .3em;border-radius:3px}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')}
</main>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
