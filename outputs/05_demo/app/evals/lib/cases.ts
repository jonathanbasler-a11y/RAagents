// Eval cases (BUILD-LEARNINGS 9.2): the schema and the loader.
//
// Case files are YAML under evals/cases/, each holding a `cases:` list. Keys are
// snake_case; evals/README.md describes them. The loader refuses, with every problem of
// every file in one error:
// - duplicate ids;
// - a case that asserts nothing (no deterministic check, and not marked rubric_only);
// - a last turn not from the person;
// - a forbidden claim or pattern the case text already contains (a correct echo would
//   trip it), and a required one the case text already contains (an echo would pass it);
// - unknown keys at any level, so a typo cannot silently drop a check.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LineCounter, parseDocument } from 'yaml';
import { AGENT_ID_PATTERN, RESERVED_AGENT_IDS } from '@/server/agents/spec-format';
import type { ChatLimits } from '@/shared/contracts';
import { findPattern, findPhrase, normaliseText, patternRegExp } from './checks';

export const CASE_CATEGORIES = ['normal', 'grounded', 'tool', 'adversarial', 'multi-turn'] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CASE_RISKS = ['standard', 'sensitive', 'factual', 'side-effect'] as const;
export type CaseRisk = (typeof CASE_RISKS)[number];

/** The longest question the chat accepts; a case turn may not be longer. */
const TURN_TEXT_MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;

const CASE_ID_PATTERN = /^[a-z][a-z0-9-]{0,79}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Deterministic checks of one case. Each list may be empty. */
export interface EvalExpected {
  /** Each must appear in the answer (case-insensitive, word boundary on the left). */
  requiredPhrases: string[];
  /** Each must match the answer (regular expression, case-insensitive, word boundary on the left). */
  requiredPatterns: string[];
  /** None may appear in the answer. A hit is a critical failure. */
  forbiddenClaims: string[];
  /** None may match the answer. A hit is a critical failure. */
  forbiddenPatterns: string[];
}

export interface EvalTurn {
  /** user: the person · assistant: the agent (an earlier reply, in a multi-turn case). */
  role: 'user' | 'assistant';
  /** Trimmed, as the chat trims a question. */
  content: string;
}

/** One case, as the loader returns it. */
export interface EvalCase {
  id: string;
  /** Bumped by the author whenever the case changes meaning. */
  version: number;
  /** The agent id that answers, in its 1:1 room. */
  agent: string;
  category: CaseCategory;
  risk: CaseRisk;
  /** YYYY-MM-DD. The frozen date of the run's clock; later, the as-of filter for retrieval. */
  asOf: string;
  /** The person asks for a decision reserved for people (deal-breakers, the overall assessment, the recommendation). */
  humanReservedDecision: boolean;
  /** Starts with the person, alternates, ends with the person. */
  turns: EvalTurn[];
  expected: EvalExpected;
  /** Only the rubric can judge this case: deterministic checks would misfire (for example on a refusal). */
  rubricOnly: boolean;
  /** What a good answer does, one criterion per item. The judge grades against it. */
  rubric: string[];
  /** The case file's name, for messages. Not part of the hash. */
  source: string;
  /** sha256 of everything above except `source`: any change to the case changes it. */
  hash: string;
}

export interface CaseIssue {
  /** The case file's name. */
  source: string;
  /** The case's id (or its position, when the id is unusable). */
  caseId?: string;
  message: string;
}

export function formatIssue(issue: CaseIssue): string {
  return issue.caseId === undefined ? `${issue.source}: ${issue.message}` : `${issue.source}, case ${issue.caseId}: ${issue.message}`;
}

/** Every problem the loader found, in file order. */
export class EvalCaseError extends Error {
  readonly issues: CaseIssue[];

  constructor(issues: CaseIssue[]) {
    super(`${issues.length} problem${issues.length === 1 ? '' : 's'} in the eval cases:\n${issues.map(formatIssue).join('\n')}`);
    this.name = 'EvalCaseError';
    this.issues = issues;
  }
}

export interface ParsedCaseFile {
  /** The cases with no issues. */
  cases: EvalCase[];
  issues: CaseIssue[];
}

type Fields = Record<string, unknown>;

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['cases']);
const CASE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'version',
  'agent',
  'category',
  'risk',
  'as_of',
  'human_reserved_decision',
  'turns',
  'expected',
  'rubric_only',
  'rubric',
]);
const REQUIRED_CASE_KEYS = ['id', 'version', 'agent', 'category', 'risk', 'as_of', 'turns', 'rubric'] as const;
const TURN_KEYS: ReadonlySet<string> = new Set(['role', 'content']);

