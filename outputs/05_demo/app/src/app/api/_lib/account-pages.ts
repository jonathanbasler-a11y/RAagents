import 'server-only';

// The two pages a person sees before the app itself: sign-in, and choosing a password. Plain HTML with forms that post
// to the API, so they work without any script, and routes rather than React pages: the app shell's providers load
// workspace data, and none of that may run before sign-in or before a one-time password is replaced.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Why the last sign-in did not work. A Map, so a query value such as "constructor" finds nothing rather than an object member. */
export const LOGIN_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['wrong', 'That username and password do not match.'],
  ['locked', 'Too many failed sign-ins. Wait 15 minutes and try again.'],
  ['expired', 'Your one-time password has expired. Ask the admin for a new one.'],
  ['busy', 'The server is busy checking other sign-ins. Try again in a moment.'],
  ['setup', 'Sign-in is not set up on this server. Ask the person who runs it.'],
  ['ended', 'Your sign-in has ended. Sign in again.'],
]);

/** Why the last password change did not work. */
export const PASSWORD_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['wrong', 'Your current password is not right.'],
  ['mismatch', 'The two new passwords are not the same.'],
  ['locked', 'Too many wrong attempts. Wait 15 minutes and try again.'],
  ['expired', 'Your one-time password has expired. Ask the admin for a new one.'],
  ['busy', 'The server is busy. Try again in a moment.'],
  ['server', 'This password is set in the server settings and cannot be changed here.'],
  ['too_short', 'Choose at least 12 characters. A short sentence works well.'],
  ['too_long', 'Choose at most 128 characters.'],
  ['repeated', 'Choose a password that is not one character repeated.'],
  ['contains_username', 'Choose a password that does not contain your username.'],
  ['same_as_current', 'Choose a password different from the one you have now.'],
]);

const STYLE = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1d2433; }
  main { max-width: 26rem; margin: 12vh auto; padding: 2rem; background: #fff; border: 1px solid #d9dde5; border-radius: 10px; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  .notice { font-size: 0.9rem; background: #fff7e0; border: 1px solid #f0d58a; padding: 0.6rem 0.8rem; border-radius: 6px; }
  .message { color: #a1261b; font-weight: 600; }
  .hint { font-size: 0.9rem; color: #4a5468; }
  label { display: block; margin: 1rem 0 0.4rem; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 0.55rem; font-size: 1rem; }
  button { margin-top: 1rem; padding: 0.55rem 1.1rem; font-size: 1rem; }
`;

function shell(title: string, notice: string, message: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Digital Human Hybrid Team</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Digital Human Hybrid Team</h1>
${notice === '' ? '' : `<p class="notice">${escapeHtml(notice)}</p>`}
${message === '' ? '' : `<p class="message" role="alert">${escapeHtml(message)}</p>`}
${body}
</main>
</body>
</html>
`;
}

export function loginPage(input: { notice: string; message: string; next: string }): string {
  return shell(
    'Sign in',
    input.notice,
    input.message,
    `<form method="post" action="/api/login">
<input type="hidden" name="next" value="${escapeHtml(input.next)}">
<label for="username">Username</label>
<input type="text" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
<label for="password">Password</label>
<input type="password" id="password" name="password" autocomplete="current-password" required>
<button type="submit">Sign in</button>
</form>`,
  );
}

export function passwordPage(input: {
  notice: string;
  message: string;
  next: string;
  username: string;
  /** The admin from the server settings: nothing to change here. */
  serverManaged: boolean;
  /** Still holds a one-time password. */
  mustChange: boolean;
}): string {
  if (input.serverManaged) {
    return shell(
      'Your password',
      input.notice,
      input.message,
      `<p>Signed in as <strong>${escapeHtml(input.username)}</strong>.</p>
<p>Your password is set in the server settings and cannot be changed here.</p>
<p><a href="/">Back to the app</a></p>`,
    );
  }
  const intro = input.mustChange
    ? `<p>Welcome, <strong>${escapeHtml(input.username)}</strong>. Choose your own password before you start. Your one-time password stops working once you have.</p>`
    : `<p>Signed in as <strong>${escapeHtml(input.username)}</strong>. Choose a new password. You stay signed in here; other browsers are signed out.</p>`;
  return shell(
    'Choose your password',
    input.notice,
    input.message,
    `${intro}
<form method="post" action="/api/account/password">
<input type="hidden" name="next" value="${escapeHtml(input.next)}">
<input type="text" name="username" value="${escapeHtml(input.username)}" autocomplete="username" hidden>
<label for="current">${input.mustChange ? 'One-time password' : 'Current password'}</label>
<input type="password" id="current" name="current" autocomplete="current-password" required autofocus>
<label for="password">New password</label>
<input type="password" id="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" required>
<p class="hint">At least 12 characters. A short sentence works well.</p>
<label for="repeat">New password again</label>
<input type="password" id="repeat" name="repeat" autocomplete="new-password" required>
<button type="submit">Save my password</button>
</form>
${input.mustChange ? '' : '<p><a href="/">Back to the app</a></p>'}`,
  );
}
