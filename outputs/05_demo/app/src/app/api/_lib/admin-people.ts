import 'server-only';
import { HashingBusyError } from '@/server/accounts/crypto';
import {
  AccountRuleError,
  PersonNotFoundError,
  ServerManagedAccountError,
  UsernameTakenError,
} from '@/server/accounts/store';
import {
  ONE_TIME_PASSWORD_TTL_MS,
  PERSON_ACTIONS,
  canonicalOneTimePassword,
  checkUsername,
  normalizeUsername,
  type OneTimePasswordResponse,
  type PeopleResponse,
  type PersonAction,
  type PersonResponse,
  type SessionView,
} from '@/shared/accounts';
import type { AccountDeps } from './account-deps';
import { sessionTokenFrom } from './account-http';
import { apiError, json, logFailure } from './http';
import { checkSameOriginJson, readJsonBody } from './request-guard';

// The People page's API: the admin lists, creates, resets, disables and enables accounts. Each handler checks the session
// and the admin role itself, not only the proxy, so a framework or path-matching gap in front cannot open it. A one-time
// password exists in plain text only in the one response that creates it: it is never logged, stored or listed.

type AdminCheck = { ok: true; session: SessionView } | { ok: false; response: Response };

/** The admin behind the request, or the refusal to send: 404 with sign-in off, 401 without a session, 403 for anyone else. */
export function requireAdmin(request: Request, deps: AccountDeps, correlationId: string): AdminCheck {
  if (deps.setting().state === 'off') return { ok: false, response: apiError('not_found', correlationId, { message: 'There is no such page.' }) };
  const token = sessionTokenFrom(request);
  const session = token === null ? null : deps.store().findSession(token);
  if (session === null) return { ok: false, response: apiError('sign_in_required', correlationId) };
  if (session.role !== 'admin' || session.mustChangePassword) return { ok: false, response: apiError('admin_only', correlationId) };
  return { ok: true, session };
}

const BUSY_MESSAGE = 'Too many passwords are being checked right now. Try again in a moment.';

/** GET /api/admin/people */
export function getPeople(request: Request, deps: AccountDeps): Response {
  const correlationId = deps.newId();
  const admin = requireAdmin(request, deps, correlationId);
  if (!admin.ok) return admin.response;
  try {
    const body: PeopleResponse = { people: deps.store().listPeople() };
    return json(body);
  } catch (error) {
    logFailure(deps.log, 'GET /api/admin/people', correlationId, error);
    return apiError('internal', correlationId);
  }
}

/** A new one-time password, its hash and its expiry. The hash covers the canonical form a person may type it in. */
async function newOneTime(deps: AccountDeps): Promise<{ oneTimePassword: string; passwordHash: string; expiresAt: string }> {
  const oneTimePassword = deps.newOneTimePassword();
  const passwordHash = await deps.passwords().hash(canonicalOneTimePassword(oneTimePassword));
  return { oneTimePassword, passwordHash, expiresAt: new Date(deps.now().getTime() + ONE_TIME_PASSWORD_TTL_MS).toISOString() };
}

/** POST /api/admin/people {username}: creates a person; 201 with their one-time password, once. */
export async function postPerson(request: Request, deps: AccountDeps): Promise<Response> {
  const correlationId = deps.newId();
  const where = 'POST /api/admin/people';
  if (deps.setting().state === 'off') return apiError('not_found', correlationId, { message: 'There is no such page.' });
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  const admin = requireAdmin(request, deps, correlationId);
  if (!admin.ok) return admin.response;
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    const raw = (body.value as { username?: unknown } | null)?.username;
    if (typeof raw !== 'string') return apiError('invalid_request', correlationId, { message: 'Give the new person a username.' });
    const username = normalizeUsername(raw);
    const check = checkUsername(username);
    if (!check.ok) return apiError('invalid_request', correlationId, { message: check.message });

    const oneTime = await newOneTime(deps);
    const person = deps.store().createPersonAccount({
      username,
      passwordHash: oneTime.passwordHash,
      oneTimeExpiresAt: oneTime.expiresAt,
      actor: admin.session.username,
    });
    const created: OneTimePasswordResponse = { person, oneTimePassword: oneTime.oneTimePassword, expiresAt: oneTime.expiresAt };
    return json(created, 201);
  } catch (error) {
    if (error instanceof UsernameTakenError) return apiError('username_taken', correlationId);
    if (error instanceof AccountRuleError) return apiError('invalid_request', correlationId, { message: error.message });
    if (error instanceof HashingBusyError) return apiError('server_busy', correlationId, { message: BUSY_MESSAGE });
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}

function isPersonAction(value: unknown): value is PersonAction {
  return typeof value === 'string' && (PERSON_ACTIONS as readonly string[]).includes(value);
}

/** POST /api/admin/people/[username] {action: reset | disable | enable}. */
export async function postPersonAction(request: Request, deps: AccountDeps, username: string): Promise<Response> {
  const correlationId = deps.newId();
  const where = `POST /api/admin/people/${JSON.stringify(username)}`;
  if (deps.setting().state === 'off') return apiError('not_found', correlationId, { message: 'There is no such page.' });
  const guard = checkSameOriginJson(request);
  if (!guard.ok) {
    deps.log.warn(`[api] refused ${where} (correlation ${correlationId}): ${guard.reason}`);
    return apiError('forbidden', correlationId);
  }
  const admin = requireAdmin(request, deps, correlationId);
  if (!admin.ok) return admin.response;
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return apiError('invalid_request', correlationId, { message: body.message });
    const action = (body.value as { action?: unknown } | null)?.action;
    if (!isPersonAction(action)) return apiError('invalid_request', correlationId, { message: 'The action must be reset, disable or enable.' });
    const store = deps.store();
    const actor = admin.session.username;
    if (action === 'reset') {
      const oneTime = await newOneTime(deps);
      const person = store.resetPersonPassword({ username, passwordHash: oneTime.passwordHash, oneTimeExpiresAt: oneTime.expiresAt, actor });
      const reset: OneTimePasswordResponse = { person, oneTimePassword: oneTime.oneTimePassword, expiresAt: oneTime.expiresAt };
      return json(reset);
    }
    const changed: PersonResponse = { person: store.setPersonDisabled({ username, disabled: action === 'disable', actor }) };
    return json(changed);
  } catch (error) {
    if (error instanceof PersonNotFoundError) return apiError('person_not_found', correlationId);
    if (error instanceof ServerManagedAccountError) return apiError('server_managed_account', correlationId);
    if (error instanceof HashingBusyError) return apiError('server_busy', correlationId, { message: BUSY_MESSAGE });
    logFailure(deps.log, where, correlationId, error);
    return apiError('internal', correlationId);
  }
}
