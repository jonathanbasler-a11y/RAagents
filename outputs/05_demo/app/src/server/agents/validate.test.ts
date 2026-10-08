import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSpecs } from '@/server/agents';
import type { AgentSpec } from '@/shared/contracts';
import {
  changed,
  FIXTURE_IDS,
  fixtureSpec,
  fixtureSpecs,
  makeLayout,
  type TempLayout,
  writeAvatar,
} from './test-fixtures';

const everyAvatarExists = () => true;
const issuesOf = (specs: readonly AgentSpec[]) => validateSpecs(specs, { avatarExists: everyAvatarExists }).issues;
const issue = (source: string, pattern: RegExp) => expect.objectContaining({ source, message: expect.stringMatching(pattern) });

describe('validateSpecs: positive control', () => {
  it('accepts the valid fixture roster', () => {
    expect(validateSpecs(fixtureSpecs(), { avatarExists: everyAvatarExists })).toEqual({ ok: true, issues: [] });
  });

  it('is not ok when there is an issue', () => {
    const result = validateSpecs(changed('labels', { name: 'Mira' }), { avatarExists: everyAvatarExists });

    expect(result.ok).toBe(false);
  });
});

describe('validateSpecs: identity', () => {
  it('refuses two specs with the same id', () => {
    const copy: AgentSpec = { ...fixtureSpec('labels'), name: 'Lena', order: 7, routable: false, routing: { keywords: [], acronyms: [] } };

    expect(issuesOf([...fixtureSpecs(), copy])).toEqual([issue('labels.md', /id "labels".*2 specs/)]);
  });

  it('refuses two agents with the same name', () => {
    expect(issuesOf(changed('critic', { name: 'Rosa' }))).toEqual([issue('critic.md', /name "Rosa".*lead\.md/)]);
  });

  it('compares names case-insensitively, as @mentions do', () => {
    expect(issuesOf(changed('critic', { name: 'ROSA' }))).toEqual([issue('critic.md', /name "ROSA".*lead\.md/)]);
  });

  it('refuses two agents with the same order', () => {
    expect(issuesOf(changed('critic', { order: 1 }))).toEqual([issue('critic.md', /order 1.*lead\.md/)]);
  });
});

describe('validateSpecs: name and letter', () => {
  it('refuses a name that does not start with the letter', () => {
    expect(issuesOf(changed('labels', { name: 'Mira' }))).toEqual([issue('labels.md', /name "Mira".*letter "L"/)]);
  });

  it('compares the name initial with the letter case-insensitively', () => {
    expect(issuesOf(changed('labels', { name: 'lena' }))).toEqual([]);
  });

  it('refuses a letter that is not the initial of a word in capability or short_capability', () => {
    expect(issuesOf(changed('labels', { capability: 'Product information', shortCapability: undefined }))).toEqual([
      issue('labels.md', /letter "L".*capability/),
    ]);
  });

  it('accepts a letter taken from short_capability', () => {
    expect(issuesOf(changed('labels', { capability: 'Product information', shortCapability: 'Labels' }))).toEqual([]);
  });

  it('refuses a name with a space, which an @mention cannot address', () => {
    expect(issuesOf(changed('labels', { name: 'Lena Mira' }))).toEqual([issue('labels.md', /name "Lena Mira".*one word/)]);
  });
});

describe('validateSpecs: group, kind and team_role', () => {
  it('needs kind "domain" in groups core, spec and other', () => {
    expect(issuesOf(changed('labels', { kind: 'team-role', routable: false, routing: { keywords: [], acronyms: [] } }))).toEqual([
      issue('labels.md', /kind.*"domain".*"core"/),
    ]);
  });

  it('refuses team_role outside group "role"', () => {
    expect(issuesOf(changed('labels', { teamRole: 'red-team' }))).toEqual([issue('labels.md', /team_role.*"role"/)]);
  });

  it('needs team_role in group "role"', () => {
    expect(issuesOf(changed('summary', { teamRole: undefined }))).toEqual([issue('summary.md', /team_role.*required/)]);
  });

  it('needs kind "team-role" for a team role other than the orchestrator', () => {
    expect(issuesOf(changed('critic', { kind: 'orchestrator' }))).toContainEqual(issue('critic.md', /kind.*"team-role".*"red-team"/));
  });

  it('needs kind "orchestrator" for team_role orchestrator', () => {
    expect(issuesOf(changed('conductor', { kind: 'team-role' }))).toContainEqual(
      issue('conductor.md', /kind.*"orchestrator".*team_role "orchestrator"/),
    );
  });
});

