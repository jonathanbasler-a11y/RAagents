import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASSIFICATION_LABELS } from '@/components/labels';
import { CLASSIFICATION_IDS, DEVELOPMENT_STAGES } from '@/shared/contracts';
import { DEFAULT_DD_SETUP, FILED_STAGES, LATE_STAGES } from '@/shared/dd-setup';

// The UX mockup (outputs/05_demo/ux-mockup/index.html) is no longer part of the app. It stays in
// the repository as the design reference for the DD setup, so these tests pin the parts of its
// data that the app's rule copies: if the mockup changes, the rule is changed on purpose, not by
// drift. One thing differs on purpose and is not pinned: in the mockup a switched agent changes
// the classification; in the app a hand switch never does.

const MOCKUP_FILE = path.resolve(process.cwd(), '..', 'ux-mockup', 'index.html');
const SPEC_DIR = path.resolve(process.cwd(), '..', '..', '04_agents');

function listIn(html: string, pattern: RegExp, what: string): string[] {
  const match = pattern.exec(html);
  if (!match) throw new Error(`the mockup has no ${what}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

interface MockupClass {
  id: string;
  label: string;
  agent: string;
  on: boolean;
}

/** The `{ id, label, agent, on }` entries of the `classes: [ … ]` block under `request`. */
function classesIn(html: string): MockupClass[] {
  const block = /\bclasses:\s*\[([\s\S]*?)\n\s*\],/.exec(html);
  if (!block) throw new Error('the mockup has no "classes: [ … ]" block');
  return [...block[1].matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*agent:\s*'([^']+)',\s*on:\s*(true|false)\s*\}/g)].map(
    (entry) => ({ id: entry[1], label: entry[2], agent: entry[3], on: entry[4] === 'true' }),
  );
}

function specTrigger(agentId: string): string | null {
  const text = readFileSync(path.join(SPEC_DIR, `${agentId}.md`), 'utf8');
  return /^trigger:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null;
}

describe('the mockup (design reference) and the app\'s DD setup rule', () => {
  const html = readFileSync(MOCKUP_FILE, 'utf8');

  it('offers the same stages in the same order, and starts at the same stage', () => {
    expect(listIn(html, /\bid:\s*'f-stage'[^\n]*?options:\s*\[([^\]]*)\]/, 'stage options')).toEqual([...DEVELOPMENT_STAGES]);
    expect(/\bid:\s*'f-stage',\s*label:\s*'[^']*',\s*value:\s*'([^']+)'/.exec(html)?.[1]).toBe(DEFAULT_DD_SETUP.stage);
  });

  it('has the same classifications, labels and defaults', () => {
    const classes = classesIn(html);

    expect(classes.map((entry) => entry.id)).toEqual([...CLASSIFICATION_IDS]);
    expect(Object.fromEntries(classes.map((entry) => [entry.id, entry.label]))).toEqual(CLASSIFICATION_LABELS);
    expect(classes.filter((entry) => entry.on).map((entry) => entry.id)).toEqual([...DEFAULT_DD_SETUP.classifications]);
  });

  it('uses the same late and filed stages', () => {
    expect(listIn(html, /\blateStages:\s*\[([^\]]*)\]/, 'lateStages')).toEqual([...LATE_STAGES]);
    expect(listIn(html, /\bfiledStages:\s*\[([^\]]*)\]/, 'filedStages')).toEqual([...FILED_STAGES]);
  });

  it('ties each classification to the specialist whose real spec carries that trigger', () => {
    for (const entry of classesIn(html)) {
      expect(specTrigger(entry.agent), `${entry.agent} trigger`).toBe(entry.id);
    }
  });

  it('brings in, at the late stages, the agents whose real specs say "late" or "filed"', () => {
    const late = ['ops', 'mw', 'sp-rm'].map((id) => [id, specTrigger(id)]);
    expect(late).toEqual([
      ['ops', 'late'],
      ['mw', 'late'],
      ['sp-rm', 'late'],
    ]);
    expect(specTrigger('sp-promo')).toBe('filed');
  });
});

describe('the readers above', () => {
  it('read a list and the class entries, and fail loudly when the block is missing', () => {
    expect(listIn("lateStages: ['Phase 3', 'Filed'],", /\blateStages:\s*\[([^\]]*)\]/, 'lateStages')).toEqual(['Phase 3', 'Filed']);
    expect(() => listIn('<html></html>', /\blateStages:\s*\[([^\]]*)\]/, 'lateStages')).toThrow(/no lateStages/);
    expect(classesIn("classes: [\n  { id: 'a', label: 'A', agent: 'sp-a', on: true },\n  { id: 'b', label: 'B', agent: 'sp-b', on: false }\n],")).toEqual([
      { id: 'a', label: 'A', agent: 'sp-a', on: true },
      { id: 'b', label: 'B', agent: 'sp-b', on: false },
    ]);
    expect(() => classesIn('<html></html>')).toThrow(/no "classes/);
  });
});