/** The `expected` keys, the field each fills, and how messages name one entry. */
const EXPECTED_LISTS = [
  { key: 'required_phrases', field: 'requiredPhrases', label: 'required phrase', kind: 'phrase', mode: 'required' },
  { key: 'required_patterns', field: 'requiredPatterns', label: 'required pattern', kind: 'pattern', mode: 'required' },
  { key: 'forbidden_claims', field: 'forbiddenClaims', label: 'forbidden claim', kind: 'phrase', mode: 'forbidden' },
  { key: 'forbidden_patterns', field: 'forbiddenPatterns', label: 'forbidden pattern', kind: 'pattern', mode: 'forbidden' },
] as const satisfies ReadonlyArray<{ key: string; field: keyof EvalExpected; label: string; kind: 'phrase' | 'pattern'; mode: 'required' | 'forbidden' }>;
const EXPECTED_KEYS: ReadonlySet<string> = new Set(EXPECTED_LISTS.map((list) => list.key));

const isMapping = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

function nearMiss(key: string, allowed: ReadonlySet<string>): string {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return snake !== key && allowed.has(snake) ? ` (did you mean "${snake}"?)` : '';
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** sha256 (hex) of the case content, in a fixed key order. */
function hashCase(evalCase: Omit<EvalCase, 'source' | 'hash'>): string {
  const content = {
    id: evalCase.id,
    version: evalCase.version,
    agent: evalCase.agent,
    category: evalCase.category,
    risk: evalCase.risk,
    asOf: evalCase.asOf,
    humanReservedDecision: evalCase.humanReservedDecision,
    turns: evalCase.turns.map(({ role, content: text }) => ({ role, content: text })),
    expected: {
      requiredPhrases: evalCase.expected.requiredPhrases,
      requiredPatterns: evalCase.expected.requiredPatterns,
      forbiddenClaims: evalCase.expected.forbiddenClaims,
      forbiddenPatterns: evalCase.expected.forbiddenPatterns,
    },
    rubricOnly: evalCase.rubricOnly,
    rubric: evalCase.rubric,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Reads one case mapping; reports through `report` and returns undefined when anything is wrong. */
function readCase(raw: unknown, index: number, report: (caseId: string, message: string) => void, source: string): EvalCase | undefined {
  if (!isMapping(raw)) {
    report(`#${index + 1}`, 'each case must be a mapping of fields ("key: value" lines)');
    return undefined;
  }
  const caseId = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id : `#${index + 1}`;
  let ok = true;
  const problem = (message: string) => {
    ok = false;
    report(caseId, message);
  };

  for (const key of Object.keys(raw)) {
    if (!CASE_KEYS.has(key)) problem(`unknown key "${key}"${nearMiss(key, CASE_KEYS)}; evals/README.md lists the allowed keys`);
  }
  for (const key of REQUIRED_CASE_KEYS) {
    if (raw[key] === undefined || raw[key] === null) problem(`missing required key "${key}"`);
  }

  const id = typeof raw.id === 'string' ? raw.id : '';
  if (raw.id !== undefined && raw.id !== null && !CASE_ID_PATTERN.test(id)) {
    problem(`id "${String(raw.id)}" must be lowercase letters, digits and hyphens, starting with a letter (at most 80 characters)`);
  }
  const version = raw.version;
  if (version !== undefined && version !== null && !(typeof version === 'number' && Number.isSafeInteger(version) && version >= 1)) {
    problem('version must be a whole number from 1');
  }
  const agent = typeof raw.agent === 'string' ? raw.agent : '';
  if (raw.agent !== undefined && raw.agent !== null && (!AGENT_ID_PATTERN.test(agent) || RESERVED_AGENT_IDS.has(agent))) {
    problem(`agent "${String(raw.agent)}" is not an agent id (lowercase letters, digits and hyphens, as in outputs/04_agents)`);
  }
  const category = raw.category;
  if (category !== undefined && category !== null && !(CASE_CATEGORIES as readonly unknown[]).includes(category)) {
    problem(`category must be one of ${CASE_CATEGORIES.join(', ')}`);
  }
  const risk = raw.risk;
  if (risk !== undefined && risk !== null && !(CASE_RISKS as readonly unknown[]).includes(risk)) {
    problem(`risk must be one of ${CASE_RISKS.join(', ')}`);
  }
  const asOf = typeof raw.as_of === 'string' ? raw.as_of : '';
  if (raw.as_of !== undefined && raw.as_of !== null && !isCalendarDate(asOf)) {
    problem('as_of must be a date written YYYY-MM-DD, such as 2026-10-08');
  }
  const flag = (key: 'human_reserved_decision' | 'rubric_only'): boolean => {
    const value = raw[key];
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      problem(`${key} must be true or false`);
      return false;
    }
    return value;
  };
  const humanReservedDecision = flag('human_reserved_decision');
  const rubricOnly = flag('rubric_only');

  const turns = readTurns(raw.turns, problem);
  const caseText = turns?.map((turn) => turn.content).join('\n') ?? '';
  const expected = readExpected(raw.expected, caseText, turns !== undefined, problem);

  if (expected !== undefined) {
    const checkCount = EXPECTED_LISTS.reduce((count, list) => count + expected[list.field].length, 0);
    if (checkCount === 0 && !rubricOnly) {
      problem(
        'the case asserts nothing: add a deterministic check under "expected", or set rubric_only: true when only the rubric can judge it (BUILD-LEARNINGS 9.3)',
      );
    } else if (checkCount > 0 && rubricOnly) {
      problem('rubric_only is true, but the case has deterministic checks; remove the checks or the flag');
    }
  }

  const rubric = readRubric(raw.rubric, problem);

  if (!ok || turns === undefined || expected === undefined || rubric === undefined) return undefined;
  const evalCase: Omit<EvalCase, 'source' | 'hash'> = {
    id,
    version: version as number,
    agent,
    category: category as CaseCategory,
    risk: risk as CaseRisk,
    asOf,
    humanReservedDecision,
    turns,
    expected,
    rubricOnly,
    rubric,
  };
  return { ...evalCase, source, hash: hashCase(evalCase) };
}

function readTurns(value: unknown, problem: (message: string) => void): EvalTurn[] | undefined {
  if (value === undefined || value === null) return undefined; // reported as a missing key
  if (!Array.isArray(value) || value.length === 0) {
    problem('turns must list at least one turn, ending with the person');
    return undefined;
  }
  const turns: EvalTurn[] = [];
  let ok = true;
  let rolesOk = true;
  value.forEach((raw, index) => {
    const at = `turn ${index + 1}`;
    if (!isMapping(raw)) {
      problem(`${at} must be a mapping with "role" and "content"`);
      ok = false;
      rolesOk = false;
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!TURN_KEYS.has(key)) {
        problem(`${at} has unknown key "${key}"; a turn has only "role" and "content"`);
        ok = false;
      }
    }
    if (raw.role !== 'user' && raw.role !== 'assistant') {
      problem(`${at} has role "${String(raw.role)}"; use "user" (the person) or "assistant" (the agent)`);
      ok = false;
      rolesOk = false;
    }
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (content === '') {
      problem(`${at} is empty`);
      ok = false;
    } else if (content.length > TURN_TEXT_MAX_CHARS) {
      problem(`${at} is longer than ${TURN_TEXT_MAX_CHARS.toLocaleString('en')} characters, the chat's limit`);
      ok = false;
    }
    turns.push({ role: raw.role === 'assistant' ? 'assistant' : 'user', content });
  });
  if (rolesOk) {
    if (turns[0].role !== 'user') {
      problem('turn 1 must come from the person (role "user"); turns start with the person');
      ok = false;
    }
    for (let index = 1; index < turns.length; index += 1) {
      if (turns[index].role === turns[index - 1].role) {
        problem(
          `turn ${index + 1} must come from the ${turns[index].role === 'user' ? 'agent (role "assistant")' : 'person (role "user")'}; turns alternate`,
        );
        ok = false;
      }
    }
    if (turns[turns.length - 1].role !== 'user') {
      problem('the last turn must come from the person (role "user"), because the agent answers it');
      ok = false;
    }
  }
  return ok ? turns : undefined;
}

function readExpected(
  value: unknown,
  caseText: string,
  turnsOk: boolean,
  problem: (message: string) => void,
): EvalExpected | undefined {
  const expected: EvalExpected = { requiredPhrases: [], requiredPatterns: [], forbiddenClaims: [], forbiddenPatterns: [] };
  if (value === undefined || value === null) return expected;
  if (!isMapping(value)) {
    problem('expected must be a mapping of check lists');
    return undefined;
  }
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!EXPECTED_KEYS.has(key)) {
      problem(`unknown key "${key}" in expected${nearMiss(key, EXPECTED_KEYS)}; allowed: ${[...EXPECTED_KEYS].join(', ')}`);
      ok = false;
    }
  }
  for (const list of EXPECTED_LISTS) {
    const raw = value[list.key];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
      problem(`expected.${list.key} must be a list of text`);
      ok = false;
      continue;
    }
    raw.forEach((entry: string, index) => {
      if (normaliseText(entry) === '') {
        problem(`${list.label} ${index + 1} is empty`);
        ok = false;
        return;
      }
      let found: string | null;
      if (list.kind === 'pattern') {
        try {
          if (patternRegExp(entry).test('')) {
            problem(`${list.label} "${entry}" matches empty text, so it checks nothing`);
            ok = false;
            return;
          }
        } catch {
          problem(`${list.label} "${entry}" is not a valid regular expression`);
          ok = false;
          return;
        }
        found = turnsOk ? findPattern(caseText, entry) : null;
      } else {
        found = turnsOk ? findPhrase(caseText, entry) : null;
      }
      if (found !== null) {
        const verb = list.kind === 'pattern' ? 'already matches' : 'already appears in';
        const why = list.mode === 'forbidden' ? 'so a correct echo would trip it' : 'so an echo would satisfy it';
        problem(`${list.label} "${entry}" ${verb} the case text, ${why}`);
        ok = false;
      }
    });
    expected[list.field] = [...raw];
  }
  return ok ? expected : undefined;
}

