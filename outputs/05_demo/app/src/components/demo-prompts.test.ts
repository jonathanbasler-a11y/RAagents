import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/server/agents';
import { routeTeamTurn } from '@/server/chat/team-router';
import { DEMO_PROMPTS, demoPromptsFor, type DemoPromptId } from './demo-prompts';

// Paths are relative to this file, so the test works in any checkout.
const LIVE_DEMO = readFileSync(fileURLToPath(new URL('../../LIVE-DEMO.md', import.meta.url)), 'utf8');
const REAL_SPECS_DIR = fileURLToPath(new URL('../../../../04_agents/', import.meta.url));
const APP_PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

/**
 * The grey boxes (```text) of LIVE-DEMO.md, keyed by the step they sit under: the first box
 * under "### 4." is step4, a second one step4b. A box outside a numbered step is kept under
 * its own key, so it cannot go unnoticed.
 */
function promptsInWalkthrough(markdown: string): Record<string, string> {
  const prompts: Record<string, string> = {};
  for (const section of markdown.split(/^(?=#{1,3} )/m)) {
    const step = /^### (\d+)\. /.exec(section)?.[1];
    const boxes = [...section.matchAll(/^```text\n([\s\S]*?)\n```$/gm)].map((match) => match[1]);
    boxes.forEach((text, index) => {
      const key = step ? `step${step}${index === 0 ? '' : String.fromCharCode('a'.charCodeAt(0) + index)}` : `outside a step: ${text}`;
      prompts[key] = text;
    });
  }
  return prompts;
}

/** Throws for a missing id: an empty question would route to Oskar and pass step 6 by accident. */
function textOf(id: DemoPromptId): string {
  const prompt = DEMO_PROMPTS.find((entry) => entry.id === id);
  if (!prompt) throw new Error(`there is no demo prompt "${id}"`);
  return prompt.text;
}

describe('demo prompts', () => {
  it('are the prompts of LIVE-DEMO.md, word for word, each under the id of its step', () => {
    const inApp = Object.fromEntries(DEMO_PROMPTS.map((prompt) => [prompt.id, prompt.text]));

    expect(inApp).toEqual(promptsInWalkthrough(LIVE_DEMO));
  });

  it('are offered where the walkthrough asks them: step 2 in Rosa’s 1:1 room, the rest in the team chat, in order', () => {
    expect(demoPromptsFor('reglead').map((prompt) => prompt.id)).toEqual(['step2']);
    expect(demoPromptsFor('team').map((prompt) => prompt.id)).toEqual(['step3', 'step4', 'step4b', 'step5', 'step6', 'step7', 'step8']);
    expect(demoPromptsFor('cmcreg')).toEqual([]);
  });
});

describe('demo prompts in the team chat bring in the teammates LIVE-DEMO.md names', () => {
  // The real roster with nothing saved: "14 of 25 agents selected for this DD".
  function route(id: DemoPromptId) {
    const agents = loadRegistry({ specsDir: REAL_SPECS_DIR, publicDir: APP_PUBLIC_DIR }).agents;
    const selected = new Set(agents.filter((agent) => agent.locked || agent.defaultSelected).map((agent) => agent.id));
    return routeTeamTurn({ question: textOf(id), agents, selected });
  }

  it('step 3: the two @mentions, Rosa first, then Sofia sums up', () => {
    expect(route('step3')).toMatchObject({ source: 'explicit', primary: 'reglead', secondaries: ['cmcreg'], notes: [], synthesis: true });
  });

  it('step 4: routing terms bring in Oona (rare disease), then Pia (paediatric)', () => {
    const decision = route('step4');

    expect(decision).toMatchObject({ source: 'keyword', primary: 'sp-orphan', secondaries: ['sp-paed'], notes: [], synthesis: true });
    expect(decision.matchedTerms).toEqual({ 'sp-orphan': ['rare disease'], 'sp-paed': ['paediatric'] });
  });

  it('step 4b: the same two, and a note that Eitan matches but is not selected', () => {
    expect(route('step4b')).toMatchObject({
      source: 'keyword',
      primary: 'sp-orphan',
      secondaries: ['sp-paed'],
      notes: ['Eitan matches this question but is not selected for this DD; switch them on in the team overview to bring them in.'],
      synthesis: true,
    });
  });

  it('step 5: Carlos answers and Dara may add to it', () => {
    expect(route('step5')).toMatchObject({ source: 'explicit', primary: 'cmcreg', secondaries: ['comp'], notes: [], synthesis: true });
  });

  it('step 6: nobody matches, so Oskar answers', () => {
    expect(route('step6')).toMatchObject({ source: 'none', primary: 'orc', secondaries: [], notes: [], synthesis: false });
  });

  it('step 7: only Emeka', () => {
    expect(route('step7')).toMatchObject({ source: 'explicit', primary: 'ev', secondaries: [], notes: [], synthesis: false });
  });

  it('step 8: only Saskia, although "comparability" would otherwise bring in Carlos', () => {
    expect(route('step8')).toMatchObject({ source: 'explicit', primary: 'san', secondaries: [], notes: [], synthesis: false });
  });
});
