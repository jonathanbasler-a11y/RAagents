import { describe, expect, it } from 'vitest';
import { AgentSpecError, parseAgentSpec } from '@/server/agents';
import type { AgentSpec } from '@/shared/contracts';
import { bodyFromParts, bodyParts, fixtureSpec, specIssues, specText } from './test-fixtures';

// One spec written out by hand, and the AgentSpec it must produce (also by hand).
const LABELS_MD = `---
id: labels
name: Lena
letter: L
capability: Labelling
short_capability: Labels
group: core
kind: domain
order: 3
autonomy_level: 2
human_owner: Labelling agent owner
active: true
version: "0.1.0"
model_route: agents
routing:
  keywords:
    - labelling
    - product information
  acronyms:
    - SmPC
routable: true
mention_only: false
locked: false
default_selected: false
trigger: late
handoffs:
  - lead
source_allowlist: []
avatar: /avatars/labels.svg
planned_remit: Compares product information across regions.
---

## Role

Lena covers labelling questions.
She leaves the rest to teammates.

## In this phase

No documents are connected.

## Persona and voice

Lena writes plain sentences.

### Habits

When regions matter, she goes region by region.

## Planned knowledge sources

- FDA labels (public): not connected

## Tools

None in this phase.

## Guardrails

- Public information only.

## Escalation lines

- "Have the labelling lead check this."

## Human owner

Labelling agent owner.

## Autonomy level

Level 2, Collaborate.

## Example prompts

- What does a label review cover?
- Which label differences would a reviewer flag
  first in a new region?
* How would you plan a check of three labels?
`;

const LABELS_SPEC: AgentSpec = {
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
  active: true,
  version: '0.1.0',
  modelRoute: 'agents',
  routing: { keywords: ['labelling', 'product information'], acronyms: ['SmPC'] },
  routable: true,
  mentionOnly: false,
  locked: false,
  defaultSelected: false,
  trigger: 'late',
  handoffs: ['lead'],
  sourceAllowlist: [],
  avatar: '/avatars/labels.svg',
  plannedRemit: 'Compares product information across regions.',
  sections: {
    role: 'Lena covers labelling questions.\nShe leaves the rest to teammates.',
    inThisPhase: 'No documents are connected.',
    personaAndVoice: 'Lena writes plain sentences.\n\n### Habits\n\nWhen regions matter, she goes region by region.',
    plannedKnowledgeSources: '- FDA labels (public): not connected',
    tools: 'None in this phase.',
    guardrails: '- Public information only.',
    escalationLines: '- "Have the labelling lead check this."',
    humanOwner: 'Labelling agent owner.',
    autonomyLevel: 'Level 2, Collaborate.',
    examplePrompts: [
      'What does a label review cover?',
      'Which label differences would a reviewer flag first in a new region?',
      'How would you plan a check of three labels?',
    ],
  },
};

const labels = fixtureSpec('labels');

/** Issues from parsing the labels fixture with some front-matter fields changed. */
function frontIssues(front: Record<string, unknown>, fileName = 'labels.md') {
  return specIssues(() => parseAgentSpec(specText(labels, { front }), fileName));
}

/** Issues from parsing the labels fixture with a different body. */
function bodyIssues(body: string) {
  return specIssues(() => parseAgentSpec(specText(labels, { body }), 'labels.md'));
}

const issue = (pattern: RegExp, source = 'labels.md') => expect.objectContaining({ source, message: expect.stringMatching(pattern) });

describe('parseAgentSpec: a valid spec', () => {
  it('maps the snake_case front matter to AgentSpec fields and splits the body into the ten sections', () => {
    expect(parseAgentSpec(LABELS_MD, 'labels.md')).toEqual(LABELS_SPEC);
  });

  it('accepts Windows line endings and a byte-order mark', () => {
    const windows = `\uFEFF${LABELS_MD.replace(/\n/g, '\r\n')}`;

    expect(parseAgentSpec(windows, 'labels.md')).toEqual(LABELS_SPEC);
  });

  it('leaves optional fields out when the spec leaves them out', () => {
    const spec = parseAgentSpec(specText(fixtureSpec('lead')), 'lead.md');

    expect(spec).not.toHaveProperty('shortCapability');
    expect(spec).not.toHaveProperty('teamRole');
    expect(spec).not.toHaveProperty('trigger');
  });

  it('reads team_role for a team-role agent', () => {
    expect(parseAgentSpec(specText(fixtureSpec('critic')), 'critic.md').teamRole).toBe('red-team');
  });

  it('does not treat a "## " line inside a fenced code block as a section heading', () => {
    const parts = bodyParts(labels.sections);
    parts[2] = ['Persona and voice', 'Lena writes plain sentences.\n\n```markdown\n## Not a heading\n```'];

    const spec = parseAgentSpec(specText(labels, { body: bodyFromParts(parts) }), 'labels.md');

    expect(spec.sections.personaAndVoice).toBe('Lena writes plain sentences.\n\n```markdown\n## Not a heading\n```');
  });
});

