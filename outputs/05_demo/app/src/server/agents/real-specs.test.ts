import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/server/agents';

// The real roster: outputs/04_agents/<id>.md and the avatars in the app's public folder.
// Paths are relative to this file, so the test works in any checkout.
const REAL_SPECS_DIR = fileURLToPath(new URL('../../../../../04_agents/', import.meta.url));
const APP_PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));

// The 25 ids of the plan's roster update (mockup v2), in display order.
const ROSTER_IDS = [
  'reglead',
  'clin',
  'cmcreg',
  'regional',
  'label',
  'intel',
  'comp',
  'ops',
  'mw',
  'sp-orphan',
  'sp-paed',
  'sp-exp',
  'sp-combo',
  'sp-cdx',
  'sp-rm',
  'sp-promo',
  'orc',
  'san',
  'ev',
  'red',
  'syn',
  'o-cmc',
  'o-qa',
  'o-pv',
  'o-ma',
];

describe('real specs', () => {
  it('real specs validate', () => {
    const registry = loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR });

    expect(registry.agents.map((agent) => agent.id)).toEqual(ROSTER_IDS);
    expect(registry.orchestrator.id).toBe('orc');
    expect(registry.agents.filter((agent) => agent.defaultSelected)).toHaveLength(14);
    expect(registry.agents.filter((agent) => agent.locked).map((agent) => agent.id)).toEqual(['orc', 'san', 'ev', 'red', 'syn']);
  });

  // The workspace is confidential (owner decision, 2026-10-16): no brief may tell an agent to refuse, or to ask for
  // shared material to be removed, and every brief says what the agent does instead.
  it('has no agent that stops on confidential material, and every agent says it works in the confidential workspace', () => {
    const registry = loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR });

    for (const agent of registry.agents) {
      const text = `${agent.sections.guardrails}\n${agent.sections.inThisPhase}`;
      expect(agent.sections.guardrails, agent.id).toMatch(/confidential workspace/);
      expect(text, agent.id).not.toMatch(/public, company-neutral information only|illustrative or public examples only|not a cleared workspace/i);
      expect(text, agent.id).not.toMatch(/(?:stops?|stop) and (?:asks?|ask) for (?:it|the \w+) to be removed/i);
    }
  });

  it('says in every brief except the sanitiser that the agent may quote what is shared and never promises secrecy or deletion', () => {
    const registry = loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR });

    for (const agent of registry.agents.filter((candidate) => candidate.id !== 'san')) {
      expect(agent.sections.guardrails, agent.id).toMatch(/may quote what the person shares, without warnings or disclaimers/);
      expect(agent.sections.guardrails, agent.id).toMatch(/never promises? secrecy or deletion/);
    }
    expect(registry.get('san')?.sections.guardrails).toMatch(/Works on what the person shares in this confidential workspace/);
  });

  // The mockup decides when an agent joins by stage: 'late' at Phase 3 or once filed, 'filed' once
  // filed. The specs have to say the same, or the roster in the app and in the mockup drift apart.
  it('names the agents that join by stage, as the mockup does', () => {
    const registry = loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR });
    const joining = (trigger: string) => registry.agents.filter((agent) => agent.trigger === trigger).map((agent) => agent.id);

    expect(joining('late')).toEqual(['ops', 'mw', 'sp-rm']);
    expect(joining('filed')).toEqual(['sp-promo']);
  });
});
