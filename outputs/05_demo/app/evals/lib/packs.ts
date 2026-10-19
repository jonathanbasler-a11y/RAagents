// Case packs (BUILD-LEARNINGS 9.7, 9.9): fictional practice documents plus the answer key, kept
// beside the cases. A pack is one folder under evals/packs/<id>/ with a pack.yaml and the
// document files it names.
//
// The loader refuses what would make a run unfair or unsafe:
// - a document dated after the pack's as-of date (a later source is a hard failure, not a warning);
// - a document that does not say it is fictional in its first lines (nobody pastes real material in by accident);
// - an answer key that points at a document that is not in the pack;
// - unknown keys at any level, so a typo cannot silently drop a field.
// bindPacks then checks the cases against the packs: every issue of a pack is probed by some case,
// a case shows the documents where its issues are planted, and never shows a withheld document.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { UntrustedBlock } from '@/server/prompts';
import { DOCUMENT_SOURCE_TYPES, type DocumentSourceType } from '@/shared/contracts';
import { DOCUMENT_ID_PATTERN, EvalCaseError, isCalendarDate, ISSUE_ID_PATTERN, PACK_ID_PATTERN, type CaseIssue, type EvalCase } from './cases';

export const ISSUE_KINDS = [
  'claim-vs-record',
  'gap',
  'withheld-document',
  'unsupported-claim',
  'after-cutoff',
  'agent-error',
  'clean-decoy',
  'referral',
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export const ISSUE_SEVERITIES = ['high', 'medium', 'low', 'none'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** Kinds that are planted in the conversation, not in a document. */
const PLANTED_IN_CONVERSATION: ReadonlySet<IssueKind> = new Set(['agent-error', 'referral']);

export interface PackDocument {
  id: string;
  title: string;
  /** false: listed in the data room index, deliberately not in the pack. */
  provided: boolean;
  /** YYYY-MM-DD; always set for a provided document. */
  dated?: string;
  /** The file's text; set for a provided document. */
  text?: string;
  /** What kind of source it is; a company disclosure when the pack does not say. */
  source: DocumentSourceType;
}

/** One entry of the answer key. */
export interface PackIssue {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  /** The documents where it is planted (empty for the kinds planted in the conversation). */
  plantedIn: string[];
  rightResponse: string;
  wrongResponse: string;
  failureMode: string;
}

export interface CasePack {
  id: string;
  title: string;
  /** YYYY-MM-DD: no document may be dated after it. */
  asOf: string;
  documents: PackDocument[];
  issues: PackIssue[];
  /** sha256 of everything above (text included): any change to a document or the key changes it. */
  hash: string;
  /** The pack folder's name, for messages. */
  source: string;
}

export class EvalPackError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`${issues.length} problem${issues.length === 1 ? '' : 's'} in the eval packs:\n${issues.join('\n')}`);
    this.name = 'EvalPackError';
    this.issues = issues;
  }
}

type Fields = Record<string, unknown>;
const isMapping = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

const PACK_KEYS: ReadonlySet<string> = new Set(['id', 'title', 'as_of', 'documents', 'issues']);
const DOCUMENT_KEYS: ReadonlySet<string> = new Set(['id', 'title', 'file', 'dated', 'provided', 'source']);
const ISSUE_KEYS: ReadonlySet<string> = new Set(['id', 'kind', 'severity', 'planted_in', 'right_response', 'wrong_response', 'failure_mode']);

