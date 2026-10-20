import { describe, expect, it } from 'vitest';
import { buildBriefing, briefingToMarkdown, type BriefingInput } from './briefing';
import {
  CHECKLIST_ITEM_IDS,
  LOCAL_PERSON,
  type ChecklistEntry,
  type ChecklistItemId,
  type ChecklistState,
  type Finding,
  type FindingCategory,
  type FindingTag,
  type OpenQuestion,
} from './contracts';

// The briefing is built by code from the register, the tags and the checklist. It lists only what a person accepted and
// tagged, says plainly what is missing, keeps the four checklist states apart, and contains none of the decisions
// reserved for people. Nothing an agent wrote about the whole case is in it, because no agent wrote one.

const GENERATED_AT = '2026-10-19T10:00:00.000Z';

function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    workspaceId: 'demo',
    claim: `Claim of ${id}`,
    quote: `Quote of ${id}, long enough to count.`,
    documentId: 'DR-01',
    documentTitle: 'Licensor overview',
    sourceType: 'company-disclosure',
    basis: 'attributed',
    publishedAt: '2026-07-14',
    asOf: '2026-10-12',
    confidence: 'medium',
    confidenceReason: 'Explicit.',
    assumptions: [],
    owner: 'Regulatory lead agent owner',
    status: 'accepted',
    draftedBy: { agentId: 'reglead', agentName: 'Rosa', agentVersion: '1', model: 'm', promptHash: 'h', turnId: 't1' },
    createdAt: '2026-10-12T08:00:00.000Z',
    decidedAt: '2026-10-12T09:00:00.000Z',
    decidedBy: LOCAL_PERSON,
    decisionNote: null,
    ...overrides,
  };
}

const tag = (findingId: string, checklistItem: ChecklistItemId, category: FindingCategory): FindingTag => ({
  findingId,
  checklistItem,
  category,
  taggedAt: '2026-10-12T09:00:00.000Z',
  taggedBy: LOCAL_PERSON,
});

function checklist(states: Partial<Record<ChecklistItemId, { state: ChecklistState; reason?: string }>> = {}): ChecklistEntry[] {
  return CHECKLIST_ITEM_IDS.map((item) => ({
    item,
    state: states[item]?.state ?? 'not_checked',
    reason: states[item]?.reason ?? null,
    changedAt: states[item] ? '2026-10-12T09:30:00.000Z' : null,
    changedBy: states[item] ? LOCAL_PERSON : null,
  }));
}

const question = (id: string, claim: string, documentId: string | null = 'DR-04'): OpenQuestion => ({
  id,
  workspaceId: 'demo',
  claim,
  reasonCode: 'quote_not_in_document',
  reason: 'The quote is not in the document.',
  documentId,
  raisedBy: { agentId: 'reglead', agentName: 'Rosa', turnId: 't1' },
  createdAt: '2026-10-12T08:00:00.000Z',
});

const ROOM = {
  asOf: '2026-10-12',
  documents: [
    { id: 'DR-01', title: 'Licensor overview', sourceType: 'company-disclosure' as const, publishedAt: '2026-07-14', provided: true, withdrawnAt: null },
    { id: 'DR-02', title: 'Agency minutes', sourceType: 'agency-record' as const, publishedAt: '2026-03-20', provided: true, withdrawnAt: null },
    { id: 'DR-09', title: 'Paediatric study plan', sourceType: 'company-disclosure' as const, publishedAt: null, provided: false, withdrawnAt: null },
  ],
};

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return { dataRoom: ROOM, findings: [], tags: [], openQuestions: [], checklist: checklist(), ...overrides };
}

const build = (overrides: Partial<BriefingInput> = {}) => buildBriefing(input(overrides));
const codes = (overrides: Partial<BriefingInput> = {}) => build(overrides).warnings.map((warning) => warning.code);

/** A register with something in every place: sorted, unsorted, undecided, rejected and unsupported. */
function mixed(): Partial<BriefingInput> {
  return {
    findings: [
      finding('F-001', { claim: 'The licensor says one study is enough.', decisionNote: 'Matches the minutes.' }),
      finding('F-002', { claim: 'The agency did not agree a single study.', documentId: 'DR-02', documentTitle: 'Agency minutes', sourceType: 'agency-record', basis: 'primary-record', publishedAt: '2026-03-20' }),
      finding('F-003', { claim: 'An orphan designation is held in the US.' }),
      finding('F-004', { claim: 'Accepted but never tagged.' }),
      finding('F-005', { claim: 'Still a draft.', status: 'draft', decidedAt: null, decidedBy: null }),
      finding('F-006', { claim: 'Rejected by a person.', status: 'rejected' }),
      finding('F-007', { claim: 'Timing of the filing plan.' }),
    ],
    tags: [tag('F-001', 'regions', 'risk'), tag('F-002', 'regions', 'risk'), tag('F-003', 'designations', 'positive'), tag('F-007', 'ptrs-inputs', 'neutral')],
    openQuestions: [question('Q-001', 'The paediatric plan is agreed.', 'DR-09')],
    checklist: checklist({ regions: { state: 'checked' }, designations: { state: 'not_applicable', reason: 'Not an orphan product.' }, bottlenecks: { state: 'could_not_check', reason: 'The filing plan was not provided.' } }),
  };
}

