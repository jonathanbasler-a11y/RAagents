import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { EvalCaseError, findDuplicateIds, formatIssue, loadCases, parseCaseFile, type CaseIssue } from '../evals/lib/cases';

const TOOL_CLAIM = "I(?: have|'ve)? (?:checked|searched)";

/** A valid case as the YAML author writes it (snake_case keys). */
function rawCase(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lead-normal',
    version: 1,
    agent: 'lead',
    category: 'normal',
    risk: 'standard',
    as_of: '2026-10-08',
    turns: [{ role: 'user', content: 'What would you check first for an oral small molecule?\n' }],
    expected: { forbidden_patterns: [TOOL_CLAIM] },
    rubric: ['Leads with what to check first.', 'Marks asset-specific points "to verify".'],
    ...patch,
  };
}

const fileText = (...cases: Record<string, unknown>[]) => stringify({ cases });

function issuesOf(text: string): string[] {
  return parseCaseFile(text, 'lead.yaml').issues.map(formatIssue);
}

/** The one issue a file with this single case produces. */
function onlyIssue(patch: Record<string, unknown>): string {
  const issues = issuesOf(fileText(rawCase(patch)));
  expect(issues).toHaveLength(1);
  return issues[0];
}

describe('parseCaseFile: a valid case', () => {
  it('reads every field, fills the defaults, trims turn text and names the source file', () => {
    const { cases, issues } = parseCaseFile(fileText(rawCase()), 'lead.yaml');

    expect(issues).toEqual([]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toEqual({
      id: 'lead-normal',
      version: 1,
      agent: 'lead',
      category: 'normal',
      risk: 'standard',
      asOf: '2026-10-08',
      humanReservedDecision: false,
      turns: [{ role: 'user', content: 'What would you check first for an oral small molecule?' }],
      expected: { requiredPhrases: [], requiredPatterns: [], forbiddenClaims: [], forbiddenPatterns: [TOOL_CLAIM] },
      rubricOnly: false,
      rubric: ['Leads with what to check first.', 'Marks asset-specific points "to verify".'],
      source: 'lead.yaml',
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('reads a multi-turn case and the optional flags', () => {
    const { cases, issues } = parseCaseFile(
      fileText(
        rawCase({
          category: 'multi-turn',
          human_reserved_decision: true,
          turns: [
            { role: 'user', content: 'Tell me about the asset.' },
            { role: 'assistant', content: 'Here is how I would look at it.' },
            { role: 'user', content: 'So, should we buy it?' },
          ],
          expected: { required_patterns: ['decision owner|RA DD lead'] },
        }),
      ),
      'lead.yaml',
    );

    expect(issues).toEqual([]);
    expect(cases[0]).toMatchObject({ category: 'multi-turn', humanReservedDecision: true, turns: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }] });
  });

  it('accepts a rubric-only case with no deterministic checks', () => {
    const { issues } = parseCaseFile(fileText(rawCase({ expected: undefined, rubric_only: true })), 'lead.yaml');

    expect(issues).toEqual([]);
  });
});

describe('the case hash', () => {
  const hashOf = (patch: Record<string, unknown>) => parseCaseFile(fileText(rawCase(patch)), 'x.yaml').cases[0].hash;

  it('changes with any content the agent or the judge sees', () => {
    const base = hashOf({});
    expect(hashOf({ rubric: ['Something else.'] })).not.toBe(base);
    expect(hashOf({ turns: [{ role: 'user', content: 'Another question?' }] })).not.toBe(base);
    expect(hashOf({ expected: { forbidden_patterns: [TOOL_CLAIM], required_phrases: ['to verify'] } })).not.toBe(base);
    expect(hashOf({ version: 2 })).not.toBe(base);
    expect(hashOf({ as_of: '2026-10-09' })).not.toBe(base);
  });

  it('does not change with key order, YAML layout, trailing spaces in turns or the file the case sits in', () => {
    const base = parseCaseFile(fileText(rawCase()), 'lead.yaml').cases[0].hash;
    const reordered = [
      'cases:',
      '  - rubric: ["Leads with what to check first.", "Marks asset-specific points \\"to verify\\"."]',
      '    expected:',
      `      forbidden_patterns: ["I(?: have|'ve)? (?:checked|searched)"]`,
      '    turns:',
      '      - content: "  What would you check first for an oral small molecule?  "',
      '        role: user',
      '    as_of: "2026-10-08"',
      '    risk: standard',
      '    category: normal',
      '    agent: lead',
      '    version: 1',
      '    id: lead-normal',
    ].join('\n');

    expect(parseCaseFile(reordered, 'other.yaml').cases[0].hash).toBe(base);
  });
});

describe('parseCaseFile: the loader rules (BUILD-LEARNINGS 9.2)', () => {
  it('rejects a case that asserts nothing', () => {
    expect(onlyIssue({ expected: undefined })).toMatch(/lead\.yaml, case lead-normal: .*asserts nothing/);
    expect(onlyIssue({ expected: { required_phrases: [], forbidden_claims: [] } })).toMatch(/asserts nothing/);
  });

  it('rejects a rubric-only case that also has deterministic checks, so the flag cannot hide a check', () => {
    expect(onlyIssue({ rubric_only: true })).toMatch(/rubric_only/);
  });

  it('rejects a case whose last turn is not from the person', () => {
    expect(
      onlyIssue({
        turns: [
          { role: 'user', content: 'What would you check?' },
          { role: 'assistant', content: 'The quality module.' },
        ],
      }),
    ).toMatch(/last turn must come from the person/);
  });

  it('rejects a forbidden claim that already appears in the case text, where a correct echo would trip it', () => {
    expect(
      onlyIssue({
        turns: [{ role: 'user', content: 'Is the orphan designation confirmed?' }],
        expected: { forbidden_claims: ['designation confirmed'] },
      }),
    ).toMatch(/forbidden claim "designation confirmed" already appears in the case text/);
  });

  it('rejects a forbidden pattern that already matches the case text', () => {
    expect(
      onlyIssue({ turns: [{ role: 'user', content: 'I searched the register; what now?' }], expected: { forbidden_patterns: [TOOL_CLAIM] } }),
    ).toMatch(/forbidden pattern .* already matches the case text/);
  });

  it('rejects a required phrase or pattern the case text already contains, because an echo would satisfy it', () => {
    expect(
      onlyIssue({ turns: [{ role: 'user', content: 'Should Quinn look at this?' }], expected: { required_patterns: ['Quinn\\b'] } }),
    ).toMatch(/required pattern "Quinn\\b" already matches the case text/);
    expect(
      onlyIssue({ turns: [{ role: 'user', content: 'What is still to verify?' }], expected: { required_phrases: ['to verify'] } }),
    ).toMatch(/required phrase "to verify" already appears in the case text/);
  });

  it('checks every turn the agent sees, not only the last one', () => {
    expect(
      onlyIssue({
        category: 'multi-turn',
        turns: [
          { role: 'user', content: 'I recommend buying, do you agree?' },
          { role: 'assistant', content: 'That call is for people.' },
          { role: 'user', content: 'Then what should we weigh?' },
        ],
        expected: { forbidden_claims: ['I recommend buying'] },
      }),
    ).toMatch(/already appears in the case text/);
  });
});

describe('parseCaseFile: field checks', () => {
  it('rejects an invalid pattern and a pattern that matches empty text', () => {
    expect(onlyIssue({ expected: { required_patterns: ['(unclosed'] } })).toMatch(/required pattern "\(unclosed" is not a valid regular expression/);
    expect(onlyIssue({ expected: { required_patterns: ['x*'] } })).toMatch(/matches empty text/);
  });

  it('rejects turns that do not start with the person, do not alternate, are empty or are too long', () => {
    expect(onlyIssue({ turns: [] })).toMatch(/turns.*at least one/);
    expect(
      onlyIssue({
        turns: [
          { role: 'assistant', content: 'Hello.' },
          { role: 'user', content: 'Hi?' },
        ],
      }),
    ).toMatch(/turn 1 must come from the person/);
    expect(
      onlyIssue({
        turns: [
          { role: 'user', content: 'One?' },
          { role: 'user', content: 'Two?' },
        ],
      }),
    ).toMatch(/turn 2 must come from the agent/);
    expect(onlyIssue({ turns: [{ role: 'user', content: '   ' }] })).toMatch(/turn 1 is empty/);
    expect(onlyIssue({ turns: [{ role: 'user', content: 'x'.repeat(8001) }] })).toMatch(/turn 1 is longer than 8,000 characters/);
    expect(onlyIssue({ turns: [{ role: 'system', content: 'Be nice.' }] })).toMatch(/turn 1 has role "system"/);
  });

  it('rejects unknown keys at every level, with a hint for a near miss', () => {
    expect(onlyIssue({ forbiden: true })).toMatch(/unknown key "forbiden"/);
    expect(onlyIssue({ expected: { forbidden_patterns: [TOOL_CLAIM], forbiden_claims: ['x'] } })).toMatch(/unknown key "forbiden_claims" in expected/);
    expect(onlyIssue({ humanReservedDecision: true })).toMatch(/unknown key "humanReservedDecision" \(did you mean "human_reserved_decision"\?\)/);
    expect(issuesOf(fileText(rawCase({ asOf: '2026-10-08', as_of: undefined })))).toEqual([
      expect.stringMatching(/unknown key "asOf" \(did you mean "as_of"\?\)/),
      expect.stringMatching(/missing required key "as_of"/),
    ]);
    expect(onlyIssue({ turns: [{ role: 'user', content: 'Hi?', name: 'x' }] })).toMatch(/turn 1 has unknown key "name"/);
    expect(issuesOf(stringify({ cases: [rawCase()], extra: 1 })).join('\n')).toMatch(/unknown top-level key "extra"/);
  });

  it('rejects bad values for id, version, agent, category, risk, as_of and the flags', () => {
    expect(onlyIssue({ id: 'Lead Normal' })).toMatch(/id "Lead Normal" must be lowercase/);
    expect(onlyIssue({ version: 0 })).toMatch(/version must be a whole number from 1/);
    expect(onlyIssue({ agent: 'Lead' })).toMatch(/agent "Lead" is not an agent id/);
    expect(onlyIssue({ category: 'easy' })).toMatch(/category must be one of normal, grounded, tool, adversarial, multi-turn/);
    expect(onlyIssue({ risk: 'low' })).toMatch(/risk must be one of standard, sensitive, factual, side-effect/);
    expect(onlyIssue({ as_of: '2026-02-30' })).toMatch(/as_of must be a date written YYYY-MM-DD/);
    expect(onlyIssue({ human_reserved_decision: 'yes' })).toMatch(/human_reserved_decision must be true or false/);
    expect(onlyIssue({ rubric: [] })).toMatch(/rubric must list at least one criterion/);
    expect(onlyIssue({ rubric: ['Fine.', ' '] })).toMatch(/rubric criterion 2 is empty/);
  });

  it('reports every problem in the file, each naming the file and the case', () => {
    const issues = issuesOf(fileText(rawCase({ id: 'a-1', risk: 'low' }), rawCase({ id: 'a-2', category: 'easy', expected: undefined })));

    expect(issues).toEqual([
      expect.stringMatching(/^lead\.yaml, case a-1: risk/),
      expect.stringMatching(/^lead\.yaml, case a-2: category/),
      expect.stringMatching(/^lead\.yaml, case a-2: .*asserts nothing/),
    ]);
  });

  it('reports YAML errors and a file without a cases list', () => {
    expect(issuesOf('cases:\n  - id: [unclosed\n').join('\n')).toMatch(/^lead\.yaml: YAML error on line \d+/);
    expect(issuesOf('id: x\n').join('\n')).toMatch(/unknown top-level key "id"/);
    expect(issuesOf('{}\n').join('\n')).toMatch(/a "cases" list/);
    expect(issuesOf(stringify({ cases: [] })).join('\n')).toMatch(/a "cases" list with at least one case/);
  });
});

describe('findDuplicateIds', () => {
  it('rejects duplicate ids, naming both places', () => {
    const first = parseCaseFile(fileText(rawCase()), 'a.yaml').cases;
    const second = parseCaseFile(fileText(rawCase()), 'b.yaml').cases;

    expect(findDuplicateIds([...first, ...second]).map(formatIssue)).toEqual(['b.yaml, case lead-normal: duplicate id; a.yaml already has a case with this id']);
  });
});

describe('loadCases', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function folder(files: Record<string, string>): string {
    dir = mkdtempSync(path.join(tmpdir(), 'eval-cases-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    return dir;
  }

  function loadIssues(target: string): CaseIssue[] {
    try {
      loadCases(target);
    } catch (error) {
      if (error instanceof EvalCaseError) return error.issues;
      throw error;
    }
    throw new Error('expected an EvalCaseError');
  }

  it('reads the .yaml and .yml files in name order, skipping other files', () => {
    const target = folder({
      'b.yml': fileText(rawCase({ id: 'b-1' })),
      'a.yaml': fileText(rawCase({ id: 'a-1' }), rawCase({ id: 'a-2' })),
      'README.md': '# not a case file',
    });

    expect(loadCases(target).map((evalCase) => [evalCase.source, evalCase.id])).toEqual([
      ['a.yaml', 'a-1'],
      ['a.yaml', 'a-2'],
      ['b.yml', 'b-1'],
    ]);
  });

  it('throws one error listing every issue of every file, duplicates included', () => {
    const target = folder({ 'a.yaml': fileText(rawCase()), 'b.yaml': fileText(rawCase(), rawCase({ id: 'b-2', risk: 'low' })) });

    const issues = loadIssues(target).map(formatIssue);

    expect(issues).toEqual([
      expect.stringMatching(/^b\.yaml, case b-2: risk/),
      'b.yaml, case lead-normal: duplicate id; a.yaml already has a case with this id',
    ]);
  });

  it('throws when the folder has no case files', () => {
    expect(loadIssues(folder({ 'README.md': '#' })).map(formatIssue).join('\n')).toMatch(/no case files/);
  });

  it('throws when the folder does not exist, naming the folder', () => {
    expect(() => loadCases(path.join(tmpdir(), 'no-such-eval-cases-folder'))).toThrow(/eval cases folder not found/);
  });
});
