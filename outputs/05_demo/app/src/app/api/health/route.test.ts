import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAccountsDb, tokenHash } from '@/server/accounts/session-lookup';
import { closeChatRuntime } from '@/server/chat/boot';
import { migrateChatSchema } from '@/server/chat/schema';
import { openDatabase } from '@/server/db/sqlite';
import { GET } from './route';

const TOKEN = 'M'.repeat(43);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'health-route-'));
  vi.stubEnv('CHAT_DB_PATH', path.join(dir, 'chat.db'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  closeAccountsDb();
  closeChatRuntime();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function signedInMember() {
  const db = openDatabase(path.join(dir, 'chat.db'));
  migrateChatSchema(db);
  db.prepare(
    `INSERT INTO accounts (id, username, role, managed_by, password_hash, must_change_password, one_time_expires_at, disabled_at, created_at, created_by)
     VALUES ('acc-1', 'member-one', 'member', 'app', 'scrypt$x', 0, NULL, NULL, '2026-10-29T08:00:00.000Z', 'admin')`,
  ).run();
  db.prepare(`INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, 'acc-1', '2026-10-29T08:00:00.000Z', '2999-01-01T00:00:00.000Z')`).run(tokenHash(TOKEN));
  db.close();
}

const request = (token?: string) =>
  new Request('http://localhost:3200/api/health', token === undefined ? {} : { headers: { cookie: `__Host-raagents_session=${token}` } });

describe('GET /api/health', () => {
  it('gives the full report on a copy without sign-in, as before', async () => {
    const body = (await (await GET(request())).json()) as Record<string, unknown>;
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('mode');
    expect(body).toHaveProperty('llmRoutes');
  });

  it('gives only the overall status to a caller without a session when sign-in is on', async () => {
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'a-long-admin-password-1');
    signedInMember();
    const response = await GET(request());
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['status']);
    expect(Object.keys((await (await GET(request('X'.repeat(43)))).json()) as object)).toEqual(['status']);
  });

  it('gives the full report to a person who signed in', async () => {
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'a-long-admin-password-1');
    signedInMember();
    const body = (await (await GET(request(TOKEN))).json()) as Record<string, unknown>;
    expect(body).toHaveProperty('llmRoutes');
  });
});
