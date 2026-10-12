import { afterEach, describe, expect, it } from 'vitest';
import { captureLogs } from '@/server/llm/test-support/fake-gateway';
import { getRoomMessages, postNewThread } from './rooms';
import { apiHarness, postRequest, type ApiHarness } from './test-support';

// The room routes log the room path segment quoted, so a line break in the segment cannot forge a
// log line (the same rule as POST /turns).

let harness: ApiHarness | undefined;

afterEach(() => {
  harness?.cleanup();
  harness = undefined;
});

function setup(...args: Parameters<typeof apiHarness>): ApiHarness {
  harness = apiHarness(...args);
  return harness;
}

const FORGED = 'lead\n[api] forged line (correlation 00000000)';

const brokenRuntime = {
  overrides: {
    runtime: () => {
      throw new Error('the database is down');
    },
  },
};

describe('the room routes log the room path segment quoted', () => {
  it('POST /new: a refused request logs one line, with the room quoted', async () => {
    const logs = captureLogs();
    const api = setup();

    const response = await postNewThread(
      postRequest(`/api/rooms/${encodeURIComponent(FORGED)}/new`, {}, { 'sec-fetch-site': 'cross-site' }),
      FORGED,
      api.deps,
    );

    expect(response.status).toBe(403);
    const lines = logs.warnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain(JSON.stringify(FORGED));
  });

  // A failure is only reached for a valid room (an unknown one is a 404 first), so these lines never
  // carry a line break. They still use the one quoted format, like every other line.
  it('GET /messages: a failure logs one line, with the room quoted', () => {
    const logs = captureLogs();
    const api = setup(brokenRuntime);

    const response = getRoomMessages('lead', api.deps);

    expect(response.status).toBe(500);
    const lines = logs.errors();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain('"lead"');
  });

  it('POST /new: a failure logs one line, with the room quoted', async () => {
    const logs = captureLogs();
    const api = setup(brokenRuntime);

    const response = await postNewThread(postRequest('/api/rooms/lead/new', {}), 'lead', api.deps);

    expect(response.status).toBe(500);
    const lines = logs.errors();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(lines[0]).toContain('"lead"');
  });
});
