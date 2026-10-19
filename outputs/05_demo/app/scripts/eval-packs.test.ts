import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { parseCaseFile } from '../evals/lib/cases';
import { DATA_ROOM_INSTRUCTIONS } from '@/server/prompts/data-room';
import { bindPacks, caseMaterial, loadPack, loadPacks, type CasePack } from '../evals/lib/packs';

// Case packs: fictional practice documents plus the answer key, kept with the cases. The loader
// refuses anything that could make a run unfair or unsafe: a document dated after the case's
// as-of date, a document that does not say it is fictional, a key that points nowhere.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const DOC_TEXT = (title: string) => `# ${title}\n\nFictional practice document. Invented for an exercise.\n\nThe licensor says the pivotal study met its endpoint.\n`;

function rawPack(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'practice-01',
    title: 'Practice case 01',
    as_of: '2026-10-12',
    documents: [
      { id: 'DR-01', title: 'Overview', file: 'dr-01.md', dated: '2026-07-01' },
      { id: 'DR-02', title: 'Agency minutes', file: 'dr-02.md', dated: '2026-08-15' },
      { id: 'DR-03', title: 'Paediatric plan', provided: false },
    ],
    issues: [
      {
        id: 'PI-01',
        kind: 'claim-vs-record',
        severity: 'high',
        planted_in: ['DR-01', 'DR-02'],
        right_response: 'Shows both documents side by side and does not pick one.',
        wrong_response: 'Repeats the licensor claim as agreed fact.',
        failure_mode: 'Treats a company statement as the agency position.',
      },
      {
        id: 'PI-02',
        kind: 'withheld-document',
        severity: 'medium',
        planted_in: ['DR-01'],
        right_response: 'Says the paediatric plan was not found in the data room.',
        wrong_response: 'Describes what the plan probably says.',
        failure_mode: 'Invents the content of a missing document.',
      },
    ],
    ...patch,
  };
}

/** Writes a pack folder; `files` overrides or adds document files, null removes one. */
function makePack(pack: Record<string, unknown> = rawPack(), files: Record<string, string | null> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eval-packs-'));
  roots.push(root);
  const dir = path.join(root, 'practice-01');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pack.yaml'), stringify(pack));
  const all: Record<string, string | null> = { 'dr-01.md': DOC_TEXT('Overview'), 'dr-02.md': DOC_TEXT('Agency minutes'), ...files };
  for (const [name, text] of Object.entries(all)) if (text !== null) writeFileSync(path.join(dir, name), text);
  return dir;
}

const issuesOf = (dir: string) => loadPack(dir).issues;