describe('validateSpecs: exactly one orchestrator', () => {
  const second: AgentSpec = { ...fixtureSpec('conductor'), id: 'second', name: 'Olu', order: 7, avatar: '/avatars/second.svg' };

  it('refuses a roster without an orchestrator', () => {
    expect(issuesOf(fixtureSpecs().filter((spec) => spec.id !== 'conductor'))).toEqual([issue('roster', /orchestrator/)]);
  });

  it('refuses a roster with two orchestrators, naming both files', () => {
    expect(issuesOf([...fixtureSpecs(), second])).toEqual([issue('roster', /found 2.*conductor\.md.*second\.md/)]);
  });

  it('counts only active orchestrators', () => {
    const roster = [...changed('conductor', { active: false }), second];

    expect(issuesOf(roster)).toEqual([]);
  });

  it('refuses a roster whose only orchestrator is inactive', () => {
    expect(issuesOf(changed('conductor', { active: false }))).toEqual([issue('roster', /orchestrator/)]);
  });
});

describe('validateSpecs: participation flags', () => {
  it('needs default_selected for a locked agent', () => {
    expect(issuesOf(changed('critic', { defaultSelected: false }))).toEqual([issue('critic.md', /locked.*default_selected/)]);
  });

  it('refuses mention_only on a routable agent', () => {
    expect(issuesOf(changed('labels', { mentionOnly: true }))).toEqual([issue('labels.md', /mention_only.*routable: false/)]);
  });

  it('lets only domain agents be routable', () => {
    const roster = changed('summary', { routable: true, routing: { keywords: ['synthesis'], acronyms: [] } });

    expect(issuesOf(roster)).toEqual([issue('summary.md', /domain.*routable/)]);
  });

  it.each<[(typeof FIXTURE_IDS)[number], Partial<AgentSpec>, RegExp]>([
    ['conductor', { mentionOnly: true }, /orchestrator.*mention_only: false/],
    ['summary', { mentionOnly: true }, /synthesiser.*mention_only: false/],
    ['critic', { mentionOnly: false }, /red-team.*mention_only: true/],
  ])('keeps the team-role semantics of %s: %j', (id, patch, pattern) => {
    expect(issuesOf(changed(id, patch))).toEqual([issue(`${id}.md`, pattern)]);
  });

  it('keeps team roles locked on', () => {
    expect(issuesOf(changed('summary', { locked: false }))).toEqual([issue('summary.md', /locked: true/)]);
  });
});

describe('validateSpecs: routing lists', () => {
  it('needs at least one routing term for a routable agent', () => {
    expect(issuesOf(changed('labels', { routing: { keywords: [], acronyms: [] } }))).toEqual([
      issue('labels.md', /routable.*at least one/),
    ]);
  });

  it('accepts a routable agent with keywords and no acronyms', () => {
    expect(issuesOf(changed('labels', { routing: { keywords: ['labelling'], acronyms: [] } }))).toEqual([]);
  });

  it('refuses routing terms on an agent that is not routable', () => {
    expect(issuesOf(changed('critic', { routing: { keywords: ['challenge'], acronyms: [] } }))).toEqual([
      issue('critic.md', /not routable.*routing/),
    ]);
  });
});

describe('validateSpecs: distinct routing terms', () => {
  it('refuses a keyword that another routable agent has, compared case-insensitively', () => {
    const roster = changed('labels', { routing: { keywords: ['labelling', 'Comparability'], acronyms: ['SmPC'] } });

    expect(issuesOf(roster)).toEqual([issue('labels.md', /"Comparability".*cmc\.md/)]);
  });

  it('refuses an acronym that another routable agent has', () => {
    const roster = changed('labels', { routing: { keywords: ['labelling'], acronyms: ['SmPC', 'CMC'] } });

    expect(issuesOf(roster)).toEqual([issue('labels.md', /"CMC".*cmc\.md/)]);
  });

  it('refuses a keyword that equals another agent\'s acronym, ignoring case', () => {
    const roster = changed('labels', { routing: { keywords: ['labelling', 'cmc'], acronyms: ['SmPC'] } });

    expect(issuesOf(roster)).toEqual([issue('labels.md', /"cmc".*cmc\.md/)]);
  });

  it('ignores the terms of inactive agents', () => {
    const retired: AgentSpec = {
      ...fixtureSpec('cmc'),
      id: 'old-cmc',
      name: 'Cyrus',
      order: 7,
      active: false,
      avatar: '/avatars/old-cmc.svg',
    };

    expect(issuesOf([...fixtureSpecs(), retired])).toEqual([]);
  });
});

