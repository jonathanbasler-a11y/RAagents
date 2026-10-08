import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROSTER } from '@/client/test-fixtures';

const registry = vi.hoisted(() => ({ listPublicAgents: vi.fn() }));
vi.mock('@/server/agents', () => registry);

import { loadPublicAgents } from './load-agents';

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  registry.listPublicAgents.mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

describe('loadPublicAgents', () => {
  it('returns the roster when the registry loads', () => {
    registry.listPublicAgents.mockReturnValue(ROSTER);

    expect(loadPublicAgents()).toEqual({ ok: true, agents: ROSTER });
  });

  it('turns invalid specs into a setup message that lists every issue', () => {
    const error = Object.assign(new Error('agent specs are invalid'), {
      name: 'AgentSpecError',
      issues: [
        { source: 'reglead.md', message: 'missing section "Role"' },
        { source: 'label.md', message: 'name must start with the letter L' },
      ],
    });
    registry.listPublicAgents.mockImplementation(() => {
      throw error;
    });

    const result = loadPublicAgents();

    expect(result).toMatchObject({
      ok: false,
      issues: ['reglead.md: missing section "Role"', 'label.md: name must start with the letter L'],
    });
    expect(logged).toHaveBeenCalled();
  });

  it('shows a generic message for other failures, never their paths or internals', () => {
    registry.listPublicAgents.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, scandir /home/someone/specs');
    });

    const result = loadPublicAgents();

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/ENOENT|\/Users\//);
    expect(logged).toHaveBeenCalled();
  });

  it('treats a roster with no active agent as a setup problem', () => {
    registry.listPublicAgents.mockReturnValue([]);

    expect(loadPublicAgents()).toMatchObject({ ok: false, issues: [] });
  });
});