describe('buildBriefing: what is in it', () => {
  it('sorts accepted, tagged findings by the tag, in id order, and nothing else', () => {
    const briefing = build(mixed());

    expect(briefing.risks.map((entry) => entry.id)).toEqual(['F-001', 'F-002']);
    expect(briefing.positives.map((entry) => entry.id)).toEqual(['F-003']);
    expect(briefing.neutral.map((entry) => entry.id)).toEqual(['F-007']);
    expect(briefing.unsorted.map((entry) => entry.id)).toEqual(['F-004']);
    expect(briefing.ptrsInputs.map((entry) => entry.id)).toEqual(['F-007']);
  });

  it('leaves a draft and a rejected finding out entirely, counting them', () => {
    const briefing = build(mixed());
    const everywhere = JSON.stringify(briefing);

    expect(everywhere).not.toContain('Still a draft.');
    expect(everywhere).not.toContain('Rejected by a person.');
    expect(briefing.counts).toEqual({ acceptedTagged: 4, acceptedUntagged: 1, drafts: 1, rejected: 1, openQuestions: 1 });
  });

  it('carries the claim, the word-for-word quote, the document, the basis and the person’s note', () => {
    const [first] = build(mixed()).risks;

    expect(first).toEqual({
      id: 'F-001',
      claim: 'The licensor says one study is enough.',
      quote: 'Quote of F-001, long enough to count.',
      documentId: 'DR-01',
      documentTitle: 'Licensor overview',
      sourceType: 'company-disclosure',
      basis: 'attributed',
      publishedAt: '2026-07-14',
      confidence: 'medium',
      checklistItem: 'regions',
      category: 'risk',
      documentWithdrawn: false,
      decisionNote: 'Matches the minutes.',
    });
  });

  it('lists the six checklist items in order with their state, reason and the findings behind them', () => {
    const { checklist: rows } = build(mixed());

    expect(rows.map((row) => row.item)).toEqual([...CHECKLIST_ITEM_IDS]);
    expect(rows.find((row) => row.item === 'regions')).toMatchObject({ state: 'checked', findingIds: ['F-001', 'F-002'] });
    expect(rows.find((row) => row.item === 'designations')).toMatchObject({ state: 'not_applicable', reason: 'Not an orphan product.', findingIds: ['F-003'] });
    expect(rows.find((row) => row.item === 'bottlenecks')).toMatchObject({ state: 'could_not_check', reason: 'The filing plan was not provided.', findingIds: [] });
    expect(rows.find((row) => row.item === 'guidance')).toMatchObject({ state: 'not_checked', reason: null, findingIds: [] });
  });

  it('puts every "could not check" item among the open questions, with its reason, next to the register’s open questions', () => {
    const briefing = build(mixed());

    expect(briefing.openQuestions).toEqual([{ id: 'Q-001', claim: 'The paediatric plan is agreed.', reason: 'The quote is not in the document.', documentId: 'DR-09' }]);
    expect(briefing.couldNotCheck).toEqual([{ item: 'bottlenecks', label: 'Bottleneck hunt', reason: 'The filing plan was not provided.' }]);
  });

  it('lists the data room’s documents, including one listed but not provided', () => {
    const briefing = build();

    expect(briefing.asOf).toBe('2026-10-12');
    expect(briefing.documents.map((document) => [document.id, document.provided, document.withdrawn])).toEqual([['DR-01', true, false], ['DR-02', true, false], ['DR-09', false, false]]);
  });

  it('keeps an item’s findings that were tagged to it but are not accepted out of the item', () => {
    const briefing = build({ findings: [finding('F-001', { status: 'rejected' })], tags: [tag('F-001', 'regions', 'risk')] });

    expect(briefing.checklist.find((row) => row.item === 'regions')?.findingIds).toEqual([]);
    expect(briefing.risks).toEqual([]);
  });
});

