import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The shared rules are fixed when their module loads (a running server's environment does not change), so this test
// loads the prompt builder afresh with the hosted notice set, as a hosted server would, and builds a real agent's prompt.

const SPECS_DIR = fileURLToPath(new URL('../../../../../04_agents/', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('a hosted copy', () => {
  it('gives a real agent the hosted rule, which overrides the confidential-workspace line its own brief still carries', async () => {
    vi.resetModules();
    vi.stubEnv('RAAGENTS_HOSTED_NOTICE', 'Hosted practice copy');
    const { buildAgentPrompt } = await import('./build');
    const { loadRegistry } = await import('@/server/agents');
    const agent = loadRegistry({ specsDir: SPECS_DIR, publicDir: PUBLIC_DIR }).get('reglead');
    expect(agent).toBeDefined();

    const prompt = buildAgentPrompt({
      agent: agent!,
      teammates: [],
      room: 'one-to-one',
      role: 'solo',
      now: new Date('2026-10-29T10:00:00.000Z'),
      timeZone: 'Europe/Zurich',
      history: [{ role: 'user', content: 'Can I paste our real target documents here?' }],
    });
    const system = prompt.messages[0].content;

    expect(system).toMatch(/Shared hosted copy\./);
    expect(system).toMatch(/Where your brief calls this a confidential workspace, this paragraph replaces that/);
    expect(system).not.toMatch(/Confidential workspace\. This is a confidential workspace/);
    // The brief keeps its own line; the sentence above is what keeps the two from contradicting each other.
    expect(system).toMatch(/confidential workspace/i);
  });
});