function readRubric(value: unknown, problem: (message: string) => void): string[] | undefined {
  if (value === undefined || value === null) return undefined; // reported as a missing key
  if (!Array.isArray(value) || value.length === 0) {
    problem('rubric must list at least one criterion');
    return undefined;
  }
  let ok = true;
  const rubric = value.map((entry, index) => {
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (text === '') {
      problem(`rubric criterion ${index + 1} is empty`);
      ok = false;
    }
    return text;
  });
  return ok ? rubric : undefined;
}

/** Parses one case file. Never throws: problems come back as issues, and only clean cases are returned. */
export function parseCaseFile(text: string, source: string): ParsedCaseFile {
  const issues: CaseIssue[] = [];
  const fileProblem = (message: string) => issues.push({ source, message });
  const lineCounter = new LineCounter();
  const doc = parseDocument(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n'), { lineCounter, prettyErrors: false, uniqueKeys: true });
  const problems = [...doc.errors, ...doc.warnings];
  for (const problem of problems) fileProblem(`YAML error on line ${lineCounter.linePos(problem.pos[0]).line}: ${problem.message}`);
  if (problems.length > 0) return { cases: [], issues };

  let value: unknown;
  try {
    value = doc.toJS();
  } catch (error) {
    fileProblem(`YAML could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { cases: [], issues };
  }
  if (isMapping(value)) {
    for (const key of Object.keys(value)) {
      if (!TOP_LEVEL_KEYS.has(key)) fileProblem(`unknown top-level key "${key}"; a case file holds only a "cases" list`);
    }
  }
  const list = isMapping(value) ? value.cases : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    fileProblem('the file must hold a "cases" list with at least one case');
    return { cases: [], issues };
  }

  const cases: EvalCase[] = [];
  list.forEach((raw, index) => {
    const evalCase = readCase(raw, index, (caseId, message) => issues.push({ source, caseId, message }), source);
    if (evalCase) cases.push(evalCase);
  });
  return { cases, issues };
}

/** One issue per repeated id, on the later case. */
export function findDuplicateIds(cases: readonly EvalCase[]): CaseIssue[] {
  const first = new Map<string, EvalCase>();
  const issues: CaseIssue[] = [];
  for (const evalCase of cases) {
    const earlier = first.get(evalCase.id);
    if (earlier === undefined) first.set(evalCase.id, evalCase);
    else issues.push({ source: evalCase.source, caseId: evalCase.id, message: `duplicate id; ${earlier.source} already has a case with this id` });
  }
  return issues;
}

/**
 * Reads every *.yaml and *.yml file in `dir` (by name; hidden files skipped) and returns
 * the cases in file order. Throws EvalCaseError listing every issue of every file, or an
 * Error naming the folder when it cannot be read.
 */
export function loadCases(dir: string): EvalCase[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    throw new Error(code === 'ENOENT' ? `eval cases folder not found: ${dir}` : `cannot read the eval cases folder ${dir}: ${code ?? String(error)}`, {
      cause: error,
    });
  }
  const files = names.filter((name) => /\.ya?ml$/.test(name) && !name.startsWith('.')).sort();
  if (files.length === 0) {
    throw new EvalCaseError([{ source: path.basename(dir) || dir, message: 'no case files (*.yaml or *.yml) in this folder' }]);
  }

  const issues: CaseIssue[] = [];
  const cases: EvalCase[] = [];
  for (const file of files) {
    const parsed = parseCaseFile(readFileSync(path.join(dir, file), 'utf8'), file);
    issues.push(...parsed.issues);
    cases.push(...parsed.cases);
  }
  issues.push(...findDuplicateIds(cases));
  if (issues.length > 0) throw new EvalCaseError(issues);
  return cases;
}
