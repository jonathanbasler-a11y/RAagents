import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeChatRuntime } from '@/server/chat/boot';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import * as agentsRoute from './agents/route';
import * as healthRoute from './health/route';
import * as messagesRoute from './rooms/[room]/messages/route';
import * as newRoute from './rooms/[room]/new/route';
import * as turnsRoute from './rooms/[room]/turns/route';
import * as selectionRoute from './selection/route';

// The route files are thin: each wires one handler to the process-wide dependencies.
// These tests pin the wiring: Node runtime, dynamic rendering, the methods, and the
// same-origin guard running before anything touches the database.

const ROUTES = [
  ['agents', agentsRoute, ['GET']],
  ['health', healthRoute, ['GET']],
  ['rooms/[room]/messages', messagesRoute, ['GET']],
  ['rooms/[room]/new', newRoute, ['POST']],
  ['rooms/[room]/turns', turnsRoute, ['POST']],
  ['selection', selectionRoute, ['GET', 'POST']],
] as const;

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'routes-test-'));
  vi.stubEnv('CHAT_DB_PATH', path.join(dataDir, 'chat.db'));
});

afterEach(() => {
  closeChatRuntime();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('API route files', () => {
  it.each(ROUTES)('%s runs on Node, is dynamic and exports its methods', (_name, route, methods) => {
    const exports = route as Record<string, unknown>;
    expect(exports.runtime).toBe('nodejs');
    expect(exports.dynamic).toBe('force-dynamic');
    for (const method of methods) expect(typeof exports[method]).toBe('function');
  });

  it.each([
    ['rooms/[room]/turns', (request: Request) => turnsRoute.POST(request, { params: Promise.resolve({ room: 'reglead' }) })],
    ['rooms/[room]/new', (request: Request) => newRoute.POST(request, { params: Promise.resolve({ room: 'reglead' }) })],
    ['selection', (request: Request) => selectionRoute.POST(request)],
  ])('%s refuses a cross-site POST with 403 before it opens the database', async (_name, post) => {
    captureLogs();
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });

    const response = await post(request);

    expect(response.status).toBe(403);
    expect(existsSync(path.join(dataDir, 'chat.db'))).toBe(false);
  });
});