/** A document must say it is fictional within its first lines. */
const FICTION_NOTICE = /fictional/i;
const NOTICE_LINES = 5;
const MAX_DOCUMENT_CHARS = 12_000;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Reads one pack folder. Problems come back as messages; a pack with any problem is not returned. */
export function loadPack(dir: string): { pack?: CasePack; issues: string[] } {
  const source = path.basename(dir);
  const issues: string[] = [];
  const problem = (message: string) => issues.push(`${source}: ${message}`);

  let rawText: string;
  try {
    rawText = readFileSync(path.join(dir, 'pack.yaml'), 'utf8');
  } catch {
    problem('cannot read pack.yaml');
    return { issues };
  }
  const parsed = parseDocument(rawText);
  if (parsed.errors.length > 0) {
    problem(`pack.yaml is not valid YAML: ${parsed.errors[0].message.split('\n')[0]}`);
    return { issues };
  }
  const raw: unknown = parsed.toJS();
  if (!isMapping(raw)) {
    problem('pack.yaml must be a mapping of fields');
    return { issues };
  }
  for (const key of Object.keys(raw)) if (!PACK_KEYS.has(key)) problem(`unknown key "${key}"`);

  const id = raw.id;
  if (typeof id !== 'string' || !PACK_ID_PATTERN.test(id)) problem('id must be lowercase letters, digits and hyphens, starting with a letter');
  if (!nonEmptyString(raw.title)) problem('title is missing');
  const asOf = typeof raw.as_of === 'string' ? raw.as_of : '';
  if (!isCalendarDate(asOf)) problem('as_of must be a date written YYYY-MM-DD');

  const documents: PackDocument[] = [];
  const documentIds = new Set<string>();
  if (!Array.isArray(raw.documents) || raw.documents.length === 0) {
    problem('documents must list at least one document');
  } else {
    raw.documents.forEach((entry, index) => {
      if (!isMapping(entry)) {
        problem(`document ${index + 1} must be a mapping of fields`);
        return;
      }
      const docId = typeof entry.id === 'string' ? entry.id : '';
      const at = docId === '' ? `document ${index + 1}` : `document ${docId}`;
      for (const key of Object.keys(entry)) if (!DOCUMENT_KEYS.has(key)) problem(`${at}: unknown key "${key}"`);
      if (!DOCUMENT_ID_PATTERN.test(docId)) {
        problem(`${at}: id must look like DR-03 (capital letters, digits and hyphens)`);
        return;
      }
      if (documentIds.has(docId)) {
        problem(`duplicate document id "${docId}"`);
        return;
      }
      documentIds.add(docId);
      if (!nonEmptyString(entry.title)) problem(`${at}: title is missing`);
      const title = nonEmptyString(entry.title) ? entry.title.trim() : docId;
      const provided = entry.provided === undefined ? true : entry.provided;
      if (entry.source !== undefined && !(DOCUMENT_SOURCE_TYPES as readonly unknown[]).includes(entry.source)) {
        problem(`${at}: source must be one of ${DOCUMENT_SOURCE_TYPES.join(', ')}`);
      }
      const source: DocumentSourceType = (DOCUMENT_SOURCE_TYPES as readonly unknown[]).includes(entry.source) ? (entry.source as DocumentSourceType) : 'company-disclosure';
      if (typeof provided !== 'boolean') {
        problem(`${at}: provided must be true or false`);
        return;
      }

      if (!provided) {
        if (entry.file !== undefined) problem(`${at}: provided: false means the document is withheld, so it has no file`);
        documents.push({ id: docId, title, provided: false, source, ...(typeof entry.dated === 'string' ? { dated: entry.dated } : {}) });
        return;
      }

      const dated = typeof entry.dated === 'string' ? entry.dated : '';
      if (!isCalendarDate(dated)) {
        problem(`${at}: needs a date, dated: YYYY-MM-DD`);
      } else if (isCalendarDate(asOf) && dated > asOf) {
        problem(`${at}: dated ${dated}, which is after the pack's as-of date ${asOf}; a later source may never be shown`);
      }
      const file = typeof entry.file === 'string' ? entry.file : '';
      const resolved = path.resolve(dir, file);
      if (file === '' || path.isAbsolute(file) || path.relative(dir, resolved).startsWith('..')) {
        problem(`${at}: file must name a file inside the pack folder`);
        return;
      }
      let text: string;
      try {
        if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error('not a file');
        text = readFileSync(resolved, 'utf8').trim();
      } catch {
        problem(`${at}: cannot read ${file}`);
        return;
      }
      if (text === '') {
        problem(`${at}: ${file} is empty`);
        return;
      }
      if (text.length > MAX_DOCUMENT_CHARS) problem(`${at}: ${file} is longer than ${MAX_DOCUMENT_CHARS.toLocaleString('en')} characters`);
      if (!FICTION_NOTICE.test(text.split('\n').slice(0, NOTICE_LINES).join('\n'))) {
        problem(`${at}: ${file} must say it is fictional in its first ${NOTICE_LINES} lines`);
      }
      documents.push({ id: docId, title, provided: true, source, dated, text });
    });
  }

  const issueList: PackIssue[] = [];
  const issueIds = new Set<string>();
  if (!Array.isArray(raw.issues) || raw.issues.length === 0) {
    problem('issues must list the answer key: at least one planted issue');
  } else {
    raw.issues.forEach((entry, index) => {
      if (!isMapping(entry)) {
        problem(`issue ${index + 1} must be a mapping of fields`);
        return;
      }
      const issueId = typeof entry.id === 'string' ? entry.id : '';
      const at = issueId === '' ? `issue ${index + 1}` : `issue ${issueId}`;
      for (const key of Object.keys(entry)) if (!ISSUE_KEYS.has(key)) problem(`${at}: unknown key "${key}"`);
      if (!ISSUE_ID_PATTERN.test(issueId)) {
        problem(`${at}: id must look like PI-04`);
        return;
      }
      if (issueIds.has(issueId)) {
        problem(`duplicate issue id "${issueId}"`);
        return;
      }
      issueIds.add(issueId);
      let ok = true;
      const kind = entry.kind;
      if (!(ISSUE_KINDS as readonly unknown[]).includes(kind)) {
        problem(`${at}: kind must be one of ${ISSUE_KINDS.join(', ')}`);
        ok = false;
      }
      const severity = entry.severity;
      if (!(ISSUE_SEVERITIES as readonly unknown[]).includes(severity)) {
        problem(`${at}: severity must be one of ${ISSUE_SEVERITIES.join(', ')}`);
        ok = false;
      }
      for (const key of ['right_response', 'wrong_response', 'failure_mode'] as const) {
        if (!nonEmptyString(entry[key])) {
          problem(`${at}: ${key} is missing`);
          ok = false;
        }
      }
      const planted = entry.planted_in === undefined ? [] : entry.planted_in;
      if (!Array.isArray(planted) || planted.some((item) => typeof item !== 'string')) {
        problem(`${at}: planted_in must be a list of document ids`);
        ok = false;
      } else {
        for (const docId of planted as string[]) {
          if (!documentIds.has(docId)) {
            problem(`${at}: planted_in names ${docId}, which is not a document of this pack`);
            ok = false;
          }
        }
        if (planted.length === 0 && ok && !PLANTED_IN_CONVERSATION.has(kind as IssueKind)) {
          problem(`${at}: planted_in must name the document(s) where it is planted (only agent-error and referral issues are planted in the conversation)`);
          ok = false;
        }
      }
      if (ok) {
        issueList.push({
          id: issueId,
          kind: kind as IssueKind,
          severity: severity as IssueSeverity,
          plantedIn: planted as string[],
          rightResponse: (entry.right_response as string).trim(),
          wrongResponse: (entry.wrong_response as string).trim(),
          failureMode: (entry.failure_mode as string).trim(),
        });
      }
    });
  }

  if (issues.length > 0) return { issues };
  const content = {
    id,
    title: (raw.title as string).trim(),
    asOf,
    documents: documents.map((doc) => ({ id: doc.id, title: doc.title, provided: doc.provided, source: doc.source, dated: doc.dated ?? null, text: doc.text ?? null })),
    issues: issueList,
  };
  return { pack: { ...(content as Omit<CasePack, 'hash' | 'source'>), hash: sha256(JSON.stringify(content)), source }, issues };
}

