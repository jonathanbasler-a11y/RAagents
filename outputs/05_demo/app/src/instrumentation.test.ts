import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAccountsDb } from '@/server/accounts/session-lookup';
import { openDatabase } from '@/server/db/sqlite';
import { register } from './instrumentation';

const dirs: string[] = [];

afterEach(() => {
  closeAccountsDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function databasePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'instrumentation-'));
  dirs.push(dir);
  return path.join(dir, 'chat.db');
}

describe('register (runs once when the server starts)', () => {
  it('warns once, with no host name, when HOST binds beyond loopback', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HOST', '0.0.0.0');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await register();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/no login/i);
    expect(String(warn.mock.calls[0][0])).toMatch(/private/i);
  });

  it.each([undefined, '', '127.0.0.1', 'localhost', '::1'])('stays silent for HOST=%j', async (host) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('HOST', host);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await register();

    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('HOST', '0.0.0.0');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await register();

    expect(warn).not.toHaveBeenCalled();
  });

  it('opens no database for a local copy', async () => {
    const file = databasePath();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('CHAT_DB_PATH', file);

    await register();

    expect(existsSync(file)).toBe(false);
  });

  it('prepares sign-in before the first request when it is on: the admin from the settings exists', async () => {
    const file = databasePath();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('CHAT_DB_PATH', file);
    vi.stubEnv('RAAGENTS_ADMIN_PASSWORD', 'a-long-admin-password-1');

    await register();

    const db = openDatabase(file);
    try {
      expect(db.prepare(`SELECT username, role, managed_by FROM accounts`).all()).toEqual([{ username: 'admin', role: 'admin', managed_by: 'server' }]);
    } finally {
      db.close();
    }
  });

  it('says nobody can sign in when sign-in is misconfigured, even on a loopback bind', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('RAAGENTS_REQUIRE_SIGN_IN', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await register();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/nobody can sign in/i);
  });
});
