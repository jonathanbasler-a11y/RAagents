import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentSpecError,
  getAgent,
  getOrchestrator,
  listAgents,
  listPublicAgents,
  loadRegistry,
  toPublicAgent,
} from '@/server/agents';
import type { AgentSpec, PublicAgent } from '@/shared/contracts';
import {
  changed,
  extraSpec,
  fixtureSpec,
  fixtureSpecs,
  makeLayout,
  specIssues,
  specText,
  type TempLayout,
  touch,
  writeAvatar,
  writeSpecs,
} from './test-fixtures';

const BY_ORDER = ['lead', 'cmc', 'labels', 'conductor', 'critic', 'summary'];

let layout: TempLayout;

beforeEach(() => {
  layout = makeLayout();
});

afterEach(() => {
  layout.cleanup();
});

const specFile = (id: string) => path.join(layout.specsDir, `${id}.md`);
const load = () => loadRegistry({ specsDir: layout.specsDir, publicDir: layout.publicDir });
const issue = (source: string, pattern: RegExp) => expect.objectContaining({ source, message: expect.stringMatching(pattern) });

/** Points the process-wide helpers at the temporary layout: cwd is the app folder, no AGENT_SPECS_DIR. */
function useLayoutAsApp(): void {
  vi.spyOn(process, 'cwd').mockReturnValue(layout.appDir);
  vi.stubEnv('AGENT_SPECS_DIR', undefined);
}

describe('loadRegistry', () => {
  it('loads the active agents sorted by order and finds the orchestrator by kind', () => {
    writeSpecs(layout, fixtureSpecs());

    const registry = load();

    expect(registry.specsDir).toBe(layout.specsDir);
    expect(registry.agents.map((agent) => agent.id)).toEqual(BY_ORDER);
    expect(registry.orchestrator.id).toBe('conductor');
    expect(registry.get('labels')).toEqual(fixtureSpec('labels'));
    expect(registry.get('nobody')).toBeUndefined();
  });

  it('skips README.md, hidden files and files that are not .md', () => {
    writeSpecs(layout, fixtureSpecs());
    writeFileSync(path.join(layout.specsDir, 'README.md'), '# Agent specifications\n\nNot a spec.\n');
    writeFileSync(path.join(layout.specsDir, '.#labels.md'), 'editor lock file');
    writeFileSync(path.join(layout.specsDir, 'notes.txt'), 'not a spec');
    writeFileSync(path.join(layout.specsDir, '.gitkeep'), '');

    expect(load().agents.map((agent) => agent.id)).toEqual(BY_ORDER);
  });

  it('throws an error naming the folder when the specs folder is missing', () => {
    const missing = path.join(layout.root, 'no-such-folder');

    expect(() => loadRegistry({ specsDir: missing, publicDir: layout.publicDir })).toThrow(missing);
  });

  it('refuses a folder without any spec file, naming it without its local path (the page shows issues)', () => {
    const issues = specIssues(load);

    expect(issues).toEqual([issue('04_agents', /no agent spec files/)]);
    expect(JSON.stringify(issues)).not.toContain(layout.root);
  });

  it('keeps the full folder path for the server log only', () => {
    expect(load).toThrow(layout.specsDir);
  });

  it('reads the folder from AGENT_SPECS_DIR when no folder is given', () => {
    writeSpecs(layout, fixtureSpecs());
    vi.stubEnv('AGENT_SPECS_DIR', layout.specsDir);

    expect(loadRegistry({ publicDir: layout.publicDir }).specsDir).toBe(layout.specsDir);
  });

  it('defaults to ../../04_agents and ./public, both from the working directory', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();

    const registry = loadRegistry();

    expect(registry.specsDir).toBe(layout.specsDir);
    expect(registry.agents).toHaveLength(6);
  });

  it('treats an empty AGENT_SPECS_DIR as unset', () => {
    writeSpecs(layout, fixtureSpecs());
    vi.spyOn(process, 'cwd').mockReturnValue(layout.appDir);
    vi.stubEnv('AGENT_SPECS_DIR', '');

    expect(loadRegistry().specsDir).toBe(layout.specsDir);
  });

  it('reports the issues of every file, parse and roster issues together, each with its file name', () => {
    writeSpecs(layout, changed('critic', { name: 'Rosa' }));
    writeFileSync(specFile('labels'), specText(fixtureSpec('labels'), { front: { 'mention-only': false } }));

    let thrown: unknown;
    try {
      load();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentSpecError);
    const error = thrown as AgentSpecError;
    expect(error.issues).toEqual([issue('labels.md', /mention-only/), issue('critic.md', /name "Rosa"/)]);
    expect(error.message).toMatch(/labels\.md: .*mention-only/);
    expect(error.message).toMatch(/critic\.md: .*Rosa/);
  });

  it('reports a spec file it cannot read instead of crashing', () => {
    writeSpecs(layout, fixtureSpecs());
    mkdirSync(path.join(layout.specsDir, 'folder.md'));

    expect(specIssues(load)).toEqual([issue('folder.md', /cannot read/)]);
  });

  it('does not report a handoff to an agent whose file failed to parse as unknown', () => {
    writeSpecs(layout, fixtureSpecs());
    // labels hands off to lead; lead.md is now broken.
    writeFileSync(specFile('lead'), specText(fixtureSpec('lead'), { front: { active: 'yes' } }));

    expect(specIssues(load)).toEqual([issue('lead.md', /active/)]);
  });

  it('checks avatars in the public folder it was given', () => {
    writeSpecs(layout, fixtureSpecs());
    rmSync(path.join(layout.publicDir, 'avatars', 'labels.svg'));

    expect(specIssues(load)).toEqual([issue('labels.md', /\/avatars\/labels\.svg.*not found/)]);
  });

  it('leaves inactive agents out and narrows handoffs to active agents', () => {
    writeSpecs(layout, changed('cmc', { active: false }));

    const registry = load();

    expect(registry.agents.map((agent) => agent.id)).toEqual(['lead', 'labels', 'conductor', 'critic', 'summary']);
    expect(registry.get('cmc')).toBeUndefined();
    expect(registry.get('lead')?.handoffs).toEqual([]);
  });

  it('returns read-only agents, so no caller can change the shared roster', () => {
    writeSpecs(layout, fixtureSpecs());
    const registry = load();
    const labels = registry.get('labels') as AgentSpec;

    expect(() => {
      labels.name = 'Changed';
    }).toThrow(TypeError);
    expect(() => {
      labels.routing.keywords.push('anything');
    }).toThrow(TypeError);
    expect(() => {
      (registry.agents as AgentSpec[]).pop();
    }).toThrow(TypeError);
  });

  it('answers undefined for ids that are names of object properties', () => {
    writeSpecs(layout, fixtureSpecs());
    const registry = load();

    expect(registry.get('constructor')).toBeUndefined();
    expect(registry.get('__proto__')).toBeUndefined();
    expect(registry.get('toString')).toBeUndefined();
  });
});

