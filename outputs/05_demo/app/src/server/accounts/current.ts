import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readAccessSetting, type AccessEnv } from '@/server/access-gate';
import type { SessionView, ShellAccount } from '@/shared/accounts';
import { getAccountStore } from './runtime';

// Who is signed in, for server components (the root layout and the People page). The proxy has already refused requests
// without a session; this is the second check, where the page renders: the layout mounts the app shell and the agent
// roster only for a valid session, so a path that slips past the proxy (an unknown path's not-found page) renders bare.

export type CurrentAccount = { signIn: 'off' } | { signIn: 'on'; session: SessionView | null };

/** Whether sign-in is on, and the person behind the session cookie. Reads no cookie when sign-in is off. */
export async function currentAccount(env: AccessEnv = process.env): Promise<CurrentAccount> {
  const setting = readAccessSetting(env);
  if (setting.state === 'off') return { signIn: 'off' };
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  if (token === null || setting.state === 'misconfigured') return { signIn: 'on', session: null };
  try {
    const session = getAccountStore().findSession(token);
    // As in the proxy (access-gate.ts): an admin the settings no longer name is no one, and a person who must still
    // replace a one-time password gets the password page, not the app.
    if (session === null || session.mustChangePassword) return { signIn: 'on', session: null };
    if (session.managedBy === 'server' && session.username !== setting.admin.username) return { signIn: 'on', session: null };
    return { signIn: 'on', session };
  } catch {
    return { signIn: 'on', session: null };
  }
}

/** What the root layout renders: the shell (with the account line when sign-in is on), or the page alone. */
export function layoutPlan(current: CurrentAccount): { shell: false } | { shell: true; account: ShellAccount | undefined } {
  if (current.signIn === 'off') return { shell: true, account: undefined };
  if (current.session === null) return { shell: false };
  return {
    shell: true,
    account: {
      username: current.session.username,
      isAdmin: current.session.role === 'admin',
      canChangePassword: current.session.managedBy === 'app',
    },
  };
}