describe('parseAgentSpec: front matter', () => {
  it('refuses a file that does not start with front matter', () => {
    const text = specText(labels).replace(/^---\n/, '');

    expect(specIssues(() => parseAgentSpec(text, 'labels.md'))).toEqual([issue(/front matter/i)]);
  });

  it('refuses front matter without a closing --- line', () => {
    const text = '---\nid: labels\nname: Lena\n\n## Role\n\nText.\n';

    expect(specIssues(() => parseAgentSpec(text, 'labels.md'))).toEqual([issue(/closing "---"/)]);
  });

  it('reports invalid YAML', () => {
    const text = specText(labels).replace('name: Lena', 'name: "Lena');

    expect(specIssues(() => parseAgentSpec(text, 'labels.md'))).toContainEqual(issue(/YAML/));
  });

  it('refuses a key given twice, with its line in the file', () => {
    // Line 1 is "---", so the second `name` is on line 4.
    const text = specText(labels).replace('name: Lena\n', 'name: Lena\nname: Lena\n');

    expect(specIssues(() => parseAgentSpec(text, 'labels.md'))).toEqual([issue(/line 4.*unique/i)]);
  });

  it('refuses front matter that is not a mapping of fields', () => {
    const text = `---\n- id\n- name\n---\n\n${'## Role\n\nText.\n'}`;

    expect(specIssues(() => parseAgentSpec(text, 'labels.md'))).toContainEqual(issue(/mapping/));
  });

  it('refuses an unknown key and suggests the right spelling', () => {
    expect(frontIssues({ 'mention-only': false })).toEqual([issue(/unknown.*"mention-only".*mention_only/)]);
  });

  it('reports every missing required key', () => {
    expect(frontIssues({ human_owner: undefined, version: undefined })).toEqual([
      issue(/missing.*"human_owner"/),
      issue(/missing.*"version"/),
    ]);
  });

  it('refuses a key that has no value', () => {
    expect(frontIssues({ human_owner: null })).toEqual([issue(/human_owner.*no value/)]);
  });

  it('refuses an optional key that has no value instead of leaving it out', () => {
    expect(frontIssues({ trigger: null })).toEqual([issue(/trigger.*no value/)]);
  });

  it.each<[string, unknown, RegExp]>([
    ['active', 'yes', /active.*true or false/],
    ['routable', 1, /routable.*true or false/],
    ['order', 1.5, /order.*whole number/],
    ['order', 0, /order.*whole number/],
    ['autonomy_level', 4, /autonomy_level.*1, 2 or 3/],
    ['autonomy_level', '2', /autonomy_level.*1, 2 or 3/],
    ['version', 0.1, /version.*quote/],
    ['version', '1.0', /version.*MAJOR\.MINOR\.PATCH/],
    ['name', '', /name.*text/],
    ['capability', 42, /capability.*text/],
    ['short_capability', '  ', /short_capability.*text/],
    ['planned_remit', ['Compares labels.'], /planned_remit.*text/],
    ['letter', 'l', /letter.*one capital letter/],
    ['letter', 'LE', /letter.*one capital letter/],
    ['routing', 'labelling', /routing.*mapping/],
    ['handoffs', 'lead', /handoffs.*list/],
    ['handoffs', ['Lead'], /handoffs.*"Lead"/],
    ['source_allowlist', [42], /source_allowlist.*text/],
  ])('refuses %s: %j', (key, value, pattern) => {
    expect(frontIssues({ [key]: value })).toEqual([issue(pattern)]);
  });

  it.each<[string, unknown, RegExp]>([
    ['group', 'Core', /group.*core, spec, role, other/],
    ['kind', 'specialist', /kind.*orchestrator, domain, team-role/],
    ['team_role', 'critic', /team_role.*orchestrator, sanitiser, evidence-checker, red-team, synthesiser/],
    ['model_route', 'judge', /model_route.*agents/],
    ['trigger', 'urgent', /trigger.*orphan, paed, exp, combo, cdx, late/],
  ])('refuses %s outside its allowed values: %j', (key, value, pattern) => {
    expect(frontIssues({ [key]: value })).toEqual([issue(pattern)]);
  });
});

