// Runs before every test file (vitest.config.mts → test.setupFiles).
// Tests are offline: no model credentials, no network. Use temporary directories for
// data and freeze the clock (vi.useFakeTimers / vi.setSystemTime) where time matters.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { blockNetwork, stripModelCredentials } from './offline';

stripModelCredentials(process.env);
// Background reading is local material (src/server/agents/background.ts). Point it at a folder that
// does not exist, so a file kept in a checkout's .data/background never changes a test's result.
process.env.AGENT_BACKGROUND_DIR = path.join(tmpdir(), 'raagents-tests-no-background');
blockNetwork(globalThis);

// Component tests (first line "// @vitest-environment jsdom") get the jest-dom matchers
// and a DOM cleanup after each test. Globals are off, so Testing Library cannot
// register that cleanup by itself.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
