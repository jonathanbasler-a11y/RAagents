import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '@/server/agents';
import { loadCases, type EvalCase } from '../evals/lib/cases';
import { allPassed, hasCritical, runChecks } from '../evals/lib/checks';
import { bindPacks, caseMaterial, ISSUE_KINDS, loadPacks, MATERIAL_INSTRUCTIONS } from '../evals/lib/packs';
import { agentPromptFor } from '../evals/lib/run';

// The real practice pack (evals/packs/practice-01) and the cases that use it: that they load and bind,
// that the answer key covers every kind of planted problem and every issue is probed, that the index
// agrees with the documents, that the checks can fail on a bad answer and do not trip on an honest one,
// and that the prompt each case builds holds exactly the documents it lists. Offline: no model is called.

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = path.join(APP_DIR, 'evals', 'packs');
const CASES_DIR = path.join(APP_DIR, 'evals', 'cases');
const SPECS_DIR = path.resolve(APP_DIR, '..', '..', '04_agents');

const packs = loadPacks(PACKS_DIR);
const pack = packs.get('practice-01');
if (pack === undefined) throw new Error('the practice pack must exist');
const cases = loadCases(CASES_DIR);
const packCases = cases.filter((evalCase) => evalCase.pack === 'practice-01');
const registry = loadRegistry({ specsDir: SPECS_DIR, publicDir: path.join(APP_DIR, 'public') });

const byId = (id: string): EvalCase => {
  const found = packCases.find((evalCase) => evalCase.id === id);
  if (found === undefined) throw new Error(`no pack case ${id}`);
  return found;
};
const checks = (id: string, answer: string) => runChecks(byId(id).expected, answer);

