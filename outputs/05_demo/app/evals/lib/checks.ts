// Deterministic graders (BUILD-LEARNINGS 9.3).
//
// - Every check matches only where a word starts: a word boundary on the left, none on the
//   right. A prefix can invert the meaning ("unverified"); a suffix is a harmless stem
//   ("verification"). A pattern that needs a right boundary (a name) adds its own `\b`.
// - Matching ignores case, line breaks, Markdown emphasis (* and `), and curly quotes and
//   dashes, so "**To\nverify**" matches "to verify".
// - A failed forbidden claim or pattern is critical; a missing required phrase or pattern
//   is not. Paraphrasable requirements belong in the rubric, not here.
// - Known limit: negation and embedding are not understood. "Nothing is confirmed" trips
//   a ban on "is confirmed". Keep bans few and precise; refusals belong to the rubric.
import type { EvalExpected } from './cases';

export const CHECK_KINDS = ['required_phrase', 'required_pattern', 'forbidden_claim', 'forbidden_pattern'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export interface CheckResult {
  kind: CheckKind;
  /** The phrase or pattern as the case wrote it. */
  check: string;
  passed: boolean;
  /** A forbidden claim or pattern was found: a critical failure. */
  critical: boolean;
  /** For a failed forbidden check: the text that matched (normalised). */
  matched?: string;
}

/** Not preceded by a letter, digit or underscore: the left word boundary, for any script. */
const LEFT_BOUNDARY = '(?<![\\p{L}\\p{N}_])';
const WORD_START = /^[\p{L}\p{N}_]/u;

/** The text the checks see: NFKC, straight quotes and dashes, no Markdown emphasis, single spaces. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′ʼ]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A phrase as a regular expression: literal, case-insensitive, with a left word boundary. */
export function phraseRegExp(phrase: string): RegExp {
  const normal = normaliseText(phrase);
  if (normal === '') throw new TypeError('a phrase must not be empty');
  return new RegExp(`${WORD_START.test(normal) ? LEFT_BOUNDARY : ''}${escapeRegExp(normal)}`, 'iu');
}

/**
 * A case pattern as a regular expression: case-insensitive, Unicode, matched only at a
 * left word boundary. Throws a SyntaxError for an invalid pattern.
 */
export function patternRegExp(pattern: string): RegExp {
  return new RegExp(`${LEFT_BOUNDARY}(?:${pattern})`, 'iu');
}

/** The matching text of `phrase` in `text`, or null. */
export function findPhrase(text: string, phrase: string): string | null {
  return phraseRegExp(phrase).exec(normaliseText(text))?.[0] ?? null;
}

/** The matching text of `pattern` in `text`, or null. */
export function findPattern(text: string, pattern: string): string | null {
  return patternRegExp(pattern).exec(normaliseText(text))?.[0] ?? null;
}

/** Runs a case's deterministic checks on one answer, in the order required, then forbidden. */
export function runChecks(expected: EvalExpected, answer: string): CheckResult[] {
  const required = (kind: CheckKind, check: string, found: string | null): CheckResult => ({
    kind,
    check,
    passed: found !== null,
    critical: false,
  });
  const forbidden = (kind: CheckKind, check: string, found: string | null): CheckResult =>
    found === null ? { kind, check, passed: true, critical: false } : { kind, check, passed: false, critical: true, matched: found };

  return [
    ...expected.requiredPhrases.map((phrase) => required('required_phrase', phrase, findPhrase(answer, phrase))),
    ...expected.requiredPatterns.map((pattern) => required('required_pattern', pattern, findPattern(answer, pattern))),
    ...expected.forbiddenClaims.map((claim) => forbidden('forbidden_claim', claim, findPhrase(answer, claim))),
    ...expected.forbiddenPatterns.map((pattern) => forbidden('forbidden_pattern', pattern, findPattern(answer, pattern))),
  ];
}

/** Every check passed. */
export function allPassed(results: readonly CheckResult[]): boolean {
  return results.every((result) => result.passed);
}

/** Some forbidden check failed. */
export function hasCritical(results: readonly CheckResult[]): boolean {
  return results.some((result) => result.critical);
}