describe('buildBriefing: what it says is missing', () => {
  it('says there is no data room, and shows six items not checked', () => {
    const briefing = build({ dataRoom: null });

    expect(codes({ dataRoom: null })).toContain('no_data_room');
    expect(briefing.asOf).toBeNull();
    expect(briefing.documents).toEqual([]);
    expect(briefing.checklist.every((row) => row.state === 'not_checked')).toBe(true);
  });

  it('warns about drafts nobody has decided, saying they are not in the briefing', () => {
    const warning = build(mixed()).warnings.find((entry) => entry.code === 'drafts_pending');

    expect(warning?.message).toMatch(/1 draft finding is not decided/);
    expect(warning?.message).toMatch(/not in this briefing/);
    expect(codes({ findings: [finding('F-001')], tags: [tag('F-001', 'regions', 'risk')] })).not.toContain('drafts_pending');
  });

  it('warns about accepted findings with no tag, which sit under "not yet sorted"', () => {
    const warning = build(mixed()).warnings.find((entry) => entry.code === 'untagged_accepted');

    expect(warning?.message).toMatch(/1 accepted finding has no checklist item or kind/);
    expect(codes({ findings: [finding('F-001')], tags: [tag('F-001', 'regions', 'risk')] })).not.toContain('untagged_accepted');
  });

  it('flags a finding whose document was withdrawn after it was accepted, inline and as a warning', () => {
    const room = { ...ROOM, documents: ROOM.documents.map((document) => (document.id === 'DR-02' ? { ...document, withdrawnAt: '2026-10-13T08:00:00.000Z' } : document)) };
    const briefing = build({ ...mixed(), dataRoom: room });

    expect(briefing.risks.find((entry) => entry.id === 'F-002')?.documentWithdrawn).toBe(true);
    expect(briefing.risks.find((entry) => entry.id === 'F-001')?.documentWithdrawn).toBe(false);
    const warning = briefing.warnings.find((entry) => entry.code === 'withdrawn_document');
    expect(warning?.message).toMatch(/F-002/);
    expect(warning?.message).not.toMatch(/F-001/);
    expect(briefing.documents.find((document) => document.id === 'DR-02')?.withdrawn).toBe(true);
  });

  it('warns when an item is "checked" only on findings whose documents were withdrawn, and not when one live finding remains', () => {
    const withdrawn = (ids: string[]) => ({ ...ROOM, documents: ROOM.documents.map((document) => (ids.includes(document.id) ? { ...document, withdrawnAt: '2026-10-13T08:00:00.000Z' } : document)) });

    const onlyWithdrawn = build({ ...mixed(), dataRoom: withdrawn(['DR-01', 'DR-02']) }).warnings.find((entry) => entry.code === 'checked_on_withdrawn');
    expect(onlyWithdrawn?.message).toMatch(/Regional differences/);

    const oneLive = build({ ...mixed(), dataRoom: withdrawn(['DR-02']) }).warnings.find((entry) => entry.code === 'checked_on_withdrawn');
    expect(oneLive).toBeUndefined();
  });

  it('counts the items nobody checked and the items that could not be checked, apart', () => {
    const warnings = build(mixed()).warnings;

    expect(warnings.find((entry) => entry.code === 'items_not_checked')?.message).toMatch(/3 of 6 checklist items are not checked/);
    expect(warnings.find((entry) => entry.code === 'items_could_not_check')?.message).toMatch(/1 checklist item could not be checked/);
    expect(codes({ checklist: checklist(Object.fromEntries(CHECKLIST_ITEM_IDS.map((item) => [item, { state: 'not_applicable' as const, reason: 'x' }]))) })).toEqual([]);
  });

  it('has no warnings for a complete, sorted register', () => {
    const all = Object.fromEntries(CHECKLIST_ITEM_IDS.map((item) => [item, { state: 'not_applicable' as const, reason: 'Does not apply.' }]));

    expect(codes({ checklist: checklist(all) })).toEqual([]);
  });
});

describe('buildBriefing: it is the same every time', () => {
  it('gives equal results for equal input, and does not change its input', () => {
    const given = input(mixed());
    const before = JSON.stringify(given);

    expect(buildBriefing(given)).toEqual(buildBriefing(given));
    expect(JSON.stringify(given)).toBe(before);
  });
});

