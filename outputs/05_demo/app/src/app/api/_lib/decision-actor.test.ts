import { describe, expect, it } from 'vitest';
import { LOCAL_PERSON } from '@/shared/contracts';
import type { SessionView } from '@/shared/accounts';
import { actorOf, deciderFor } from './decision-actor';

// Who decides, from the server's own session: never from the request body.

const TOKEN = 'S'.repeat(43);
const PASSWORD_ENV = { RAAGENTS_ADMIN_PASSWORD: 'a-long-admin-password-1' };
const COMPANY_ENV = {
  RAAGENTS_OIDC_ISSUER: 'https://idp.example.test',
  RAAGENTS_OIDC_CLIENT_ID: 'client-123',
  RAAGENTS_OIDC_REDIRECT_URI: 'https://app.example.test/api/auth/callback',
  RAAGENTS_ADMIN_EMAIL: 'owner@example.test',
};
const JANE: SessionView = {
  accountId: 'acc-jane',
  username: 'jane.doe',
  role: 'member',
  managedBy: 'app',
  mustChangePassword: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
  displayName: 'Jane Doe',
  signIn: 'company',
};
const withCookie = (cookie: string | null) => new Request('http://localhost:3200/api/gates/scope/decision', cookie === null ? {} : { headers: { cookie } });
const lookupOnly = (session: SessionView | null) => (cookieValue: string) => (cookieValue === TOKEN ? session : null);

describe('deciderFor', () => {
  it('is the local person when the copy has no sign-in, without reading any cookie or session', () => {
    const lookup = () => {
      throw new Error('no session is read without sign-in');
    };
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), {}, lookup)).toEqual({ kind: 'local' });
  });

  it('is the signed-in person, named by decisionActor', () => {
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), COMPANY_ENV, lookupOnly(JANE))).toEqual({ kind: 'person', actor: 'Jane Doe (jane.doe)' });
  });

  it('is nobody with sign-in on but no cookie, an unknown session, or a misconfigured setting', () => {
    expect(deciderFor(withCookie(null), COMPANY_ENV, lookupOnly(JANE))).toEqual({ kind: 'nobody' });
    expect(deciderFor(withCookie('__Host-raagents_session=other'), COMPANY_ENV, lookupOnly(JANE))).toEqual({ kind: 'nobody' });
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), { RAAGENTS_REQUIRE_SIGN_IN: '1' }, lookupOnly(JANE))).toEqual({ kind: 'nobody' });
  });

  it('is nobody for a person who must still replace a one-time password', () => {
    const waiting = { ...JANE, mustChangePassword: true, signIn: 'password' as const, displayName: null };
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), PASSWORD_ENV, lookupOnly(waiting))).toEqual({ kind: 'nobody' });
  });

  it('is nobody for the admin of earlier settings (the counted-session rule)', () => {
    const formerAdmin = { ...JANE, username: 'old-admin', role: 'admin' as const, managedBy: 'server' as const };
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), COMPANY_ENV, lookupOnly(formerAdmin))).toEqual({ kind: 'nobody' });
  });

  it('is nobody when the session cannot be read', () => {
    const broken = () => {
      throw new Error('database locked');
    };
    expect(deciderFor(withCookie(`__Host-raagents_session=${TOKEN}`), PASSWORD_ENV, broken)).toEqual({ kind: 'nobody' });
  });
});

describe('actorOf', () => {
  it('gives the name to record, or null for nobody', () => {
    expect(actorOf({ kind: 'local' })).toBe(LOCAL_PERSON);
    expect(actorOf({ kind: 'person', actor: 'Jane Doe (jane.doe)' })).toBe('Jane Doe (jane.doe)');
    expect(actorOf({ kind: 'nobody' })).toBeNull();
  });
});
