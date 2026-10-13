// Runs before every test file (vitest.config.mts → test.setupFiles).
// Tests are offline: no model credentials, no network. Use temporary directories for
// data and freeze the clock (vi.useFakeTimers / vi.setSystemTime) where time matters.
import { afterEach } from 'vitest';
import { blockNetwork, stripModelCredentials } from './offline';

stripModelCredentials(process.env);
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
