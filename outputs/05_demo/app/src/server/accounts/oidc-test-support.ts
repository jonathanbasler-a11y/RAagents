// A sign-in provider in memory, for tests: its discovery document, its keys and its token endpoint, served through the
// fetch that src/server/accounts/oidc.ts passes to the library, so no test touches the network. ID tokens are RS256 JWTs
// signed with node:crypto. Each test makes its own provider; `next` changes what the next token or answer looks like.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

export const FAKE_ISSUER = 'https://idp.example.test';
export const FAKE_CLIENT_ID = 'client-123';
export const FAKE_REDIRECT = 'https://app.example.test/api/auth/callback';

export interface FakeClaims {
  sub: string;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  name?: string | undefined;
  [claim: string]: unknown;
}

/** What the next token or answer should get wrong, for one test. */
export interface FakeTwist {
  audience?: string;
  /** Seconds from now; negative for an ID token that expired. */
  expiresIn?: number;
  nonce?: string;
  issuer?: string;
  signWithOtherKey?: boolean;
  tokenStatus?: number;
  /** A token response without an ID token. */
  noIdToken?: boolean;
}

interface IssuedCode {
  claims: FakeClaims;
  nonce: string | null;
  challenge: string | null;
  clientId: string;
  redirectUri: string;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function signJwt(payload: Record<string, unknown>, key: KeyObject): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'key-1', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeProvider() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map<string, IssuedCode>();
  const state = {
    up: true,
    discoveryCalls: 0,
    tokenCalls: 0,
    next: {} as FakeTwist,
    /** The person who signs in at the provider next. */
    person: { sub: 'sub-jane', email: 'Jane.Doe@Example.TEST', email_verified: true, name: 'Jane Doe' } as FakeClaims,
  };

  const discovery = {
    issuer: FAKE_ISSUER,
    authorization_endpoint: `${FAKE_ISSUER}/authorize`,
    token_endpoint: `${FAKE_ISSUER}/token`,
    jwks_uri: `${FAKE_ISSUER}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };

  async function fetchImpl(url: string, init?: { method?: string; body?: unknown; headers?: unknown }): Promise<Response> {
    if (!state.up) throw new TypeError('fetch failed');
    const target = new URL(url);
    if (target.origin !== FAKE_ISSUER) throw new TypeError(`unexpected host in a test: ${target.origin}`);
    if (target.pathname === '/.well-known/openid-configuration') {
      state.discoveryCalls += 1;
      return json(200, discovery);
    }
    if (target.pathname === '/jwks') {
      return json(200, { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' }] });
    }
    if (target.pathname === '/token' && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      state.tokenCalls += 1;
      const form = new URLSearchParams(String(init?.body ?? ''));
      const issued = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const twist = state.next;
      if (twist.tokenStatus !== undefined) return json(twist.tokenStatus, { error: 'server_error' });
      if (
        issued === undefined ||
        form.get('grant_type') !== 'authorization_code' ||
        form.get('client_id') !== issued.clientId ||
        form.get('redirect_uri') !== issued.redirectUri ||
        createHash('sha256').update(verifier).digest('base64url') !== issued.challenge
      ) {
        return json(400, { error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = signJwt(
        {
          ...issued.claims,
          iss: twist.issuer ?? FAKE_ISSUER,
          aud: twist.audience ?? issued.clientId,
          iat: now,
          exp: now + (twist.expiresIn ?? 300),
          ...(issued.nonce === null && twist.nonce === undefined ? {} : { nonce: twist.nonce ?? issued.nonce }),
        },
        twist.signWithOtherKey ? otherKeys.privateKey : keys.privateKey,
      );
      const response = { access_token: 'access-token-never-kept', token_type: 'Bearer', expires_in: 300 };
      return json(200, twist.noIdToken ? response : { ...response, id_token: idToken });
    }
    return json(404, { error: 'not_found' });
  }

  return {
    state,
    /** The fetch to hand to the client under test. */
    fetch: fetchImpl as unknown as typeof fetch,
    /**
     * What the browser does at the provider: the person signs in, and the provider sends the browser back to the
     * redirect with a code. Returns the callback's query string.
     */
    authorize(authorizationUrl: URL): URLSearchParams {
      const params = authorizationUrl.searchParams;
      const code = randomBytes(16).toString('base64url');
      codes.set(code, {
        claims: { ...state.person },
        nonce: params.get('nonce'),
        challenge: params.get('code_challenge'),
        clientId: params.get('client_id') ?? '',
        redirectUri: params.get('redirect_uri') ?? '',
      });
      return new URLSearchParams({ code, state: params.get('state') ?? '' });
    },
  };
}

export type FakeProvider = ReturnType<typeof createFakeProvider>;