describe('parseAgentSpec: id', () => {
  it('refuses an id that does not match the file name', () => {
    expect(frontIssues({}, 'label.md')).toEqual([issue(/id "labels".*file name "label\.md"/, 'label.md')]);
  });

  it('refuses an id that is not lowercase letters, digits and hyphens', () => {
    expect(frontIssues({ id: 'Labels' }, 'Labels.md')).toEqual([issue(/id "Labels".*lowercase/, 'Labels.md')]);
  });

  it('reserves the id "team" for the team chat', () => {
    expect(frontIssues({ id: 'team' }, 'team.md')).toEqual([issue(/"team".*reserved/, 'team.md')]);
  });
});

describe('parseAgentSpec: routing', () => {
  it('needs both routing lists', () => {
    expect(frontIssues({ routing: { keywords: ['labelling'] } })).toEqual([issue(/routing\.acronyms/)]);
  });

  it('refuses unknown routing keys', () => {
    expect(frontIssues({ routing: { keywords: ['labelling'], acronyms: [], tags: ['label'] } })).toEqual([
      issue(/unknown.*routing\.tags/),
    ]);
  });

  it('refuses empty routing terms', () => {
    expect(frontIssues({ routing: { keywords: ['labelling', ' '], acronyms: [] } })).toEqual([issue(/routing\.keywords/)]);
  });

  it('refuses an acronym that contains a space', () => {
    expect(frontIssues({ routing: { keywords: ['labelling'], acronyms: ['Sm PC'] } })).toEqual([
      issue(/routing\.acronyms.*"Sm PC"/),
    ]);
  });
});

describe('parseAgentSpec: body sections', () => {
  it('reports a missing section', () => {
    const parts = bodyParts(labels.sections).filter(([heading]) => heading !== 'Tools');

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/missing section "## Tools"/)]);
  });

  it('refuses an unknown section heading', () => {
    const parts = bodyParts(labels.sections);
    parts.splice(5, 0, ['Notes', 'Extra text.']);

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/unknown section "## Notes"/)]);
  });

  it('names the exact heading when only the case differs', () => {
    const parts = bodyParts(labels.sections);
    parts[1] = ['In This Phase', parts[1][1]];

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/"## In This Phase".*"## In this phase"/)]);
  });

  it('refuses a section that appears twice', () => {
    const parts = bodyParts(labels.sections);
    parts.splice(5, 0, ['Tools', 'More tools text.']);

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/"## Tools".*2 times/)]);
  });

  it('refuses sections out of order', () => {
    const parts = bodyParts(labels.sections);
    [parts[4], parts[5]] = [parts[5], parts[4]];

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/out of order/)]);
  });

  it('refuses text between the front matter and "## Role"', () => {
    expect(bodyIssues(`An introduction.\n\n${bodyFromParts(bodyParts(labels.sections))}`)).toEqual([
      issue(/before "## Role"/),
    ]);
  });

  it('refuses example prompts that are not a bullet list', () => {
    const parts = bodyParts(labels.sections);
    parts[9] = ['Example prompts', 'Try these:\n- One?\n- Two?\n- Three?'];

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/bullet.*"Try these:"/)]);
  });

  it('refuses an empty example prompt bullet', () => {
    const parts = bodyParts(labels.sections);
    parts[9] = ['Example prompts', '- One?\n- \n- Two?\n- Three?'];

    expect(bodyIssues(bodyFromParts(parts))).toEqual([issue(/empty bullet/)]);
  });
});

describe('parseAgentSpec: error reporting', () => {
  it('collects every problem in the file into one AgentSpecError that names the file', () => {
    const parts = bodyParts(labels.sections).filter(([heading]) => heading !== 'Tools');
    const text = specText(labels, { front: { active: 'yes', group: 'Core' }, body: bodyFromParts(parts) });

    let thrown: unknown;
    try {
      parseAgentSpec(text, 'labels.md');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentSpecError);
    const error = thrown as AgentSpecError;
    expect(error.issues).toHaveLength(3);
    expect(error.issues).toEqual(expect.arrayContaining([issue(/group/), issue(/active/), issue(/## Tools/)]));
    expect(error.message).toMatch(/labels\.md: .*group/);
    expect(error.message).toMatch(/labels\.md: .*active/);
    expect(error.message).toMatch(/labels\.md: .*## Tools/);
  });
});