/**
 * Every pack under `root` (one folder each, with a pack.yaml), by id. A missing folder is
 * no packs. Throws EvalPackError listing every problem of every pack.
 */
export function loadPacks(root: string): Map<string, CasePack> {
  const packs = new Map<string, CasePack>();
  if (!existsSync(root)) return packs;
  const problems: string[] = [];
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, 'pack.yaml')))
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const { pack, issues } = loadPack(path.join(root, folder));
    problems.push(...issues);
    if (pack !== undefined) {
      if (packs.has(pack.id)) problems.push(`${folder}: duplicate pack id "${pack.id}"`);
      else packs.set(pack.id, pack);
    }
  }
  if (problems.length > 0) throw new EvalPackError(problems);
  return packs;
}

/** The documents a case shows: the ones it lists, or every provided document of its pack. */
function visibleDocuments(evalCase: EvalCase, pack: CasePack): PackDocument[] {
  if (evalCase.documents === undefined) return pack.documents.filter((doc) => doc.provided);
  return evalCase.documents.map((id) => pack.documents.find((doc) => doc.id === id)).filter((doc): doc is PackDocument => doc !== undefined);
}

/**
 * Checks the cases against the packs, before any model call. Throws EvalCaseError with every
 * problem: an unknown pack, document or issue; a withheld document shown; a document dated
 * after the case's as-of date; a case that hides where its issue is planted; a pack issue
 * that no case probes.
 */
