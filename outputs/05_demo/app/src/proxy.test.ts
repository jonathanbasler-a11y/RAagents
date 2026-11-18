import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '@/server/access-gate';
import { closeAccountsDb, tokenHash } from '@/server/accounts/session-lookup';
import { migrateChatSchema } from '@/server/chat/schema';
import { openDatabase } from '@/server/db/sqlite';
import { proxy } from './proxy';

const ADMIN_PASSWORD = 'a-long-admin-password-1';
const MEMBER_TOKEN = 'M'.repeat(43);
const WAITING_TOKEN = 'W'.repeat(43);
const ADMIN_TOKEN = 'A'.repeat(43);

const dirs: string[] = [];

afterEach(() => {
  closeAccountsDb();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(pathname: string, init: { method?: string; host?: string; token?: string } = {}): NextRequest {
  const headers = new Headers({ host: init.host ?? 'localhost:3200' });
  if (init.token !== undefined) headers.set('cookie', `${SESSION_COOKIE}=${init.token}`);
  return new NextRequest(`http://localhost:3200${pathname}`, { method: init.method ?? 'GET', headers });
}

function passedThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

function rewrittenTo(response: Response): URL | null {
  const target = response.headers.get('x-middleware-rewrite');
  return target === null ? null : new URL(target);
}

/** Sign-in on, over a database with a member, a member waiting for their own password and the admin, each signed in. */
function gateOn() {
  const dir = mkdtempSync(path.join(tmpdir(), 'proxy-'));
  dirs.push(dir);
  const file = path.join(dir, 'chat.db');
  const db = openDatabase(file);
  migrateChatSchema(db);
  const account = db.prepare(
    `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
     VALUES (?, ?, ?, ?, 'scrypt$x', ?, ?, NULL, '2026-10-29T08:00:00.000Z', 'server')`,
  );
  account.run('acc-member', 'member-one', 'member', 'app', 0, null);
  account.run('acc-waiting', 'member-two', 'member', 'app', 1, '2999-01-01T00:00:00.000Z');
  account.run('acc-admin', 'admin', 'admin', 'server', 0, null);
  const session = db.prepare(`INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, '2026-10-29T08:00:00.000Z', '2999-01-01T00:00:00.000Z')`);
  session.run(tokenHash(MEMBER_TOKEN), 'acc-member');
  session.run(tokenHash(WAITING_TOKEN), 'acc-waiting');
  session.run(tokenHash(ADMIN_TOKEN), 'acc-admin');
  db.close();
  vi.stubEnv('CHAT_DB_PATH', file);
  vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', ADMIN_PASSWORD);
  return file;
}

describe('proxy without sign-in', () => {
  it('lets a loopback request through, as before, without reading any cookie or database', async () => {
    vi.stubEnv('CHAT_DB_PATH', '/nonexistent/folder/chat.db');
    expect(passedThrough(await proxy(request('/')))).toBe(true);
    expect(passedThrough(await proxy(request('/api/rooms/team/messages', { token: MEMBER_TOKEN })))).toBe(true);
  });
});

describe('proxy with sign-in on', () => {
  it('shows the login page in place of a page without a session: an internal rewrite, no Location header', async () => {
    // Next.js parses a Location set by the proxy as a full URL (a relative one crashes the request with a 500, seen on a
    // real server), and inside a container the request URL names the internal address. A rewrite needs neither and
    // answers the load balancer's health check of / with 200.
    gateOn();
    const response = await proxy(request('/team?thread=t1'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    const target = rewrittenTo(response);
    expect(target?.pathname).toBe('/login');
    expect(target?.searchParams.get('next')).toBe('/team?thread=t1');
  });

  it('answers 401 in the app error shape to an API request without a session', async () => {
    gateOn();
    const response = await proxy(request('/api/rooms/team/turns', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await response.json()) as { error: string; message: string; correlationId: string };
    expect(body.error).toBe('sign_in_required');
    expect(body.message).toMatch(/sign in/i);
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets a person with a valid session through', async () => {
    gateOn();
    expect(passedThrough(await proxy(request('/team', { token: MEMBER_TOKEN })))).toBe(true);
    expect(passedThrough(await proxy(request('/api/rooms/team/messages', { token: MEMBER_TOKEN })))).toBe(true);
  });

  it('refuses a cookie whose session is unknown', async () => {
    gateOn();
    expect(rewrittenTo(await proxy(request('/team', { token: 'X'.repeat(43) })))?.pathname).toBe('/login');
  });

  it('sees a session ended in the database on the very next request', async () => {
    const file = gateOn();
    expect(passedThrough(await proxy(request('/team', { token: MEMBER_TOKEN })))).toBe(true);
    const db = openDatabase(file);
    db.prepare(`UPDATE account_sessions SET revoked_at = '2026-10-29T09:00:00.000Z' WHERE token_hash = ?`).run(tokenHash(MEMBER_TOKEN));
    db.close();
    expect(rewrittenTo(await proxy(request('/team', { token: MEMBER_TOKEN })))?.pathname).toBe('/login');
  });

  it('sends a person waiting for their own password to the password page, and refuses their API calls', async () => {
    gateOn();
    const page = await proxy(request('/team', { token: WAITING_TOKEN }));
    expect(rewrittenTo(page)?.pathname).toBe('/account/password');
    expect(rewrittenTo(page)?.searchParams.get('next')).toBe('/team');
    const api = await proxy(request('/api/selection', { token: WAITING_TOKEN }));
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: string }).error).toBe('password_change_required');
    expect(passedThrough(await proxy(request('/account/password', { token: WAITING_TOKEN })))).toBe(true);
  });

  it('keeps the admin paths for the admin: a member gets 403', async () => {
    gateOn();
    const page = await proxy(request('/admin', { token: MEMBER_TOKEN }));
    expect(page.status).toBe(403);
    expect(page.headers.get('content-type')).toMatch(/text\/plain/);
    const api = await proxy(request('/api/admin/people', { token: MEMBER_TOKEN }));
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: string }).error).toBe('admin_only');
    expect(passedThrough(await proxy(request('/admin', { token: ADMIN_TOKEN })))).toBe(true);
  });

  it('keeps the health check open for the load balancer', async () => {
    gateOn();
    expect(passedThrough(await proxy(request('/api/health')))).toBe(true);
  });

  it('still applies the host check first: a wrong Host is refused before anything else', async () => {
    gateOn();
    vi.stubEnv('HOST', '127.0.0.1');
    const response = await proxy(request('/team', { host: 'attacker.example', token: MEMBER_TOKEN }));
    expect(response.status).toBe(421);
  });

  it('refuses everyone, without a crash, when the account tables are missing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proxy-empty-'));
    dirs.push(dir);
    vi.stubEnv('CHAT_DB_PATH', path.join(dir, 'chat.db'));
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', ADMIN_PASSWORD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(rewrittenTo(await proxy(request('/team', { token: MEMBER_TOKEN })))?.pathname).toBe('/login');
    expect((await proxy(request('/api/selection', { token: MEMBER_TOKEN }))).status).toBe(401);
  });
});