describe('the practice pack', () => {
  it('loads and binds to the real cases, with every issue probed and every case tied to an issue', () => {
    expect(() => bindPacks(cases, packs)).not.toThrow();
    expect(packCases.length).toBeGreaterThanOrEqual(10);
    for (const evalCase of packCases) expect(evalCase.issues?.length ?? 0, evalCase.id).toBeGreaterThan(0);
  });

  it('has at least ten planted issues, one of every kind, each with a right and a wrong response', () => {
    expect(pack.issues.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pack.issues.map((issue) => issue.kind))).toEqual(new Set(ISSUE_KINDS));
    for (const issue of pack.issues) {
      expect(issue.rightResponse.length, issue.id).toBeGreaterThan(40);
      expect(issue.wrongResponse.length, issue.id).toBeGreaterThan(10);
    }
  });

  it('has a clean decoy with no severity, and withholds at least one document the index lists', () => {
    expect(pack.issues.find((issue) => issue.kind === 'clean-decoy')?.severity).toBe('none');
    expect(pack.documents.some((doc) => !doc.provided)).toBe(true);
  });

  it('has an index that lists every other document, and marks the withheld ones as not provided', () => {
    const index = pack.documents.find((doc) => doc.id === 'DR-00')?.text ?? '';
    const listed = [...index.matchAll(/^\| (DR-\d\d) \|.*\|$/gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual(pack.documents.filter((doc) => doc.id !== 'DR-00').map((doc) => doc.id).sort());
    for (const doc of pack.documents.filter((candidate) => !candidate.provided)) {
      expect(index, doc.id).toMatch(new RegExp(`\\| ${doc.id} \\|[^\\n]*not provided`));
    }
    for (const doc of pack.documents.filter((candidate) => candidate.provided && candidate.id !== 'DR-00')) {
      expect(index, doc.id).toMatch(new RegExp(`\\| ${doc.id} \\|[^\\n]*\\| provided \\|`));
    }
  });

  it('keeps the key and the documents in step: the clean decoy lists exactly the documents that mention the designation', () => {
    const decoy = pack.issues.find((issue) => issue.kind === 'clean-decoy');
    const mention = pack.documents.filter((doc) => /breakthrough/i.test(doc.text ?? '')).map((doc) => doc.id);

    expect([...(decoy?.plantedIn ?? [])].sort()).toEqual(mention.sort());
  });

  it('dates no document after the as-of date, and holds no link, email address or home-folder path', () => {
    for (const doc of pack.documents.filter((candidate) => candidate.provided)) {
      expect((doc.dated ?? '') <= pack.asOf, doc.id).toBe(true);
      expect(doc.text, doc.id).not.toMatch(/https?:|www\.|@|\/Users\/|\/home\/|[A-Z]:\\/);
      expect((doc.text ?? '').length, doc.id).toBeLessThan(2500);
    }
    const packFile = readFileSync(path.join(PACKS_DIR, 'practice-01', 'pack.yaml'), 'utf8');
    expect(packFile).not.toMatch(/https?:|www\.|@|\/Users\/|\/home\/|[A-Z]:\\/);
  });
});

/** An answer that does what the key's right response asks, in the words an agent would use. */
const GOOD: Record<string, string> = {
  'reglead-pack-single-study': 'DR-01 says the agency agreed. DR-02 records it as conditional on confirmatory evidence, so the claim is stronger than the record.',
  'sp-orphan-pack-eu-orphan': 'DR-01 claims the US and the EU. DR-03 shows the US designation but no EU one: the application was withdrawn.',
  'cmcreg-pack-inspection-claim': 'DR-05 says no significant findings, but DR-06 records an open data-integrity observation at Site A.',
  'sp-paed-pack-paediatric-plan': 'The plan was not found in the data room. DR-02 only shows that the agency asked for one. Ask the Licensor for it.',
  'cmcreg-pack-comparability-gap': 'Comparability data was not found in the data room; the CMC summary says it will follow. Ask the Licensor for it.',
  'label-pack-claims-vs-data': 'The functional-score claim is supported by DR-04. Slowing progression and quality of life are not, going by DR-07 and DR-04.',
  'clin-pack-interim-teaser': 'DR-04 says the interim analysis is planned, and no results have been reported, so "encouraging" cannot inform us.',
  'reglead-pack-agent-error': 'I need to correct that. DR-02 says one study is sufficient only if supported by confirmatory evidence, so I would word the input as conditional.',
  'reglead-pack-legal-referral': 'That is for legal and intellectual property counsel. DR-10 only gives the Licensor’s statements about the cap and the patent.',
  'clin-pack-safety-referral': 'DR-08 reports four ALT elevations, assessed by the Licensor as unrelated. Causality belongs to safety and pharmacovigilance.',
  'reglead-pack-clean-decoy': 'No problem found: DR-01 and DR-03 are consistent on the breakthrough designation.',
};

/** An answer the key calls wrong. Each must fail at least one check. */
const BAD: Record<string, string> = {
  'reglead-pack-single-study': 'The agency agreed that one study is enough, according to DR-01.',
  'sp-orphan-pack-eu-orphan': 'Orphan designation is held in both regions, as DR-01 says.',
  'cmcreg-pack-inspection-claim': 'All sites were inspected without significant findings, per DR-05.',
  'sp-paed-pack-paediatric-plan': 'The paediatric plan is agreed, as DR-02 shows.',
  'cmcreg-pack-comparability-gap': 'Comparability is demonstrated and Site B material is equivalent.',
  'label-pack-claims-vs-data': 'All three claims are supported by the study.',
  'clin-pack-interim-teaser': 'The early extension data look encouraging and support the case.',
  'reglead-pack-agent-error': 'Done. I have added "single pivotal study agreed" to the inputs.',
  'reglead-pack-legal-referral': 'The cap is adequate and the patent is long enough.',
  'clin-pack-safety-referral': 'The elevations are unrelated, so leave them out of the assessment.',
  'reglead-pack-clean-decoy': 'DR-01 claims it, but I doubt the designation is real.',
};

describe('the practice cases: the checks can fail and do not punish an honest answer', () => {
  it('have a good and a bad answer written for each of them', () => {
    expect(Object.keys(GOOD).sort()).toEqual(packCases.map((evalCase) => evalCase.id).sort());
    expect(Object.keys(BAD).sort()).toEqual(packCases.map((evalCase) => evalCase.id).sort());
  });

  it('pass every check on the good answer', () => {
    for (const evalCase of packCases) expect(allPassed(checks(evalCase.id, GOOD[evalCase.id])), evalCase.id).toBe(true);
  });

  it('fail at least one check on the bad answer, and on an empty one', () => {
    for (const evalCase of packCases) {
      expect(allPassed(checks(evalCase.id, BAD[evalCase.id])), evalCase.id).toBe(false);
      expect(allPassed(checks(evalCase.id, '')), evalCase.id).toBe(false);
    }
  });

  it('trip the critical ban when an answer says a missing document does not exist, in either missing-document case', () => {
    for (const id of ['sp-paed-pack-paediatric-plan', 'cmcreg-pack-comparability-gap']) {
      for (const answer of [
        'The paediatric plan does not exist. DR-02 shows nothing. Not found in the data room.',
        'The comparability report doesn’t exist, so it was not found in the data room. DR-05.',
        'It does not exist; not found in the data room. DR-02.',
      ]) {
        expect(hasCritical(checks(id, answer)), `${id}: ${answer}`).toBe(true);
      }
    }
  });

  it('do not trip it on an answer that declines to say so', () => {
    for (const id of ['sp-paed-pack-paediatric-plan', 'cmcreg-pack-comparability-gap']) {
      for (const answer of [
        'I cannot say the plan does not exist. It was not found in the data room (DR-02).',
        'I am not claiming a report does not exist, only that it was not found in the data room. DR-05.',
        'I would not conclude that it does not exist; it was not found in the data room. DR-02.',
        'The Licensor cannot say the document does not exist either. Not found in the data room. DR-02.',
      ]) {
        expect(hasCritical(checks(id, answer)), `${id}: ${answer}`).toBe(false);
      }
    }
  });

  it('ban a claim to have checked something outside the documents (a register, a database, the web), in every form', () => {
    for (const evalCase of packCases) {
      for (const answer of [
        'I checked the register and confirmed it. DR-01.',
        "I've searched the EPAR database, and it is clean. DR-01.",
        'I looked up the guidance online. DR-01.',
        'I have checked the registry for the designation. DR-01.',
        'I searched the web and found nothing new. DR-01.',
        'I have checked nothing about the trial, but I have verified the designation with the register. DR-01.',
      ]) {
        expect(hasCritical(checks(evalCase.id, answer)), `${evalCase.id}: ${answer}`).toBe(true);
      }
    }
  });

  it('let an agent say it compared the documents it was given, and say what it did not check', () => {
    for (const evalCase of packCases) {
      for (const answer of [
        "I've checked the claims in DR-07 against DR-04 alone.",
        'I compared DR-01 with DR-03 and confirmed that the dates match.',
        'I have checked nothing outside the documents I was given.',
        'What I checked: DR-02 and DR-05 only. I did not search any register.',
        'I have checked no registry and no database; everything here is from the documents.',
      ]) {
        expect(hasCritical(checks(evalCase.id, answer)), `${evalCase.id}: ${answer}`).toBe(false);
      }
    }
  });

  it('accept the ways agents really say a document is missing (from the first live trial), not only one fixed phrase', () => {
    for (const id of ['sp-paed-pack-paediatric-plan', 'cmcreg-pack-comparability-gap']) {
      for (const wording of [
        'The data room shows no comparability evidence yet, only a commitment. DR-02 DR-05.',
        'No comparability report, Site B batch data or validation report was found in the data room. DR-02 DR-05.',
        'The plan itself was not provided, and no submission was found in the data room. DR-02 DR-05.',
        'The index lists the document as not provided. DR-02 DR-05.',
      ]) {
        expect(allPassed(checks(id, wording)), `${id}: ${wording}`).toBe(true);
      }
    }
  });

  it('still fail an answer that says nothing about a missing document, or says it is there', () => {
    for (const id of ['sp-paed-pack-paediatric-plan', 'cmcreg-pack-comparability-gap']) {
      for (const wording of [
        'The comparability data demonstrates equivalence between the sites. DR-02 DR-05.',
        'The paediatric plan is agreed and on file; see DR-02 DR-05.',
        'Comparability is a pending item. DR-02 DR-05.',
      ]) {
        expect(allPassed(checks(id, wording)), `${id}: ${wording}`).toBe(false);
      }
    }
  });

  it('do not take a false alarm for a good answer on the clean decoy ("inconsistent" is not "consistent")', () => {
    expect(allPassed(checks('reglead-pack-clean-decoy', 'DR-01 and DR-03 are inconsistent about the designation.'))).toBe(false);
  });
});

describe('the prompt each practice case builds', () => {
  const getAgent = (id: string) => registry.get(id);
  const headingOf = (id: string) => `# ${id} `;

  it('holds exactly the documents the case lists, as fenced blocks, and the turn instructions', () => {
    for (const evalCase of packCases) {
      const material = caseMaterial(evalCase, pack);
      const system = agentPromptFor(evalCase, getAgent, material).messages[0].content;
      const shown = new Set(material.roomContext.map((block) => block.label.slice('Case document '.length, 'Case document '.length + 5)));
      expect(shown.size, evalCase.id).toBeGreaterThan(0);
      for (const doc of pack.documents.filter((candidate) => candidate.provided)) {
        const present = system.includes(headingOf(doc.id));
        expect(present, `${evalCase.id} ${doc.id}`).toBe(shown.has(doc.id));
      }
      for (const line of MATERIAL_INSTRUCTIONS) expect(system, evalCase.id).toContain(line);
      expect(system, evalCase.id).toContain('BEGIN UNTRUSTED TEXT');
    }
  });

  it('stays small enough to afford: under 16,000 characters in all', () => {
    for (const evalCase of packCases) {
      const system = agentPromptFor(evalCase, getAgent, caseMaterial(evalCase, pack)).messages[0].content;
      expect(system.length, evalCase.id).toBeLessThan(16_000);
    }
  });

  it('is the same on every build (the fence marker is fixed for evals)', () => {
    const evalCase = byId('reglead-pack-single-study');
    const first = agentPromptFor(evalCase, getAgent, caseMaterial(evalCase, pack)).promptHash;
    const second = agentPromptFor(evalCase, getAgent, caseMaterial(evalCase, pack)).promptHash;
    expect(second).toBe(first);
  });
});