describe('toPublicAgent', () => {
  it('keeps the profile fields and leaves out prompt text, routing terms, handoffs and the allowlist', () => {
    const expected: PublicAgent = {
      id: 'labels',
      name: 'Lena',
      letter: 'L',
      capability: 'Labelling',
      shortCapability: 'Labels',
      group: 'core',
      kind: 'domain',
      order: 3,
      autonomyLevel: 2,
      humanOwner: 'Labelling agent owner',
      version: '0.1.0',
      routable: true,
      mentionOnly: false,
      locked: false,
      defaultSelected: false,
      avatar: '/avatars/labels.svg',
      plannedRemit: 'Compares product information across regions.',
      profile: {
        role: 'Lena covers one part of a due diligence and names the teammate for anything else.',
        plannedKnowledgeSources: '- Public health authority guidance documents: not connected',
        tools: 'None in this phase. No tool can open a document or accept a finding.',
        guardrails: '- Works with public, company-neutral information only.',
        escalationLines: '- "Have the accountable reviewer check this before anyone relies on it."',
        humanOwner: 'Labelling agent owner. Keeps this brief up to date.',
        autonomyLevel: 'Level 2, Collaborate. A person checks every output before it is used.',
      },
      examplePrompts: [
        'What would Lena check first?',
        'Which risks are typical at this stage?',
        'What should we verify before the review meeting?',
      ],
    };

    expect(toPublicAgent(fixtureSpec('labels'))).toStrictEqual(expected);
  });

  it('includes team_role and trigger when the agent has them', () => {
    expect(toPublicAgent(fixtureSpec('critic')).teamRole).toBe('red-team');
    expect(toPublicAgent(fixtureSpec('cmc')).trigger).toBe('late');
  });
});