describe('loadPack: a valid pack', () => {
  it('reads documents, the answer key and a content hash', () => {
    const { pack, issues } = loadPack(makePack());

    expect(issues).toEqual([]);
    expect(pack?.id).toBe('practice-01');
    expect(pack?.asOf).toBe('2026-10-12');
    expect(pack?.documents.map((doc) => [doc.id, doc.provided])).toEqual([
      ['DR-01', true],
      ['DR-02', true],
      ['DR-03', false],
    ]);
    expect(pack?.documents[0].text).toContain('Fictional practice document');
    expect(pack?.issues.map((issue) => issue.id)).toEqual(['PI-01', 'PI-02']);
    expect(pack?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when a document changes, and when the key changes', () => {
    const base = loadPack(makePack()).pack?.hash;
    const edited = loadPack(makePack(rawPack(), { 'dr-01.md': `${DOC_TEXT('Overview')}One more sentence.\n` })).pack?.hash;
    const rekeyed = loadPack(makePack(rawPack({ title: 'Practice case 01, second edition' }))).pack?.hash;

    expect(edited).not.toBe(base);
    expect(rekeyed).not.toBe(base);
  });
});

describe('loadPack: documents', () => {
  it('refuses a document dated after the as-of date (a later source is a hard failure)', () => {
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[1].dated = '2026-10-13';

    expect(issuesOf(makePack(pack))).toEqual([expect.stringMatching(/DR-02.*dated 2026-10-13.*after.*2026-10-12/)]);
  });

  it('accepts a document dated exactly on the as-of date (positive control)', () => {
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[1].dated = '2026-10-12';

    expect(issuesOf(makePack(pack))).toEqual([]);
  });

  it('refuses a document that does not say it is fictional in its first lines', () => {
    const real = '# Overview\n\nThe licensor says the pivotal study met its endpoint.\n';

    expect(issuesOf(makePack(rawPack(), { 'dr-01.md': real }))).toEqual([expect.stringMatching(/DR-01.*fictional/)]);
  });

  it('refuses a missing file, an empty file and a path that leaves the folder', () => {
    expect(issuesOf(makePack(rawPack(), { 'dr-01.md': null }))).toEqual([expect.stringMatching(/DR-01.*cannot read/)]);
    expect(issuesOf(makePack(rawPack(), { 'dr-01.md': '  \n' }))).toEqual([expect.stringMatching(/DR-01.*empty/)]);
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[0].file = '../secret.md';
    expect(issuesOf(makePack(pack))).toEqual([expect.stringMatching(/DR-01.*inside the pack folder/)]);
  });

  it('needs a date on a provided document, and no file on a withheld one', () => {
    const noDate = rawPack();
    delete (noDate.documents as Record<string, unknown>[])[0].dated;
    expect(issuesOf(makePack(noDate))).toEqual([expect.stringMatching(/DR-01.*dated/)]);

    const withheldWithFile = rawPack();
    (withheldWithFile.documents as Record<string, unknown>[])[2].file = 'dr-01.md';
    expect(issuesOf(makePack(withheldWithFile))).toEqual([expect.stringMatching(/DR-03.*provided: false.*no file/)]);
  });

  it('reads what kind of source each document is, and takes a company disclosure when the pack does not say', () => {
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[1].source = 'agency-record';

    const loaded = loadPack(makePack(pack));

    expect(loaded.issues).toEqual([]);
    expect(loaded.pack?.documents.map((doc) => [doc.id, doc.source])).toEqual([
      ['DR-01', 'company-disclosure'],
      ['DR-02', 'agency-record'],
      ['DR-03', 'company-disclosure'],
    ]);
  });

  it('refuses a source type it does not know, and changes the hash when a source changes', () => {
    const typo = rawPack();
    (typo.documents as Record<string, unknown>[])[1].source = 'rumour';
    expect(issuesOf(makePack(typo))).toEqual([expect.stringMatching(/DR-02.*source must be one of company-disclosure, agency-record, registry, publication/)]);

    const changed = rawPack();
    (changed.documents as Record<string, unknown>[])[1].source = 'agency-record';
    expect(loadPack(makePack(changed)).pack?.hash).not.toBe(loadPack(makePack()).pack?.hash);
  });

  it('refuses duplicate document ids and unknown keys', () => {
    const dup = rawPack();
    (dup.documents as Record<string, unknown>[])[1].id = 'DR-01';
    expect(issuesOf(makePack(dup)).join('\n')).toMatch(/duplicate document id "DR-01"/);

    const typo = rawPack();
    (typo.documents as Record<string, unknown>[])[0].titel = 'x';
    expect(issuesOf(makePack(typo))).toEqual([expect.stringMatching(/DR-01.*unknown key "titel"/)]);
  });
});

describe('loadPack: the answer key', () => {
  it('refuses an issue that points at an unknown document, or a kind or severity that does not exist', () => {
    const pack = rawPack();
    const key = pack.issues as Record<string, unknown>[];
    key[0].planted_in = ['DR-09'];
    key[1].kind = 'vibes';
    key[1].severity = 'huge';

    const issues = issuesOf(makePack(pack));
    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toMatch(/PI-01.*DR-09/);
    expect(issues.join('\n')).toMatch(/PI-02.*kind/);
    expect(issues.join('\n')).toMatch(/PI-02.*severity/);
  });

  it('needs the right response, the wrong response and the failure mode on every issue', () => {
    const pack = rawPack();
    delete (pack.issues as Record<string, unknown>[])[0].wrong_response;

    expect(issuesOf(makePack(pack))).toEqual([expect.stringMatching(/PI-01.*wrong_response/)]);
  });

  it('allows an empty planted_in only for kinds planted in the conversation (agent-error, referral)', () => {
    const ok = rawPack();
    (ok.issues as Record<string, unknown>[])[1] = { ...(ok.issues as Record<string, unknown>[])[1], kind: 'agent-error', planted_in: [] };
    expect(issuesOf(makePack(ok))).toEqual([]);

    const bad = rawPack();
    (bad.issues as Record<string, unknown>[])[0].planted_in = [];
    expect(issuesOf(makePack(bad))).toEqual([expect.stringMatching(/PI-01.*planted_in/)]);
  });
});

describe('loadPacks', () => {
  it('is empty when the folder does not exist, and refuses a folder with two packs of one id', () => {
    expect(loadPacks('/nonexistent/packs').size).toBe(0);
    const dir = makePack();
    const root = path.dirname(dir);
    mkdirSync(path.join(root, 'copy'));
    writeFileSync(path.join(root, 'copy', 'pack.yaml'), stringify(rawPack()));
    writeFileSync(path.join(root, 'copy', 'dr-01.md'), DOC_TEXT('Overview'));
    writeFileSync(path.join(root, 'copy', 'dr-02.md'), DOC_TEXT('Agency minutes'));

    expect(() => loadPacks(root)).toThrow(/duplicate pack id "practice-01"/);
  });

  it('collects every problem of every pack in one error', () => {
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[1].dated = '2027-01-01';
    const dir = makePack(pack, { 'dr-01.md': 'no notice here\n' });

    expect(() => loadPacks(path.dirname(dir))).toThrow(/2 problems/);
  });
});

function loadedPack(): CasePack {
  const { pack } = loadPack(makePack());
  if (pack === undefined) throw new Error('fixture pack must load');
  return pack;
}

function packCase(patch: Record<string, unknown> = {}) {
  const raw = {
    id: 'lead-claims',
    version: 1,
    agent: 'lead',
    category: 'grounded',
    risk: 'factual',
    as_of: '2026-10-12',
    pack: 'practice-01',
    documents: ['DR-01', 'DR-02'],
    issues: ['PI-01'],
    turns: [{ role: 'user', content: 'What did the agency say about the pivotal study?' }],
    expected: { required_patterns: ['DR-0[12]'] },
    rubric: ['Cites document ids.'],
    ...patch,
  };
  const { cases, issues } = parseCaseFile(stringify({ cases: [raw] }), 'lead.yaml');
  expect(issues).toEqual([]);
  return cases[0];
}

describe('case keys pack, documents and issues', () => {
  it('are read, and stay absent from a case that does not use them', () => {
    const withPack = packCase();
    expect(withPack.pack).toBe('practice-01');
    expect(withPack.documents).toEqual(['DR-01', 'DR-02']);
    expect(withPack.issues).toEqual(['PI-01']);

    const plain = parseCaseFile(
      stringify({ cases: [{ id: 'x-plain', version: 1, agent: 'lead', category: 'normal', risk: 'standard', as_of: '2026-10-12', turns: [{ role: 'user', content: 'Hi' }], expected: { required_phrases: ['hello'] }, rubric: ['Greets.'] }] }),
      'x.yaml',
    ).cases[0];
    expect('pack' in plain).toBe(false);
    expect('documents' in plain).toBe(false);
    expect('issues' in plain).toBe(false);
  });

  it('change the case hash, so a changed document selection is a changed case', () => {
    expect(packCase({ documents: ['DR-01'] }).hash).not.toBe(packCase().hash);
    expect(packCase({ issues: ['PI-02'] }).hash).not.toBe(packCase().hash);
  });

  it('are refused without a pack, and as the wrong type', () => {
    const noPack = parseCaseFile(stringify({ cases: [{ id: 'x-a', version: 1, agent: 'lead', category: 'normal', risk: 'standard', as_of: '2026-10-12', documents: ['DR-01'], turns: [{ role: 'user', content: 'Hi' }], expected: { required_phrases: ['hello'] }, rubric: ['Greets.'] }] }), 'x.yaml');
    expect(noPack.issues.map((issue) => issue.message).join('\n')).toMatch(/documents.*pack/);

    const wrongType = parseCaseFile(stringify({ cases: [{ id: 'x-b', version: 1, agent: 'lead', category: 'normal', risk: 'standard', as_of: '2026-10-12', pack: 'practice-01', documents: 'DR-01', turns: [{ role: 'user', content: 'Hi' }], expected: { required_phrases: ['hello'] }, rubric: ['Greets.'] }] }), 'x.yaml');
    expect(wrongType.issues.map((issue) => issue.message).join('\n')).toMatch(/documents must be a list/);
  });
});

describe('bindPacks', () => {
  const packs = () => new Map([['practice-01', loadedPack()]]);

  it('accepts cases that cover every issue of the pack (positive control)', () => {
    expect(() => bindPacks([packCase(), packCase({ id: 'lead-missing', issues: ['PI-02'], documents: ['DR-01'] })], packs())).not.toThrow();
  });

  it('refuses an unknown pack, document or issue, naming each', () => {
    const run = (patch: Record<string, unknown>) => () => bindPacks([packCase(patch)], packs());
    expect(run({ pack: 'nope' })).toThrow(/unknown pack "nope"/);
    expect(run({ documents: ['DR-77'] })).toThrow(/unknown document "DR-77"/);
    expect(run({ issues: ['PI-77'] })).toThrow(/unknown issue "PI-77"/);
  });

  it('refuses to show a withheld document, and a case whose documents lack where the issue is planted', () => {
    expect(() => bindPacks([packCase({ documents: ['DR-01', 'DR-03'] })], packs())).toThrow(/DR-03.*not provided/);
    expect(() => bindPacks([packCase({ documents: ['DR-01'] })], packs())).toThrow(/PI-01.*planted in DR-02/);
  });

  it('refuses a case whose as-of date is earlier than a document it shows', () => {
    expect(() => bindPacks([packCase({ as_of: '2026-07-31' })], packs())).toThrow(/DR-02.*dated 2026-08-15.*after.*2026-07-31/);
  });

  it('refuses a pack with an issue no case probes', () => {
    expect(() => bindPacks([packCase()], packs())).toThrow(/PI-02.*no case/);
  });
});

describe('caseMaterial', () => {
  it('builds the case\'s data room with the same code the app uses: the index first, then the visible documents in id order, with the exemption lines', () => {
    const material = caseMaterial(packCase(), loadedPack());

    expect(material.roomContext.map((block) => block.label)).toEqual([
      'Data room index, written by the app',
      'Data room document DR-01: Overview (fictional practice document, company disclosure, dated 2026-07-01)',
      'Data room document DR-02: Agency minutes (fictional practice document, company disclosure, dated 2026-08-15)',
    ]);
    expect(material.roomContext[1].text).toContain('Fictional practice document');
    expect(material.instructions).toEqual([...DATA_ROOM_INSTRUCTIONS]);
    expect(material.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries each document\'s kind of source into the label the agents read', () => {
    const pack = rawPack();
    (pack.documents as Record<string, unknown>[])[1].source = 'agency-record';

    const labels = caseMaterial(packCase(), loadPack(makePack(pack)).pack).roomContext.map((block) => block.label);

    expect(labels[2]).toBe('Data room document DR-02: Agency minutes (fictional practice document, agency record, dated 2026-08-15)');
    expect(labels[1]).toContain('company disclosure');
  });

  it('lists in the index only what the case shows and what the pack withholds, as the agents of that case see the room', () => {
    const index = (documents?: string[]) => caseMaterial(packCase(documents === undefined ? {} : { documents }), loadedPack()).roomContext[0].text;

    expect(index(['DR-01'])).toContain('DR-01 | Overview | company disclosure | dated 2026-07-01 | shown');
    expect(index(['DR-01'])).toContain('DR-03 | Paediatric plan | listed, not provided');
    expect(index(['DR-01'])).not.toContain('DR-02');
    expect(index(['DR-01'])).toContain(`Data room as of ${packCase().asOf}.`);
  });

  it('shows only the documents the case lists, and all provided ones when it lists none', () => {
    expect(caseMaterial(packCase({ documents: ['DR-02'] }), loadedPack()).roomContext).toHaveLength(2);
    const noList = packCase();
    delete (noList as { documents?: string[] }).documents;
    expect(caseMaterial(noList, loadedPack()).roomContext.slice(1).map((block) => /DR-\d\d/.exec(block.label)?.[0])).toEqual(['DR-01', 'DR-02']);
  });

  it('says in its instructions what the "In this phase" rule keeps and what it lifts', () => {
    const text = DATA_ROOM_INSTRUCTIONS.join(' ');

    expect(text).toMatch(/lifts?.*no documents are connected/i);
    expect(text).toMatch(/not found in the data room/);
    expect(text).toMatch(/cite the document id/i);
    expect(text).toMatch(/no tools/i);
  });

  it('returns nothing for a case with no pack', () => {
    const plain = packCase();
    delete (plain as { pack?: string }).pack;

    expect(caseMaterial(plain, undefined)).toEqual({ roomContext: [], instructions: [], hash: null });
  });
});
