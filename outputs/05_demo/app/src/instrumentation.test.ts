import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
});

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
});
