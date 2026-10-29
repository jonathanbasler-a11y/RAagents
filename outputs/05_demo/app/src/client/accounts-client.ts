import type { OneTimePasswordResponse, PeopleResponse, PersonAction, PersonResponse } from '@/shared/accounts';
import { UNREACHABLE_MESSAGE, isApiErrorBody, readJson, type ApiResult } from './chat-client';

/**
 * Browser client for the People page (admin only, on a hosted copy with sign-in). Same origin, so the browser sets
 * Sec-Fetch-Site itself; every POST sends JSON. A one-time password arrives in one answer and is never asked for again.
 */
export interface AccountsApi {
  listPeople(): Promise<ApiResult<PeopleResponse>>;
  createPerson(username: string): Promise<ApiResult<OneTimePasswordResponse>>;
  resetPerson(username: string): Promise<ApiResult<OneTimePasswordResponse>>;
  disablePerson(username: string): Promise<ApiResult<PersonResponse>>;
  enablePerson(username: string): Promise<ApiResult<PersonResponse>>;
}

export function createAccountsClient(deps: { fetch?: typeof fetch } = {}): AccountsApi {
  // Never call an injected or global fetch as a method: some browsers throw "Illegal invocation".
  const fetchFn: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function requestJson<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await fetchFn(path, { cache: 'no-store', ...init });
    } catch {
      return { ok: false, status: 0, error: null, message: UNREACHABLE_MESSAGE };
    }
    const body = await readJson(response);
    if (response.ok && body !== undefined) return { ok: true, data: body as T };
    const error = isApiErrorBody(body) ? body : null;
    return { ok: false, status: response.status, error, message: error?.message ?? `The server answered with status ${response.status}.` };
  }

  const postJson = <T>(path: string, body: unknown) =>
    requestJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

  const act = <T>(username: string, action: PersonAction) => postJson<T>(`/api/admin/people/${encodeURIComponent(username)}`, { action });

  return {
    listPeople: () => requestJson<PeopleResponse>('/api/admin/people'),
    createPerson: (username) => postJson<OneTimePasswordResponse>('/api/admin/people', { username }),
    resetPerson: (username) => act<OneTimePasswordResponse>(username, 'reset'),
    disablePerson: (username) => act<PersonResponse>(username, 'disable'),
    enablePerson: (username) => act<PersonResponse>(username, 'enable'),
  };
}
