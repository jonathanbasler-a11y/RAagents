import 'server-only';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { DOCUMENT_SOURCE_TYPES, type DocumentSourceType, type NewDocument } from '@/shared/contracts';
import { checkAsOf, checkNewDocument } from '@/shared/data-room';

// The fictional practice case (an invented licensing data room) as a data room a person can start with. Only the
// documents leave the pack. Its answer key (the planted issues) is for the evaluations and is never read here:
// this reader looks at `as_of` and `documents` and nothing else. A test keeps its documents equal to what the
// evaluation loader reads, so the two cannot drift.

export const PRACTICE_PACK_DIR = 'evals/packs/practice-01';

export interface PracticeRoom {
  asOf: string;
  documents: NewDocument[];
}

type Fields = Record<string, unknown>;
const isMapping = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The practice data room, read from `root` (the app folder), or null when the pack is not there. Throws an Error
 * that says what is wrong when the pack is there but broken: a pack that cannot be read must not look like one that
 * is not installed.
 */
export function loadPracticeRoom(root: string = process.cwd()): PracticeRoom | null {
  const dir = path.join(root, PRACTICE_PACK_DIR);
  const packFile = path.join(dir, 'pack.yaml');
  if (!existsSync(packFile)) return null;

  let raw: unknown;
  try {
    raw = parse(readFileSync(packFile, 'utf8'));
  } catch (error) {
    throw new Error(`pack.yaml is not valid YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  if (!isMapping(raw)) throw new Error('pack.yaml must be a mapping of fields');

  const asOf = checkAsOf(raw.as_of);
  if (!asOf.ok) throw new Error(`pack.yaml: ${asOf.message}`);
  if (!Array.isArray(raw.documents) || raw.documents.length === 0) throw new Error('pack.yaml: documents must list at least one document');

  const documents = raw.documents.map((entry, index): NewDocument => {
    if (!isMapping(entry)) throw new Error(`document ${index + 1} must be a mapping of fields`);
    const id = typeof entry.id === 'string' ? entry.id : `document ${index + 1}`;
    const provided = entry.provided === undefined ? true : entry.provided;
    if (typeof provided !== 'boolean') throw new Error(`${id}: provided must be true or false`);
    const sourceType: DocumentSourceType = (DOCUMENT_SOURCE_TYPES as readonly unknown[]).includes(entry.source)
      ? (entry.source as DocumentSourceType)
      : 'company-disclosure';

    let text: string | null = null;
    if (provided) {
      const file = typeof entry.file === 'string' ? entry.file : '';
      const resolved = path.resolve(dir, file);
      if (file === '' || path.isAbsolute(file) || path.relative(dir, resolved).startsWith('..')) {
        throw new Error(`${id}: file must name a file inside the pack folder`);
      }
      try {
        if (!statSync(resolved).isFile()) throw new Error('not a file');
        text = readFileSync(resolved, 'utf8');
      } catch {
        throw new Error(`${id}: cannot read ${file}`);
      }
    }

    const checked = checkNewDocument(
      { id: entry.id, title: entry.title, sourceType, publishedAt: typeof entry.dated === 'string' ? entry.dated : null, provided, text },
      asOf.asOf,
      'practice-pack',
    );
    if (!checked.ok) throw new Error(`${id}: ${checked.message}`);
    return checked.document;
  });

  return { asOf: asOf.asOf, documents };
}