describe('briefingToMarkdown', () => {
  const markdown = (overrides: Partial<BriefingInput> = {}) => briefingToMarkdown(build(overrides), GENERATED_AT);

  it('starts with the title, the as-of date and when it was prepared', () => {
    const text = markdown(mixed());

    expect(text.startsWith('# Regulatory due diligence briefing\n')).toBe(true);
    expect(text).toContain('Data room as of 2026-10-12 · prepared 2026-10-19T10:00:00.000Z from the findings register and the checklist.');
  });

  it('says in its first paragraph that it is not a decision, and what is reserved for people', () => {
    const text = markdown();

    expect(text).toMatch(/This is a briefing, not a decision\./);
    expect(text).toMatch(/Deal-breakers, the overall assessment and the recommendation are reserved for people\./);
    expect(text).toMatch(/what the seller states, not verified fact/);
  });

  it('has the sections in order: before you read, what was checked, positives, risks, neutral, not yet sorted, open questions, PTRS, mitigations', () => {
    const text = markdown(mixed());
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    expect(headings).toEqual([
      'Before you read',
      'What was checked',
      'Positives',
      'Risks',
      'Neutral',
      'Not yet sorted',
      'Open questions',
      'Inputs to the regulatory part of PTRS',
      'Possible mitigations',
    ]);
  });

  it('keeps the four states in words, with reasons, in "what was checked"', () => {
    const section = markdown(mixed()).split('## What was checked')[1].split('\n## ')[0];

    expect(section).toContain('**Regional differences**: Checked. Findings: F-001, F-002.');
    expect(section).toContain('**Special designations**: Checked: not applicable. Reason: Not an orphan product. Findings: F-003.');
    expect(section).toContain('**Bottleneck hunt**: Could not check. Reason: The filing plan was not provided.');
    expect(section).toContain('**Applicable guidance**: Not checked.');
  });

  it('shows a finding with its claim, the quote, the source, the basis, the confidence and the note', () => {
    const text = markdown(mixed());

    expect(text).toContain('### F-001 · Regional differences');
    expect(text).toContain('The licensor says one study is enough.');
    expect(text).toContain('> Quote of F-001, long enough to count.');
    expect(text).toContain('Source: DR-01, Licensor overview (company disclosure, dated 2026-07-14).');
    expect(text).toContain('Basis: Attributed: what the seller states, not verified fact. Confidence in the quote: Medium.');
    expect(text).toContain('Note from the person who accepted it: Matches the minutes.');
  });

  it('marks a finding whose document was withdrawn', () => {
    const room = { ...ROOM, documents: ROOM.documents.map((document) => (document.id === 'DR-02' ? { ...document, withdrawnAt: '2026-10-13T08:00:00.000Z' } : document)) };

    expect(markdown({ ...mixed(), dataRoom: room })).toContain('Its document has been withdrawn from the data room since it was accepted.');
  });

  it('writes "none" under an empty section rather than leaving it out', () => {
    const text = markdown();

    for (const heading of ['Positives', 'Risks', 'Neutral']) {
      expect(text.split(`## ${heading}`)[1].split('\n## ')[0]).toContain('None accepted and tagged yet.');
    }
    expect(text).not.toContain('## Not yet sorted');
  });

  it('lists open questions and the items that could not be checked together', () => {
    const section = markdown(mixed()).split('## Open questions')[1].split('\n## ')[0];

    expect(section).toContain('Q-001: The paediatric plan is agreed. Not a finding: The quote is not in the document.');
    expect(section).toContain('Could not check: Bottleneck hunt. The filing plan was not provided.');
  });

  it('says the app computes no PTRS number and lists the findings tagged to it, or says there are none', () => {
    const withOne = markdown(mixed()).split('## Inputs to the regulatory part of PTRS')[1].split('\n## ')[0];
    const none = markdown().split('## Inputs to the regulatory part of PTRS')[1].split('\n## ')[0];

    expect(withOne).toContain('The app computes no number');
    expect(withOne).toContain('F-007');
    expect(none).toContain('No accepted finding is tagged to this item yet.');
  });

  it('leaves the mitigations to the people, and drafts none', () => {
    const section = markdown(mixed()).split('## Possible mitigations')[1];

    expect(section).toContain('For the regulatory lead and the functions to add. The app does not draft mitigations.');
  });

  it('puts each warning under "before you read"', () => {
    const section = markdown(mixed()).split('## Before you read')[1].split('\n## ')[0];

    expect(section).toContain('1 draft finding is not decided');
    expect(section).toContain('1 accepted finding has no checklist item or kind');
  });

  it('never contains a draft, a rejected finding, a buy or acquire call, or text no person accepted', () => {
    const text = markdown(mixed());

    expect(text).not.toContain('Still a draft.');
    expect(text).not.toContain('Rejected by a person.');
    expect(text).not.toMatch(/\b(buy|acquire|acquisition|go\/no-go|proceed with the deal|deal-breaker found)\b/i);
  });

  it('is the same every time', () => {
    expect(markdown(mixed())).toBe(markdown(mixed()));
  });
});