describe('process-wide helpers', () => {
  it('getAgent, listAgents and getOrchestrator read the specs folder from the working directory', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();

    expect(getAgent('labels')?.name).toBe('Lena');
    expect(listAgents().map((agent) => agent.id)).toEqual(BY_ORDER);
    expect(getOrchestrator().id).toBe('conductor');
  });

  it('refuses an inactive agent and leaves it out of every list', () => {
    writeSpecs(layout, changed('cmc', { active: false }));
    useLayoutAsApp();

    expect(getAgent('cmc')).toBeUndefined();
    expect(listAgents().map((agent) => agent.id)).not.toContain('cmc');
    expect(listPublicAgents().map((agent) => agent.id)).not.toContain('cmc');
  });

  it('listPublicAgents returns only public fields', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();

    const agents = listPublicAgents();

    expect(agents.map((agent) => agent.id)).toEqual(BY_ORDER);
    const labels = agents.find((agent) => agent.id === 'labels');
    expect(Object.keys(labels ?? {}).sort()).toEqual(
      [
        'id',
        'name',
        'letter',
        'capability',
        'shortCapability',
        'group',
        'kind',
        'order',
        'autonomyLevel',
        'humanOwner',
        'version',
        'routable',
        'mentionOnly',
        'locked',
        'defaultSelected',
        'avatar',
        'plannedRemit',
        'profile',
        'examplePrompts',
      ].sort(),
    );
    const json = JSON.stringify(agents);
    expect(json).not.toMatch(/persona-brief|phase-limits/);
    expect(json).not.toMatch(/comparability|SmPC|regulatory strategy/);
    expect(json).not.toMatch(/"routing"|"handoffs"|"sourceAllowlist"|"inThisPhase"|"personaAndVoice"|"sections"/);
  });

  it('keeps the parsed registry while no spec file changes', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();

    const first = getAgent('labels');

    expect(getAgent('labels')).toBe(first);
  });

  it('reloads when a spec file\'s modification time changes, even with the same content', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();
    const before = getAgent('labels');

    touch(specFile('labels'), 60);
    const after = getAgent('labels');

    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it('serves the new content after a spec file is edited', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();
    expect(getAgent('labels')?.plannedRemit).toBe('Compares product information across regions.');

    writeFileSync(specFile('labels'), specText({ ...fixtureSpec('labels'), plannedRemit: 'A new remit.' }));
    touch(specFile('labels'), 60);

    expect(getAgent('labels')?.plannedRemit).toBe('A new remit.');
  });

  it('reloads when a spec file is added or removed', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();
    expect(getAgent('dosing')).toBeUndefined();

    writeSpecs(layout, [extraSpec()]);
    expect(getAgent('dosing')?.name).toBe('Dara');

    rmSync(specFile('dosing'));
    expect(getAgent('dosing')).toBeUndefined();
  });

  it('reloads when AGENT_SPECS_DIR points somewhere else', () => {
    const other = makeLayout();
    try {
      writeSpecs(layout, fixtureSpecs());
      writeSpecs(other, [...fixtureSpecs(), extraSpec()]);
      // Avatars always come from <cwd>/public, which is the first layout's.
      writeAvatar(layout, 'dosing');
      vi.spyOn(process, 'cwd').mockReturnValue(layout.appDir);
      vi.stubEnv('AGENT_SPECS_DIR', layout.specsDir);
      expect(listAgents()).toHaveLength(6);

      vi.stubEnv('AGENT_SPECS_DIR', other.specsDir);

      expect(listAgents()).toHaveLength(7);
    } finally {
      other.cleanup();
    }
  });

  it('throws AgentSpecError while a spec is broken, and recovers once it is fixed', () => {
    writeSpecs(layout, fixtureSpecs());
    useLayoutAsApp();
    expect(getAgent('labels')?.name).toBe('Lena');

    writeFileSync(specFile('labels'), 'not a spec');
    touch(specFile('labels'), 60);
    expect(() => getAgent('labels')).toThrow(AgentSpecError);

    writeFileSync(specFile('labels'), specText(fixtureSpec('labels')));
    touch(specFile('labels'), 120);
    expect(getAgent('labels')?.name).toBe('Lena');
  });

  it('does not remember a failure: a missing avatar that appears later is picked up', () => {
    writeSpecs(layout, fixtureSpecs());
    rmSync(path.join(layout.publicDir, 'avatars', 'labels.svg'));
    useLayoutAsApp();
    expect(() => listAgents()).toThrow(AgentSpecError);

    writeAvatar(layout, 'labels');

    expect(listAgents()).toHaveLength(6);
  });

  it('throws an error naming the folder when the default specs folder is missing', () => {
    useLayoutAsApp();
    rmSync(layout.specsDir, { recursive: true });

    expect(() => listAgents()).toThrow(layout.specsDir);
  });
});
