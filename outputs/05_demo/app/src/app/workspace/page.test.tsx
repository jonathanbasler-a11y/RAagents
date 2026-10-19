import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// next/navigation's redirect() throws to stop rendering; this stand-in does the same.
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((target: string): never => {
    throw new Error(`NEXT_REDIRECT ${target}`);
  }),
}));
vi.mock('next/navigation', () => navigation);

import WorkspacePage from './page';

beforeEach(() => {
  // No return value: vitest would call a function returned from a hook as its cleanup.
  navigation.redirect.mockClear();
});

describe('/workspace (the old illustrative page)', () => {
  it('sends anyone with the old address, a bookmark or a ?screen= link to the landing page', () => {
    expect(() => WorkspacePage()).toThrow('NEXT_REDIRECT /');
    expect(navigation.redirect).toHaveBeenCalledTimes(1);
    expect(navigation.redirect).toHaveBeenCalledWith('/');
  });

  it('no longer serves the mockup or any other page below it', () => {
    const folder = path.resolve(process.cwd(), 'src', 'app', 'workspace');

    expect(existsSync(path.join(folder, 'page.tsx'))).toBe(true);
    expect(existsSync(path.join(folder, 'mockup'))).toBe(false);
    expect(existsSync(path.join(folder, '_lib'))).toBe(false);
  });
});
