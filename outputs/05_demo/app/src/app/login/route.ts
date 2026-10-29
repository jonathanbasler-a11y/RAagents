import { readAccessSetting, safeNextPath } from '@/server/access-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The login page of a hosted copy. A route, not a page, on purpose: the root layout mounts the
// app shell, whose providers load workspace data, and none of that may run before sign-in.
// Plain HTML with a form that posts to /api/login, so it works without any script.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MESSAGES: Record<string, string> = {
  wrong: 'That password is not right.',
  locked: 'Too many failed sign-ins. Wait a few minutes and try again.',
  setup: 'Sign-in is not set up on this server. Ask the person who runs it.',
};

export function GET(request: Request): Response {
  const setting = readAccessSetting(process.env);
  if (setting.state === 'off') {
    return new Response(null, { status: 307, headers: { Location: '/', 'Cache-Control': 'no-store' } });
  }
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const message =
    setting.state === 'misconfigured' ? MESSAGES.setup : (MESSAGES[url.searchParams.get('error') ?? ''] ?? '');
  const notice = (process.env.RAAGENTS_HOSTED_NOTICE ?? '').trim();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Digital Human Hybrid Team</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1d2433; }
  main { max-width: 26rem; margin: 12vh auto; padding: 2rem; background: #fff; border: 1px solid #d9dde5; border-radius: 10px; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  .notice { font-size: 0.9rem; background: #fff7e0; border: 1px solid #f0d58a; padding: 0.6rem 0.8rem; border-radius: 6px; }
  .message { color: #a1261b; font-weight: 600; }
  label { display: block; margin: 1rem 0 0.4rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 0.55rem; font-size: 1rem; }
  button { margin-top: 1rem; padding: 0.55rem 1.1rem; font-size: 1rem; }
</style>
</head>
<body>
<main>
<h1>Digital Human Hybrid Team</h1>
${notice === '' ? '' : `<p class="notice">${escapeHtml(notice)}</p>`}
${message === '' ? '' : `<p class="message" role="alert">${escapeHtml(message)}</p>`}
<form method="post" action="/api/login">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="password">Access password</label>
<input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button>
</form>
</main>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
