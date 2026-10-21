import { afterEach, describe, expect, it, vi } from 'vitest';

// The downloadable bundle needs a self-contained server folder (Next.js "standalone" output). Only the
// bundle build asks for it, with BUNDLE_BUILD=1. Every other build, and the dev launcher's `next start`,
// must be exactly as before.

async function configWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  return (await import('../../next.config')).default;
}

afterEach(() => {
  vi.resetModules();
});

describe('next.config standalone output', () => {
  it('asks for standalone output when BUNDLE_BUILD is 1', async () => {
    const config = await configWith({ BUNDLE_BUILD: '1', NEXT_DIST_DIR: '.next-bundle' });

    expect(config.output).toBe('standalone');
    expect(config.distDir).toBe('.next-bundle');
  });

  it('adds no output setting at all without BUNDLE_BUILD', async () => {
    const config = await configWith({ BUNDLE_BUILD: undefined, NEXT_DIST_DIR: undefined });

    expect('output' in config).toBe(false);
    expect(config.distDir).toBe('.next');
  });

  it.each(['0', 'true', 'yes', ' 1'])('does not treat BUNDLE_BUILD=%j as the switch', async (value) => {
    const config = await configWith({ BUNDLE_BUILD: value });

    expect('output' in config).toBe(false);
  });

  it('keeps the other settings and the header rule in both modes', async () => {
    for (const bundle of ['1', undefined]) {
      const config = await configWith({ BUNDLE_BUILD: bundle });

      expect(config.compress).toBe(false);
      expect(config.poweredByHeader).toBe(false);
      expect(typeof config.headers).toBe('function');
      const rules = (await config.headers?.()) ?? [];
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe('/:path*');
    }
  });

  it('still rejects a build folder name that is not .next or .next-<label>', async () => {
    await expect(configWith({ BUNDLE_BUILD: '1', NEXT_DIST_DIR: '../elsewhere' })).rejects.toThrow(/NEXT_DIST_DIR/);
  });
});
