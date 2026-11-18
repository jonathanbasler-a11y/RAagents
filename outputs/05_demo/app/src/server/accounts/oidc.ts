import 'server-only';
import { randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import type { OidcSetting } from '@/server/access-gate';
import { checkEmail, normalizeEmail } from '@/shared/accounts';

// Company sign-in through an OpenID Connect provider: the authorization code flow with PKCE, state and nonce, as a
// public client (no client secret), through openid-client. The provider proves who someone is; what they may do is
// decided by the account (src/server/accounts/store.ts) and the gate (src/server/access-gate.ts).
//
// The app keeps no provider token: the ID token's claims are read once, after the library has checked its signature,
// issuer, audience, expiry and nonce, and the tokens are dropped. A sign-in in progress is a transaction kept on the
// server for 10 minutes and taken once; the browser holds only its id, in a __Host- cookie. Nothing here logs.

/** The cookie that carries a sign-in transaction's id, between the start and the callback. */
export const OIDC_COOKIE = '__Host-raagents_signin';
export const SIGN_IN_TRANSACTION_TTL_MS = 10 * 60 * 1000;
/** Every call to the provider gives up after this many seconds. */
const PROVIDER_TIMEOUT_SECONDS = 10;
/** A failed discovery is tried again after this long, not remembered for good. */
const DISCOVERY_RETRY_MS = 60_000;

/** A sign-in in progress: what the callback must check, and where the person was going. */
export interface SignInTransaction {
  id: string;
  verifier: string;
  state: string;
  nonce: string;
  next: string;
  createdAtMs: number;
}

/** Who the provider says signed in, checked. */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  displayName: string | null;
}

export type OidcFailure = 'provider' | 'denied' | 'expired' | 'no_email' | 'unverified_email';

export interface OidcClientDeps {
  /** The fetch the library uses; tests pass an in-memory provider (oidc-test-support.ts). */
  fetch?: typeof fetch;
  now: () => Date;
}

export interface OidcClient {
  beginSignIn(setting: OidcSetting, next: string): Promise<{ ok: true; url: URL; transaction: SignInTransaction } | { ok: false; failure: 'provider' }>;
  /**
   * Checks the provider's answer. `query` is the callback's query string; the callback's address is the one in the
   * settings, never the one this server sees (behind a load balancer that is an internal address the provider does not know).
   */
  completeSignIn(
    setting: OidcSetting,
    query: URLSearchParams,
    transaction: SignInTransaction,
  ): Promise<{ ok: true; identity: VerifiedIdentity } | { ok: false; failure: OidcFailure }>;
}

type Discovered = { config: client.Configuration } | { failedAtMs: number };

export function createOidcClient(deps: OidcClientDeps): OidcClient {
  const discovered = new Map<string, Discovered>();
  const pending = new Map<string, Promise<client.Configuration | null>>();

  /** The provider's configuration, discovered once per issuer and client id; null when the provider cannot be reached. */
  async function configFor(setting: OidcSetting): Promise<client.Configuration | null> {
    const key = `${setting.issuer}\n${setting.clientId}`;
    const known = discovered.get(key);
    if (known !== undefined && 'config' in known) return known.config;
    if (known !== undefined && deps.now().getTime() - known.failedAtMs < DISCOVERY_RETRY_MS) return null;
    const running = pending.get(key);
    if (running !== undefined) return running;
    const attempt = (async () => {
      try {
        // The ID token's signature is checked against the provider's published keys too. The standard lets a client
        // skip that for a token fetched straight from the token endpoint over TLS; this app does not rely on it.
        const options: client.DiscoveryRequestOptions = { timeout: PROVIDER_TIMEOUT_SECONDS, execute: [client.enableNonRepudiationChecks] };
        if (deps.fetch !== undefined) options[client.customFetch] = deps.fetch as unknown as client.CustomFetch;
        const config = await client.discovery(new URL(setting.issuer), setting.clientId, undefined, client.None(), options);
        discovered.set(key, { config });
        return config;
      } catch {
        discovered.set(key, { failedAtMs: deps.now().getTime() });
        return null;
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, attempt);
    return attempt;
  }

  return {
    async beginSignIn(setting, next) {
      const config = await configFor(setting);
      if (config === null) return { ok: false, failure: 'provider' };
      const verifier = client.randomPKCECodeVerifier();
      const transaction: SignInTransaction = {
        id: randomBytes(32).toString('base64url'),
        verifier,
        // Always state and nonce, whatever the provider says it supports.
        state: client.randomState(),
        nonce: client.randomNonce(),
        next,
        createdAtMs: deps.now().getTime(),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: setting.redirectUri,
        scope: setting.scopes,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state: transaction.state,
        nonce: transaction.nonce,
      });
      return { ok: true, url, transaction };
    },

    async completeSignIn(setting, query, transaction) {
      const error = query.get('error');
      if (error !== null) return { ok: false, failure: error === 'access_denied' ? 'denied' : 'provider' };
      const config = await configFor(setting);
      if (config === null) return { ok: false, failure: 'provider' };
      const callback = new URL(setting.redirectUri);
      callback.search = query.toString();
      let claims: Record<string, unknown> | undefined;
      try {
        const tokens = await client.authorizationCodeGrant(config, callback, {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          // With a nonce to check, the library requires an ID token (so idTokenExpected would change nothing).
          expectedNonce: transaction.nonce,
        });
        claims = tokens.claims();
      } catch {
        // A wrong state or code, a token that fails its checks, or a provider that is down: no identity, and no detail
        // that could carry a code or a token anywhere.
        return { ok: false, failure: 'provider' };
      }
      if (claims === undefined || typeof claims.iss !== 'string' || typeof claims.sub !== 'string' || claims.sub === '') {
        return { ok: false, failure: 'provider' };
      }
      const raw = claims[setting.emailClaim];
      const email = typeof raw === 'string' ? normalizeEmail(raw) : '';
      if (email === '' || !checkEmail(email).ok) return { ok: false, failure: 'no_email' };
      if (claims.email_verified === false) return { ok: false, failure: 'unverified_email' };
      const name = typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name : null;
      return { ok: true, identity: { issuer: claims.iss, subject: claims.sub, email, displayName: name } };
    },
  };
}

export interface TransactionStore {
  put(transaction: SignInTransaction): void;
  /**
   * The transaction, once, if `state` is its state; null when unknown, already taken or older than the time limit. A
   * transaction asked for with another state stays: the browser holds one sign-in cookie, so a second tab's start
   * replaces it, and the answer to that second start must still find its transaction.
   */
  take(id: string, state: string, nowMs: number): SignInTransaction | null;
}

/** Sign-ins in progress, in this process's memory (one server process; a restart only means signing in again). */
export function createTransactionStore(options: { ttlMs: number; maxEntries: number }): TransactionStore {
  const held = new Map<string, SignInTransaction>();
  return {
    put(transaction) {
      while (held.size >= options.maxEntries) {
        const oldest = held.keys().next();
        if (oldest.done) break;
        held.delete(oldest.value);
      }
      held.set(transaction.id, transaction);
    },
    take(id, state, nowMs) {
      const transaction = held.get(id);
      if (transaction === undefined) return null;
      if (nowMs - transaction.createdAtMs > options.ttlMs) {
        held.delete(id);
        return null;
      }
      if (transaction.state !== state) return null;
      held.delete(id);
      return transaction;
    },
  };
}
