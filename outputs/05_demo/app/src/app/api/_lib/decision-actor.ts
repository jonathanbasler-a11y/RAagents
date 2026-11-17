import 'server-only';
import { countedSession, readAccessSetting, type AccessEnv } from '@/server/access-gate';
import { isSessionToken } from '@/server/accounts/session-lookup';
import { decisionActor, type SessionView } from '@/shared/accounts';
import { LOCAL_PERSON } from '@/shared/contracts';
import { sessionTokenFrom } from './account-http';
import type { Decider } from './deps';

// Who makes a decision that a handler records: the person behind the request's session cookie, as the server reads it.
// A name in the request body is never used. Without sign-in it is the local, unauthenticated person; with sign-in on and
// no person the session counts (none, expired, a one-time password still to replace, the admin of earlier settings, or a
// session that cannot be read), it is nobody, and the handler refuses with 401.

export function deciderFor(request: Request, env: AccessEnv, lookup: (token: string) => SessionView | null): Decider {
  const setting = readAccessSetting(env);
  if (setting.state === 'off') return { kind: 'local' };
  const token = sessionTokenFrom(request);
  if (token === null || !isSessionToken(token)) return { kind: 'nobody' };
  let session: SessionView | null;
  try {
    session = countedSession(setting, lookup(token));
  } catch {
    return { kind: 'nobody' };
  }
  if (session === null || session.mustChangePassword) return { kind: 'nobody' };
  return { kind: 'person', actor: decisionActor(session) };
}

/** The name to record, or null when nobody may decide. */
export function actorOf(decider: Decider): string | null {
  if (decider.kind === 'local') return LOCAL_PERSON;
  return decider.kind === 'person' ? decider.actor : null;
}
