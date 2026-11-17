import { beforeEach, describe, expect, it } from 'vitest';
import type { OidcSetting } from '@/server/access-gate';
import { OIDC_COOKIE, SIGN_IN_TRANSACTION_TTL_MS, createOidcClient, createTransactionStore, type SignInTransaction } from './oidc';
import { FAKE_CLIENT_ID, FAKE_ISSUER, FAKE_REDIRECT, createFakeProvider, type FakeProvider } from './oidc-test-support';

const SETTING: OidcSetting = {
  issuer: FAKE_ISSUER,
  clientId: FAKE_CLIENT_ID,
  redirectUri: FAKE_REDIRECT,
  scopes: 'openid email profile',
  emailClaim: 'email',
  label: 'Sign in with your company account',
};

let provider: FakeProvider;
let clock: number;
let client: ReturnType<typeof createOidcClient>;

beforeEach(() => {
  provider = createFakeProvider();
  clock = Date.parse('2026-11-17T10:00:00.000Z');
  client = createOidcClient({ fetch: provider.fetch, now: () => new Date(clock) });
});

async function begin(next = '/team') {
  const started = await client.beginSignIn(SETTING, next);
  if (!started.ok) throw new Error(`begin failed: ${started.failure}`);
  return started;
}

/** The whole round trip: start, the person signs in at the provider, the browser comes back. */
async function roundTrip(change: (query: URLSearchParams, transaction: SignInTransaction) => void = () => {}) {
  const { url, transaction } = await begin();
  const query = provider.authorize(url);
  change(query, transaction);
  return client.completeSignIn(SETTING, query, transaction);
}

describe('beginSignIn', () => {
  it('sends the browser to the provider with PKCE, state, nonce, the scopes and the registered callback', async () => {
    const { url, transaction } = await begin('/team');
    expect(url.origin + url.pathname).toBe(`${FAKE_ISSUER}/authorize`);
    const params = url.searchParams;
    expect(params.get('client_id')).toBe(FAKE_CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(FAKE_REDIRECT);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('state')).toBe(transaction.state);
    expect(params.get('nonce')).toBe(transaction.nonce);
    expect(transaction).toMatchObject({ next: '/team', createdAtMs: clock });
    expect(transaction.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get('code_challenge')).not.toBe(transaction.verifier);
  });

  it('makes new secrets for every start', async () => {
    const a = (await begin()).transaction;
    const b = (await begin()).transaction;
    expect(new Set([a.id, b.id]).size).toBe(2);
    expect(new Set([a.verifier, b.verifier]).size).toBe(2);
    expect(new Set([a.state, b.state]).size).toBe(2);
    expect(new Set([a.nonce, b.nonce]).size).toBe(2);
  });

  it('asks the provider for its settings once, not at every sign-in', async () => {
    await begin();
    await begin();
    expect(provider.state.discoveryCalls).toBe(1);
  });

  it('discovery failure is retried after a minute, not remembered for good', async () => {
    provider.state.up = false;
    expect(await client.beginSignIn(SETTING, '/')).toEqual({ ok: false, failure: 'provider' });
    provider.state.up = true;
    expect(await client.beginSignIn(SETTING, '/')).toEqual({ ok: false, failure: 'provider' });
    expect(provider.state.discoveryCalls).toBe(0);
    clock += 61_000;
    expect((await client.beginSignIn(SETTING, '/')).ok).toBe(true);
    expect(provider.state.discoveryCalls).toBe(1);
  });
});

