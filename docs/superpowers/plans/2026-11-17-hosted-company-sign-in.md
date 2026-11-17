# Company sign-in for the hosted copy, then names on decisions: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a hosted copy signs people in through the company's OpenID Connect provider instead of passwords, lets in only
the people the admin listed, and records the signed-in person's name on every human decision.

**Architecture:** a second sign-in method beside the existing password method of `feature/hosted-mode`, chosen by the
settings. The provider proves who someone is; the existing sessions, roles, People page and access gate decide what they
may do. The identity lives in new tables (schema version 8), so the account tables of version 7 do not change. The
second part passes the session's person to every human write path in place of the fixed anonymous author.

**Tech stack:** Next.js 16.4.2, TypeScript, node:sqlite, Vitest, `openid-client` 6.8.9 (MIT; 6.9.0 was four days old on
2026-11-17), authorization code flow with PKCE, state and nonce, public client (no client secret).

**Spec:** the owner-approved plan of 2026-11-17 (private: it names the company's systems). The decisions it fixes are
copied into Global Constraints below; this file is all an implementer needs.

## Global Constraints

- Company-neutral public code: no company, product or host names in code, tests, docs or commits. Tests use
  `https://idp.example.test` and `https://app.example.test`.
- Settings, names only in code: `RAAGENTS_OIDC_ISSUER`, `RAAGENTS_OIDC_CLIENT_ID`, `RAAGENTS_OIDC_REDIRECT_URI`,
  `RAAGENTS_ADMIN_EMAIL`, optional `RAAGENTS_OIDC_SCOPES` (default `openid email profile`, must contain `openid`),
  `RAAGENTS_OIDC_EMAIL_CLAIM` (default `email`), `RAAGENTS_OIDC_LABEL` (default `Sign in with your company account`, at
  most 60 characters).
- Company sign-in is on when `RAAGENTS_OIDC_ISSUER` is set. Then there is no password path at all, not even for the
  admin: `RAAGENTS_ADMIN_PASSWORD` set as well is a misconfiguration (locked, never open), and the password sign-in,
  password page, one-time passwords and the People page's reset answer 404 or 400.
- Only people on the People page get in (the admin adds them by company e-mail). The admin is the person whose verified
  e-mail equals `RAAGENTS_ADMIN_EMAIL`.
- The redirect URI is `https://<host>/api/auth/callback`, or `http://localhost:<port>/api/auth/callback` or
  `http://127.0.0.1:<port>/api/auth/callback` for a copy on one computer. Any other is a misconfiguration.
- The app keeps no provider token: it reads the ID token's claims once and discards the tokens.
- No log line holds a token, a code, an e-mail address or a name: codes and counts only, with a correlation id.
- A misconfiguration locks the app with a startup message; it never leaves it open (the existing rule of the gate).
- Schema: append version 8; never edit an earlier version.
- Exact dependency versions; install with `npm ci --ignore-scripts`; Node 24; vitest `--maxWorkers=2`.
- Every guard gets a test that is seen failing (mutation check) before the branch is called done.

## Review Focus

1. **An e-mail on the list, but a different person.** The first sign-in binds the provider's issuer and subject to the
   account; a later sign-in with the same e-mail and another subject is refused (`identity_mismatch`) and records a
   refusal event. (Task 4 test `callback refuses a second subject for a bound e-mail`.)
2. **Case and spacing in e-mails.** `Jane.Doe@Example.TEST ` typed by the admin and `jane.doe@example.test` from the
   provider are the same person. (Task 2 test `addPersonByEmail normalises the e-mail`; Task 4 test `callback matches
   e-mail without regard to case`.)
3. **A browser that comes back late, twice, or from another tab.** A transaction is used once and expires after 10
   minutes; a second use or an unknown one goes back to the login page with `expired`, never a server error. (Task 3
   tests.)
4. **The provider is down, slow or answers garbage.** Discovery and token calls time out after 10 seconds and end on the
   login page with `provider`, the health route stays 200, nothing is cached as a failure for longer than one minute.
   (Task 3 test `discovery failure is retried after a minute`; Task 4 test `callback provider error`.)
5. **A leftover password setting after switching to company sign-in.** `RAAGENTS_ADMIN_PASSWORD` together with
   `RAAGENTS_OIDC_ISSUER` locks the app with a message that names which to remove. (Task 1 test.)

---

### Task 1: The sign-in setting

**Files:**
- Modify: `src/server/access-gate.ts` (type `AccessSetting`, `readAccessSetting`, `countedSession`)
- Modify: every reader of `setting.admin.password`: `src/app/api/_lib/sign-in.ts`, `src/server/accounts/runtime.ts`
- Test: `src/server/access-gate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OidcSetting { issuer: string; clientId: string; redirectUri: string; scopes: string; emailClaim: string; label: string }
  export type AccessSetting =
    | { state: 'off' }
    | { state: 'misconfigured'; reason: string }
    | { state: 'on'; method: 'password'; admin: { username: string; password: string }; trustedProxyHops: 0 | 1 }
    | { state: 'on'; method: 'oidc'; admin: { username: string; email: string }; oidc: OidcSetting; trustedProxyHops: 0 | 1 };
  ```
  `admin.username` keeps its meaning in both (default `admin`, from `RAAGENTS_ADMIN_USERNAME`).

- [ ] **Step 1: Write the failing tests** in `access-gate.test.ts`: `company sign-in is on with issuer, client id,
  redirect and admin e-mail` (expects `method: 'oidc'`, the defaults for scopes, claim and label, the admin e-mail
  lower-cased and trimmed); `a password set as well locks the app` (reason contains `RAAGENTS_ADMIN_PASSWORD`); one
  `locks the app` test each for: missing client id, missing admin e-mail, an admin e-mail without `@`, an issuer that is
  not `https:`, a redirect whose path is not `/api/auth/callback`, an `http:` redirect on a host other than `localhost`
  or `127.0.0.1`, scopes without `openid`, a label over 60 characters; `RAAGENTS_REQUIRE_SIGN_IN with neither method
  names both settings`; the password method still yields `method: 'password'` for the existing tests.
- [ ] **Step 2: Run** `npx vitest run src/server/access-gate.test.ts --maxWorkers=2`; expected: the new tests fail.
- [ ] **Step 3: Implement** the type and the parser. Narrow on `setting.method === 'password'` wherever the password
  is read (`postLogin`, `prepareAccounts`); TypeScript lists every place.
- [ ] **Step 4: Run** the test file and `npx tsc --noEmit`; expected: pass, no type errors.
- [ ] **Step 5: Commit** `Hosted mode: a company sign-in setting beside the password one`.

### Task 2: Identities in the database and the store

**Files:**
- Modify: `src/server/chat/schema.ts` (append version 8)
- Modify: `src/server/accounts/store.ts`, `src/server/accounts/session-lookup.ts`, `src/server/accounts/crypto.ts`
- Modify: `src/shared/accounts.ts` (`SessionView.displayName`, `PersonSummary.email` and `signIn`, `PersonStatus` gains
  `'invited'`, `usernameFromEmail`, `normalizeEmail`, `checkEmail`)
- Test: `src/server/accounts/store.test.ts`, `src/shared/accounts.test.ts`, `tests/guards/account-schema-constraints.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/accounts.ts
  export function normalizeEmail(value: string): string;                 // trim, lower-case
  export function checkEmail(email: string): RuleCheck;                  // 3..254 chars, one '@', [a-z0-9.@+_-] only
  export function usernameFromEmail(email: string, taken: (name: string) => boolean): string;
  // crypto.ts
  export const NO_PASSWORD_HASH = 'scrypt$no-password';                  // passes the v7 CHECK, matches no password
  // store.ts, on AccountStore
  findIdentityAccount(email: string): IdentityAccount | null;
  addPersonByEmail(input: { email: string; actor: string }): PersonSummary;
  bindIdentity(input: { accountId: string; issuer: string; subject: string; displayName: string | null }): void;
  noteIdentityRefusal(input: { accountId: string; reason: 'identity_mismatch' | 'disabled' }): void;
  bootstrapServerAdminByEmail(input: { username: string; email: string }): void;
  export interface IdentityAccount { accountId: string; username: string; role: AccountRole; managedBy: AccountManagedBy;
    disabled: boolean; email: string; issuer: string | null; subject: string | null; displayName: string | null }
  ```
- Schema version 8: table `account_identities` (`account_id` primary key and reference, `email` unique with the
  `checkEmail` rule as a CHECK, `issuer`, `subject`, `display_name` 1..120 or null, `bound_at`, `created_at`; issuer,
  subject and bound_at all null or all set; unique (issuer, subject); never deleted; `account_id` and `created_at` never
  change; `email` changes only for a server-managed account, and then issuer, subject and bound_at become null) and the
  append-only `account_identity_events` (`kind IN ('added','bound','email_changed','refused_mismatch','refused_disabled')`,
  `at`, `actor` 1..64, no update, no delete).
- An account with an identity holds `NO_PASSWORD_HASH`, `must_change_password = 0`. In the password method such an
  account is treated as an unknown name (the dummy hash is checked), so it can never sign in with a password.
- `findSession` and `readSession` LEFT JOIN `account_identities` for `displayName`.

- [ ] **Step 1: Write the failing tests:** `usernameFromEmail` (`jane.doe@example.test` gives `jane.doe`; a taken name
  gives `jane.doe-2`; characters outside the username rule become `-`; a 40-character local part is cut to fit with its
  suffix; a reserved name is skipped); `addPersonByEmail normalises the e-mail` and refuses a duplicate e-mail
  (`EmailTakenError`); `bindIdentity` binds once and refuses a different subject; `bootstrapServerAdminByEmail` creates
  the admin, and on a new e-mail clears the binding and ends the admin's sessions; `listPeople` shows `email`, `signIn:
  'company'` and status `invited` until the first binding; schema guards: the CHECKs and triggers above refuse a bad
  e-mail, a delete, a changed `account_id`, an e-mail change on an app account, and an update of an event;
  `password sign-in treats a company account as unknown`.
- [ ] **Step 2: Run** the three test files; expected: fail.
- [ ] **Step 3: Implement.** Every write is one `immediateTransaction` with its event, as the existing store does.
  Add the new writers to `tests/structure/writer-allowlist.test.ts` with their single caller each (Tasks 4 and 5).
- [ ] **Step 4: Run** the files plus `src/server/chat/*.test.ts`; expected: pass (the migration test covers 0 to 8).
- [ ] **Step 5: Commit** `Hosted mode: company identities for accounts (schema version 8)`.

### Task 3: The provider client and the sign-in transactions

**Files:**
- Create: `src/server/accounts/oidc.ts`, `src/server/accounts/oidc.test.ts`
- Create: `tests/support/fake-oidc.ts` (an in-memory provider: discovery, JWKS, token endpoint, RS256 ID tokens signed
  with `node:crypto`; served through the library's `customFetch`, so no network)
- Modify: `package.json`, `package-lock.json` (`openid-client` 6.8.9 exactly)

**Interfaces:**
- Produces:
  ```ts
  export interface OidcDeps { fetch?: typeof fetch; now: () => Date; random: () => string }
  export interface SignInTransaction { id: string; verifier: string; state: string; nonce: string; next: string; createdAtMs: number }
  export interface VerifiedIdentity { issuer: string; subject: string; email: string; displayName: string | null }
  export type OidcFailure = 'provider' | 'denied' | 'expired' | 'no_email' | 'unverified_email';
  export async function beginSignIn(setting: OidcSetting, next: string, deps: OidcDeps): Promise<{ url: URL; transaction: SignInTransaction }>;
  export async function completeSignIn(setting: OidcSetting, callbackUrl: URL, transaction: SignInTransaction, deps: OidcDeps):
    Promise<{ ok: true; identity: VerifiedIdentity } | { ok: false; failure: OidcFailure }>;
  export function createTransactionStore(options: { ttlMs: number; maxEntries: number }): {
    put(t: SignInTransaction): void; take(id: string, nowMs: number): SignInTransaction | null };
  export const OIDC_COOKIE = '__Host-raagents_signin';
  ```
- Rules: discovery cached per issuer and client id; a failed discovery is retried after one minute, not cached for good;
  10-second timeout on every provider call; state and nonce always sent (not only when PKCE is missing); the ID token's
  issuer, audience, expiry, signature and nonce are checked by the library; `email_verified: false` gives
  `unverified_email`; a missing claim named by `emailClaim` gives `no_email`; `error=access_denied` in the callback
  gives `denied`; any other provider error gives `provider`. A transaction lives 10 minutes, is taken once, and the
  store keeps at most 10,000 (the oldest goes first).

- [ ] **Step 1: Install** `npm install --save-exact --ignore-scripts openid-client@6.8.9`; check `npm audit --omit=dev`.
- [ ] **Step 2: Write the failing tests** against the fake provider: a full begin and complete gives the verified
  identity; a wrong state, a wrong nonce, an ID token for another audience, an expired ID token, a token signed with
  another key each give `provider` and no identity; `denied`; `no_email`; `unverified_email`; `discovery failure is
  retried after a minute`; transaction store: taken once, expired after 10 minutes, oldest evicted at 10,000.
- [ ] **Step 3: Run** `npx vitest run src/server/accounts/oidc.test.ts --maxWorkers=2`; expected: fail.
- [ ] **Step 4: Implement** with `discovery(issuer, clientId, undefined, None(), { [customFetch]: deps.fetch, timeout: 10 })`,
  `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant(config, url,
  { pkceCodeVerifier, expectedState, expectedNonce, idTokenExpected: true })` and `tokens.claims()`. Check the option
  names against the 6.8.9 documentation before writing them.
- [ ] **Step 5: Run**; expected: pass. **Commit** `Hosted mode: the company sign-in client, tested against a fake provider`.

### Task 4: The sign-in routes, the gate and the start hook

**Files:**
- Create: `src/app/api/auth/start/route.ts`, `src/app/api/auth/callback/route.ts`
- Create: `src/app/api/_lib/company-sign-in.ts`, `src/app/api/_lib/company-sign-in.test.ts`
- Modify: `src/server/access-gate.ts` (open paths), `src/app/api/_lib/sign-in.ts` (`postLogin` 404 in the oidc method;
  `getLoginPage` renders the company button), `src/app/api/_lib/account-pages.ts` (button and the new messages),
  `src/app/api/_lib/account-password.ts` (404 in the oidc method), `src/server/accounts/runtime.ts` (start hook calls
  `bootstrapServerAdminByEmail`), `src/app/api/_lib/account-deps.ts` (OIDC deps and the transaction store)

**Interfaces:**
- Consumes: Task 1 `AccessSetting`, Task 2 store methods, Task 3 `beginSignIn`, `completeSignIn`, `createTransactionStore`.
- Produces: `getCompanySignInStart(request, deps): Promise<Response>`, `getCompanySignInCallback(request, deps):
  Promise<Response>`; login error codes `not_listed`, `disabled`, `identity_mismatch`, `expired`, `provider`, `denied`,
  `no_email`, `unverified_email` with a plain sentence each in `LOGIN_MESSAGES`.
- Gate: `GET`/`HEAD` `/api/auth/start` and `/api/auth/callback` are open. Both routes answer 404 unless the method is
  `oidc`.
- Callback order: transaction cookie, take the transaction (`expired` if none), `completeSignIn`, `findIdentityAccount`
  by e-mail (`not_listed`), disabled (`disabled`, recorded), bound to another issuer or subject (`identity_mismatch`,
  recorded), bind if unbound, the existing `opened:` session limit, `openSession`, then 303 to `safeNextPath(next)` with
  the session cookie and the transaction cookie cleared. Every refusal: 303 to `/login?error=<code>`, transaction cookie
  cleared, no session.
- Start: 303 to the provider with a `__Host-` transaction cookie (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600).
  The login page shows the label as a link to `/api/auth/start?next=...` and no password form.

- [ ] **Step 1: Write the failing tests:** start sets the cookie and redirects to the provider's authorization endpoint
  with `code_challenge_method=S256`, state and nonce; `callback signs in a listed person and binds them`; `callback
  matches e-mail without regard to case`; `callback refuses a second subject for a bound e-mail`; not listed; disabled;
  expired or reused transaction; `callback provider error`; the admin from `RAAGENTS_ADMIN_EMAIL` gets the admin role;
  `next` cannot leave the site; password sign-in, the password page and its API answer 404 in the oidc method; the gate
  lets the two routes through without a session and nothing else new; the login page has no password field in the oidc
  method; no log line contains the test e-mail, name, code or token.
- [ ] **Step 2: Run**; expected: fail. **Step 3: Implement.** **Step 4: Run** the files, `npx tsc --noEmit`, `npm run
  lint`; expected: pass.
- [ ] **Step 5: Commit** `Hosted mode: sign in with the company account`.

### Task 5: The People page with company sign-in

**Files:**
- Modify: `src/app/api/_lib/admin-people.ts`, `src/components/PeoplePanel.tsx`, `src/app/admin/page.tsx`
- Test: `src/app/api/_lib/admin-people.test.ts`, `src/components/PeoplePanel.test.tsx`

**Interfaces:**
- Consumes: Task 2 `addPersonByEmail`, `PersonSummary.email`, `signIn`, status `invited`.
- API in the oidc method: `POST /api/admin/people {email}` gives 201 `{ person }` (no password anywhere); `{action:
  'reset'}` gives 400 `invalid_request`; disable and enable unchanged.
- Panel in the oidc method: "Add a person by company e-mail" (one e-mail field), columns e-mail, username, status ("has
  not signed in yet", "active", "disabled"), last sign-in; no reset button, no one-time password box.

- [ ] **Step 1: Write the failing tests** for the API rules and the panel (Testing Library: the e-mail form posts
  `{email}`, no reset button, the "has not signed in yet" status). **Step 2: Run**; fail. **Step 3: Implement.**
  **Step 4: Run**; pass. **Step 5: Commit** `Hosted mode: the People page adds people by company e-mail`.

### Task 6: Settings, documents and the structure tests

**Files:**
- Modify: `outputs/05_demo/app/.env.example` (the new names, no values), the hosted-mode guide in the app folder, the
  container recipe's notes, `outputs/DECISIONS.md` (one row: the owner's choice of company sign-in only, People-page
  list, names on decisions next), `outputs/OPEN_QUESTIONS.md` (37 answered; 29 still partly answered until Task 7)
- Modify: `tests/structure/writer-allowlist.test.ts`, `tests/structure/proxy-imports.test.ts` (the proxy still imports
  no sign-in client or Node-only module beyond what it does today)

- [ ] **Step 1:** Run the full gate `npx tsc --noEmit && npm test -- --maxWorkers=2 && npm run lint && npm run build`
  and the bundle check; expected: everything passes, the test count is the old 3,886 plus the new ones.
- [ ] **Step 2:** Release scan on the changed files and the commit messages (no company, host or person names).
- [ ] **Step 3: Commit** `Hosted mode: company sign-in documented; open question 37 answered`.

### Task 7 (follow-up change, branch `feature/hosted-names` from this one): names on decisions

**Files:**
- Modify: `src/server/chat/store.ts` (the finding decision, finding tags, checklist state, gate decision and gate dissent
  writers take `actor: string` instead of writing `LOCAL_PERSON`), their route handlers in `src/app/api/_lib/`
  (`findings.ts`, `checklist.ts`, `gates.ts`), `src/shared/accounts.ts` (`decisionActor`), `src/shared/contracts.ts`
  (comments), `src/components/GatesPanel.tsx`, `FindingsPanel.tsx`, `ChecklistPanel.tsx` (the notes)
- Test: the existing store and handler tests of those three areas, `src/shared/accounts.test.ts`

**Interfaces:**
- Produces: `decisionActor(person: { username: string; displayName: string | null }): string` gives `Jane Doe
  (jane.doe)`, or the username when there is no name; `actorForRequest(request, deps): { ok: true; actor: string } |
  { ok: false; response: Response }`: sign-in off gives `LOCAL_PERSON`; sign-in on with a counted session gives
  `decisionActor` of that session; sign-in on without one gives a 401 (the proxy already refuses; this is the second
  check, as the People page does).
- The author always comes from the server's session, never from the request body.

- [ ] **Step 1: Write the failing tests:** each of the five writers records the actor it is given; each handler passes
  the signed-in person's `decisionActor`, ignores an `actor` field in the body, and keeps `LOCAL_PERSON` with sign-in
  off; the panels say "Recorded under your name: Jane Doe (jane.doe)" when signed in and keep today's note otherwise.
- [ ] **Step 2: Run**; fail. **Step 3: Implement.** **Step 4:** the full gate; pass.
- [ ] **Step 5:** `outputs/OPEN_QUESTIONS.md` 29 answered, a `DECISIONS.md` row. **Commit** `Names on decisions: the
  signed-in person is recorded on every human decision`.

## After the tasks (not implementation steps)

Code review and a second pass over the fixes, a security pass over Tasks 3 and 4, the mutation check of every guard
above, then a live sign-in on a computer against the real provider (needs the owner's registration: client id and
issuer). Push and pull requests only on the owner's word.
