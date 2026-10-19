import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPack } from '../../../evals/lib/packs';
import { checkNewDocument } from '@/shared/data-room';
import { loadPracticeRoom, PRACTICE_PACK_DIR } from './practice-pack';

// The fictional practice case as a data room. Only the documents leave the pack: the answer key stays in evals.

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'practice-pack-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePack(yaml: string, files: Record<string, string> = {}) {
  const dir = path.join(root, PRACTICE_PACK_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pack.yaml'), yaml);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
}

describe('loadPracticeRoom: the real practice case', () => {
  const room = loadPracticeRoom(process.cwd());

  it('is available from the app folder', () => {
    expect(room).not.toBeNull();
  });

  it('has the pack\'s as-of date and its eleven documents, DR-09 listed but not provided', () => {
    expect(room?.asOf).toBe('2026-10-12');
    expect(room?.documents.map((entry) => entry.id)).toEqual(['DR-00', 'DR-01', 'DR-02', 'DR-03', 'DR-04', 'DR-05', 'DR-06', 'DR-07', 'DR-08', 'DR-09', 'DR-10']);
    const withheld = room?.documents.find((entry) => entry.id === 'DR-09');
    expect(withheld).toMatchObject({ provided: false, text: null, publishedAt: null, title: 'Paediatric study plan' });
  });

  it('marks every document as coming from the practice pack and DR-02 as an agency record', () => {
    expect(room?.documents.every((entry) => entry.origin === 'practice-pack')).toBe(true);
    expect(room?.documents.filter((entry) => entry.sourceType === 'agency-record').map((entry) => entry.id)).toEqual(['DR-02']);
  });

  it('gives the data room documents the same text and dates as the evaluation pack, so the two cannot drift', () => {
    const { pack, issues } = loadPack(path.resolve(process.cwd(), PRACTICE_PACK_DIR));
    expect(issues).toEqual([]);

    expect(room?.documents.map((entry) => [entry.id, entry.title, entry.publishedAt, entry.text, entry.sourceType])).toEqual(
      pack?.documents.map((entry) => [entry.id, entry.title, entry.dated ?? null, entry.text ?? null, entry.source]),
    );
    expect(room?.asOf).toBe(pack?.asOf);
  });

  it('passes the data room rules for its own as-of date', () => {
    for (const entry of room?.documents ?? []) {
      expect(checkNewDocument(entry, room!.asOf, 'practice-pack'), entry.id).toMatchObject({ ok: true });
    }
  });

  it('carries nothing of the answer key', () => {
    const everything = JSON.stringify(room);

    expect(everything).not.toMatch(/PI-\d\d/);
    expect(everything).not.toMatch(/right_response|wrong_response|failure_mode|planted_in|rightResponse|plantedIn/);
    expect(Object.keys(room ?? {}).sort()).toEqual(['asOf', 'documents']);
  });
});

describe('loadPracticeRoom: where the pack is missing or broken', () => {
  const GOOD = [
    "id: practice-x",
    "title: X",
    "as_of: '2026-10-12'",
    'documents:',
    "  - { id: DR-01, title: Overview, file: dr-01.md, dated: '2026-07-14', source: company-disclosure }",
    '  - { id: DR-02, title: Plan, provided: false }',
    'issues: []',
  ].join('\n');

  it('is not available when the folder is not there', () => {
    expect(loadPracticeRoom(root)).toBeNull();
  });

  it('reads a small pack (positive control for the refusals below)', () => {
    writePack(GOOD, { 'dr-01.md': '# DR-01 Overview\n\nFictional practice document.\r\n\r\nText.\r\n' });

    const room = loadPracticeRoom(root);

    expect(room?.asOf).toBe('2026-10-12');
    expect(room?.documents).toEqual([
      { id: 'DR-01', title: 'Overview', sourceType: 'company-disclosure', publishedAt: '2026-07-14', url: null, provided: true, text: '# DR-01 Overview\n\nFictional practice document.\n\nText.', origin: 'practice-pack' },
      { id: 'DR-02', title: 'Plan', sourceType: 'company-disclosure', publishedAt: null, url: null, provided: false, text: null, origin: 'practice-pack' },
    ]);
  });

  it('throws, with the reason, for a pack.yaml that is not valid', () => {
    writePack('documents: [unclosed');

    expect(() => loadPracticeRoom(root)).toThrow(/pack\.yaml/);
  });

  it('throws for a document file that is missing', () => {
    writePack(GOOD);

    expect(() => loadPracticeRoom(root)).toThrow(/DR-01/);
  });

  it('throws for a file that leaves the pack folder', () => {
    writePack(GOOD.replace('file: dr-01.md', 'file: ../../../secret.md'), { 'dr-01.md': 'x' });

    expect(() => loadPracticeRoom(root)).toThrow(/inside the pack folder/);
  });

  it('throws for a document dated after the as-of date, because the room would refuse it', () => {
    writePack(GOOD.replace("dated: '2026-07-14'", "dated: '2026-10-13'"), { 'dr-01.md': 'Fictional practice document.' });

    expect(() => loadPracticeRoom(root)).toThrow(/after the as-of date/);
  });

  it('throws for an as-of date that is not a date', () => {
    writePack(GOOD.replace("as_of: '2026-10-12'", 'as_of: soon'), { 'dr-01.md': 'Fictional practice document.' });

    expect(() => loadPracticeRoom(root)).toThrow(/as-of/);
  });
});