export function bindPacks(cases: readonly EvalCase[], packs: ReadonlyMap<string, CasePack>): void {
  const problems: CaseIssue[] = [];
  const probed = new Map<string, Set<string>>();
  for (const evalCase of cases) {
    if (evalCase.pack === undefined) continue;
    const report = (message: string) => problems.push({ source: evalCase.source, caseId: evalCase.id, message });
    const pack = packs.get(evalCase.pack);
    if (pack === undefined) {
      report(`unknown pack "${evalCase.pack}" (packs: ${[...packs.keys()].join(', ') || 'none'})`);
      continue;
    }
    for (const id of evalCase.documents ?? []) {
      const doc = pack.documents.find((candidate) => candidate.id === id);
      if (doc === undefined) report(`unknown document "${id}" in pack ${pack.id}`);
      else if (!doc.provided) report(`document ${id} is not provided in pack ${pack.id}: a withheld document cannot be shown`);
    }
    for (const id of evalCase.issues ?? []) {
      const issue = pack.issues.find((candidate) => candidate.id === id);
      if (issue === undefined) {
        report(`unknown issue "${id}" in pack ${pack.id}`);
        continue;
      }
      probed.set(pack.id, (probed.get(pack.id) ?? new Set()).add(id));
      const shown = new Set(visibleDocuments(evalCase, pack).map((doc) => doc.id));
      for (const docId of issue.plantedIn) {
        const doc = pack.documents.find((candidate) => candidate.id === docId);
        if (doc?.provided && !shown.has(docId)) report(`issue ${id} is planted in ${docId}, but the case does not show ${docId}`);
      }
    }
    for (const doc of visibleDocuments(evalCase, pack)) {
      if (doc.dated !== undefined && doc.dated > evalCase.asOf) {
        report(`document ${doc.id} is dated ${doc.dated}, which is after the case's as-of date ${evalCase.asOf}; a later source may never be shown`);
      }
    }
  }
  const usedPacks = new Set(cases.filter((evalCase) => evalCase.pack !== undefined).map((evalCase) => evalCase.pack as string));
  for (const packId of usedPacks) {
    const pack = packs.get(packId);
    if (pack === undefined) continue;
    for (const issue of pack.issues) {
      if (!probed.get(packId)?.has(issue.id)) problems.push({ source: `pack ${packId}`, message: `issue ${issue.id} is probed by no case` });
    }
  }
  if (problems.length > 0) throw new EvalCaseError(problems);
}

/**
 * The lines that ride on a case turn, written by code. They lift one rule for these documents
 * only and name what stays (BUILD-LEARNINGS Part 5: an exemption names the rule it lifts). A
 * rare-situation rule belongs on the turn, never in a persona or the shared rules.
 */
export const MATERIAL_INSTRUCTIONS: readonly string[] = [
  'Practice case: the fenced blocks under Room context are fictional case documents, written for this exercise and provided by the app. Using them is expected, and they are not a confidentiality problem.',
  'For this turn only, this lifts the statement in your brief and in the shared rules that no documents are connected, for these documents and nothing else. You still have no tools: you cannot search, browse, open other files or save anything.',
  'Cite the document id (for example DR-03) for every fact about the asset, company, site or study that comes from a document. A document shows what its author claims: when a company statement and an agency record differ, show both side by side and do not pick one.',
  'The data room index lists some documents as not provided. For anything that a missing or unlisted document would cover, say it was "not found in the data room"; never describe what it probably contains, and never say it does not exist.',
  'Keep fact (what a document says), inference (what you conclude) and recommendation apart, and leave the decisions reserved for people to them.',
];

export interface CaseMaterial {
  /** The fenced context blocks, one per shown document. */
  roomContext: UntrustedBlock[];
  /** The turn instructions that go with them. */
  instructions: string[];
  /** sha256 of the pack content and the shown documents; null for a case with no pack. */
  hash: string | null;
}

/** What a case adds to the agent's prompt: its documents as fenced blocks, and the turn instructions. */
export function caseMaterial(evalCase: EvalCase, pack: CasePack | undefined): CaseMaterial {
  if (evalCase.pack === undefined || pack === undefined) return { roomContext: [], instructions: [], hash: null };
  const shown = visibleDocuments(evalCase, pack);
  return {
    roomContext: shown.map((doc) => ({
      label: `Case document ${doc.id}: ${doc.title} (fictional practice document, dated ${doc.dated})`,
      text: doc.text ?? '',
    })),
    instructions: [...MATERIAL_INSTRUCTIONS],
    hash: sha256(`${pack.hash}\n${shown.map((doc) => doc.id).join(',')}`),
  };
}