describe('completeSignIn', () => {
  it('a full begin and complete gives the verified identity, the e-mail normalized', async () => {
    expect(await roundTrip()).toEqual({
      ok: true,
      identity: { issuer: FAKE_ISSUER, subject: 'sub-jane', email: 'jane.doe@example.test', displayName: 'Jane Doe' },
    });
    expect(provider.state.tokenCalls).toBe(1);
  });

  it('reads the e-mail from the claim the settings name', async () => {
    provider.state.person = { sub: 'sub-jane', upn: 'Jane.Doe@Example.TEST', name: 'Jane Doe' };
    const { url, transaction } = await begin();
    const result = await client.completeSignIn({ ...SETTING, emailClaim: 'upn' }, provider.authorize(url), transaction);
    expect(result).toMatchObject({ ok: true, identity: { email: 'jane.doe@example.test' } });
  });

  it('keeps no name when the provider sends none', async () => {
    provider.state.person = { sub: 'sub-jane', email: 'jane.doe@example.test' };
    expect(await roundTrip()).toMatchObject({ ok: true, identity: { displayName: null } });
  });

  it.each([
    ['a wrong state', (query: URLSearchParams) => query.set('state', 'not-the-state')],
    ['a missing code', (query: URLSearchParams) => query.delete('code')],
  ])('refuses %s, without an identity', async (_name, change) => {
    expect(await roundTrip(change)).toEqual({ ok: false, failure: 'provider' });
  });

  it('refuses a code exchanged with another verifier', async () => {
    expect(await roundTrip((_query, transaction) => Object.assign(transaction, { verifier: 'x'.repeat(43) }))).toEqual({ ok: false, failure: 'provider' });
  });

  it.each([
    ['a wrong nonce', { nonce: 'not-the-nonce' }],
    ['an ID token for another audience', { audience: 'someone-else' }],
    ['an expired ID token', { expiresIn: -3600 }],
    ['an ID token from another issuer', { issuer: 'https://other.example.test' }],
    ['a token signed with another key', { signWithOtherKey: true }],
    ['a token endpoint error', { tokenStatus: 500 }],
    ['a token response without an ID token', { noIdToken: true }],
  ])('refuses %s, without an identity', async (_name, twist) => {
    provider.state.next = twist;
    expect(await roundTrip()).toEqual({ ok: false, failure: 'provider' });
  });

  it('says the person declined when the provider answers access_denied, without calling it', async () => {
    const { transaction } = await begin();
    const query = new URLSearchParams({ error: 'access_denied', state: transaction.state });
    expect(await client.completeSignIn(SETTING, query, transaction)).toEqual({ ok: false, failure: 'denied' });
    expect(provider.state.tokenCalls).toBe(0);
  });

  it('treats any other error from the provider as a provider problem', async () => {
    const { transaction } = await begin();
    const query = new URLSearchParams({ error: 'server_error', state: transaction.state });
    expect(await client.completeSignIn(SETTING, query, transaction)).toEqual({ ok: false, failure: 'provider' });
  });

  it('no_email when the claim is missing or not an address', async () => {
    provider.state.person = { sub: 'sub-jane', name: 'Jane Doe' };
    expect(await roundTrip()).toEqual({ ok: false, failure: 'no_email' });
    provider.state.person = { sub: 'sub-jane', email: 'not an address' };
    expect(await roundTrip()).toEqual({ ok: false, failure: 'no_email' });
  });

  it('unverified_email when the provider says the address is not verified', async () => {
    provider.state.person = { sub: 'sub-jane', email: 'jane.doe@example.test', email_verified: false };
    expect(await roundTrip()).toEqual({ ok: false, failure: 'unverified_email' });
  });

  it('answers provider when the provider is unreachable at the token step', async () => {
    const { url, transaction } = await begin();
    const query = provider.authorize(url);
    provider.state.up = false;
    expect(await client.completeSignIn(SETTING, query, transaction)).toEqual({ ok: false, failure: 'provider' });
  });
});

describe('createTransactionStore', () => {
  const transaction = (id: string, createdAtMs = 0): SignInTransaction => ({ id, verifier: 'v', state: 's', nonce: 'n', next: '/', createdAtMs });

  it('gives a transaction back once', () => {
    const store = createTransactionStore({ ttlMs: SIGN_IN_TRANSACTION_TTL_MS, maxEntries: 10 });
    store.put(transaction('a'));
    expect(store.take('a', 1)?.id).toBe('a');
    expect(store.take('a', 2)).toBeNull();
    expect(store.take('unknown', 2)).toBeNull();
  });

  it('forgets a transaction after 10 minutes', () => {
    const store = createTransactionStore({ ttlMs: SIGN_IN_TRANSACTION_TTL_MS, maxEntries: 10 });
    store.put(transaction('a', 0));
    store.put(transaction('b', 0));
    expect(SIGN_IN_TRANSACTION_TTL_MS).toBe(10 * 60 * 1000);
    expect(store.take('a', SIGN_IN_TRANSACTION_TTL_MS)?.id).toBe('a');
    expect(store.take('b', SIGN_IN_TRANSACTION_TTL_MS + 1)).toBeNull();
  });

  it('keeps at most maxEntries, dropping the oldest first', () => {
    const store = createTransactionStore({ ttlMs: SIGN_IN_TRANSACTION_TTL_MS, maxEntries: 2 });
    store.put(transaction('a'));
    store.put(transaction('b'));
    store.put(transaction('c'));
    expect(store.take('a', 1)).toBeNull();
    expect(store.take('b', 1)?.id).toBe('b');
    expect(store.take('c', 1)?.id).toBe('c');
  });

  it('names a __Host- cookie for the transaction, so a sibling host cannot plant one', () => {
    expect(OIDC_COOKIE.startsWith('__Host-')).toBe(true);
  });
});