describe('validateSpecs: avatars', () => {
  it('needs the avatar path /avatars/<id>.svg', () => {
    expect(issuesOf(changed('labels', { avatar: '/avatars/lena.png' }))).toEqual([issue('labels.md', /\/avatars\/labels\.svg/)]);
  });

  it('refuses an avatar file that does not exist', () => {
    const result = validateSpecs(fixtureSpecs(), { avatarExists: (avatar) => avatar !== '/avatars/labels.svg' });

    expect(result.issues).toEqual([issue('labels.md', /\/avatars\/labels\.svg.*not found/)]);
  });

  it('does not look for the avatar of an inactive agent', () => {
    const result = validateSpecs(changed('labels', { active: false }), { avatarExists: (avatar) => avatar !== '/avatars/labels.svg' });

    expect(result.issues).toEqual([]);
  });

  describe('by default', () => {
    let layout: TempLayout;

    beforeEach(() => {
      layout = makeLayout();
    });

    afterEach(() => {
      layout.cleanup();
    });

    it('looks for avatars in the public folder under the working directory', () => {
      for (const id of FIXTURE_IDS) if (id !== 'labels') writeAvatar(layout, id);
      vi.spyOn(process, 'cwd').mockReturnValue(layout.appDir);

      expect(validateSpecs(fixtureSpecs()).issues).toEqual([issue('labels.md', /\/avatars\/labels\.svg.*not found/)]);
    });
  });
});

describe('validateSpecs: handoffs', () => {
  it('refuses a handoff to an unknown agent', () => {
    expect(issuesOf(changed('labels', { handoffs: ['nobody'] }))).toEqual([issue('labels.md', /"nobody"/)]);
  });

  it('refuses a handoff to the agent itself', () => {
    expect(issuesOf(changed('labels', { handoffs: ['labels'] }))).toEqual([issue('labels.md', /itself/)]);
  });

  it('refuses a handoff listed twice', () => {
    expect(issuesOf(changed('labels', { handoffs: ['lead', 'lead'] }))).toEqual([issue('labels.md', /"lead".*twice/)]);
  });

  it('accepts a handoff to an inactive agent (the registry drops it at load)', () => {
    expect(issuesOf(changed('cmc', { active: false }))).toEqual([]);
  });
});

describe('validateSpecs: sections and allowlist', () => {
  it('refuses an empty section', () => {
    const labels = fixtureSpec('labels');

    expect(issuesOf(changed('labels', { sections: { ...labels.sections, tools: '  ' } }))).toEqual([
      issue('labels.md', /"## Tools".*empty/),
    ]);
  });

  it('needs at least 3 example prompts', () => {
    const labels = fixtureSpec('labels');
    const roster = changed('labels', { sections: { ...labels.sections, examplePrompts: ['One?', 'Two?'] } });

    expect(issuesOf(roster)).toEqual([issue('labels.md', /at least 3.*found 2/)]);
  });

  it('keeps source_allowlist empty in this phase', () => {
    expect(issuesOf(changed('labels', { sourceAllowlist: ['EPAR'] }))).toEqual([issue('labels.md', /source_allowlist/)]);
  });
});

describe('validateSpecs: reporting', () => {
  it('reports every issue, each with its file, not just the first', () => {
    const roster = fixtureSpecs()
      .filter((spec) => spec.id !== 'conductor')
      .map((spec) => {
        if (spec.id === 'labels') return { ...spec, name: 'Mira' };
        if (spec.id === 'critic') return { ...spec, defaultSelected: false };
        return spec;
      });

    const issues = issuesOf(roster);

    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([issue('labels.md', /letter/), issue('critic.md', /default_selected/), issue('roster', /orchestrator/)]),
    );
  });
});
