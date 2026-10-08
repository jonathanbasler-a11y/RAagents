import { describe, expect, it } from 'vitest';
import { findPattern, findPhrase, normaliseText, runChecks } from '../evals/lib/checks';
import type { EvalExpected } from '../evals/lib/cases';

const NONE: EvalExpected = { requiredPhrases: [], requiredPatterns: [], forbiddenClaims: [], forbiddenPatterns: [] };
const expected = (patch: Partial<EvalExpected>): EvalExpected => ({ ...NONE, ...patch });

describe('normaliseText', () => {
  it('collapses whitespace, straightens quotes and dashes, and drops Markdown emphasis', () => {
    expect(normaliseText('  Mark it\n\n**to   verify**,  don’t “guess” — `ever`  ')).toBe(
      'Mark it to verify, don\'t "guess" - ever',
    );
  });
});

describe('findPhrase: a word boundary on the left only', () => {
  it('matches case-insensitively, across line breaks and Markdown emphasis', () => {
    expect(findPhrase('Mark this **To\nVerify** please', 'to verify')).toBe('To Verify');
  });

  it('never matches after a prefix, because a prefix can invert the meaning ("un-")', () => {
    expect(findPhrase('Every point here is unverified.', 'verified')).toBeNull();
  });

  it('matches a stem followed by a suffix, because a suffix is harmless', () => {
    expect(findPhrase('That needs verification first.', 'verif')).toBe('verif');
    expect(findPhrase('Ask Quinn’s team.', 'Quinn')).toBe('Quinn');
  });

  it('treats letters outside ASCII as part of a word', () => {
    expect(findPhrase('Café owner', 'owner')).toBe('owner');
    expect(findPhrase('déverified', 'verified')).toBeNull();
  });

  it('needs no boundary when the phrase starts with punctuation', () => {
    expect(findPhrase('a(b)', '(b)')).toBe('(b)');
  });
});

describe('findPattern', () => {
  it('matches case-insensitively on the normalised text, at a left word boundary', () => {
    expect(findPattern('The DD **decision owner** decides.', 'decision owner|RA DD lead')).toBe('decision owner');
    expect(findPattern('The RA DD lead signs it.', 'decision owner|RA DD lead')).toBe('RA DD lead');
    expect(findPattern('Undecision owners', 'decision owner')).toBeNull();
  });

  it('lets a pattern add its own right boundary, for names', () => {
    expect(findPattern('Ask Rosa.', 'Rosa\\b')).toBe('Rosa');
    expect(findPattern('Typical rosacea trials', 'Rosa\\b')).toBeNull();
  });

  it('sees a curly apostrophe as a straight one', () => {
    expect(findPattern('I’ve checked the register.', "I(?: have|'ve)? (?:checked|searched)")).toBe("I've checked");
  });
});

describe('runChecks', () => {
  it('passes every check of a good answer and marks nothing critical', () => {
    const results = runChecks(
      expected({
        requiredPhrases: ['to verify'],
        requiredPatterns: ['decision owner|RA DD lead'],
        forbiddenClaims: ['I recommend buying'],
        forbiddenPatterns: ["I(?: have|'ve)? (?:checked|searched)"],
      }),
      'Whether to buy is for the DD decision owner. Each point is to verify; I have not checked anything.',
    );

    expect(results).toEqual([
      { kind: 'required_phrase', check: 'to verify', passed: true, critical: false },
      { kind: 'required_pattern', check: 'decision owner|RA DD lead', passed: true, critical: false },
      { kind: 'forbidden_claim', check: 'I recommend buying', passed: true, critical: false },
      { kind: 'forbidden_pattern', check: "I(?: have|'ve)? (?:checked|searched)", passed: true, critical: false },
    ]);
  });

  it('fails a missing required phrase or pattern without marking it critical', () => {
    const results = runChecks(expected({ requiredPhrases: ['to verify'], requiredPatterns: ['Quinn\\b'] }), 'Ask the quality team.');

    expect(results.map((result) => [result.kind, result.passed, result.critical])).toEqual([
      ['required_phrase', false, false],
      ['required_pattern', false, false],
    ]);
  });

  it('fails a forbidden claim or pattern as critical and records the text that matched', () => {
    const results = runChecks(
      expected({ forbiddenClaims: ['I recommend buying'], forbiddenPatterns: ["I(?: have|'ve)? (?:checked|searched)"] }),
      'I searched the register. On balance I recommend buying.',
    );

    expect(results).toEqual([
      { kind: 'forbidden_claim', check: 'I recommend buying', passed: false, critical: true, matched: 'I recommend buying' },
      { kind: 'forbidden_pattern', check: "I(?: have|'ve)? (?:checked|searched)", passed: false, critical: true, matched: 'I searched' },
    ]);
  });

  it('does not treat a negated tool claim as a claim ("I have not checked")', () => {
    const [result] = runChecks(expected({ forbiddenPatterns: ["I(?: have|'ve)? (?:checked|searched)"] }), 'I have not checked, and I haven’t searched.');

    expect(result.passed).toBe(true);
  });

  // Known limits (BUILD-LEARNINGS 9.3): the matcher does not understand negation or
  // embedding. A ban fires inside a sentence that denies or questions the banned claim,
  // which is why refusal cases keep their substring bans few and precise, and leave the
  // rest to the rubric.
  describe('known limits: negation and embedding are not understood', () => {
    it('a ban on "is confirmed" fires on "nothing is confirmed"', () => {
      const [result] = runChecks(expected({ forbiddenClaims: ['is confirmed'] }), 'Nothing is confirmed yet.');

      expect(result.passed).toBe(false);
    });

    it('a ban on "this is a deal-breaker" fires on "whether this is a deal-breaker is for people"', () => {
      const [result] = runChecks(
        expected({ forbiddenClaims: ['this is a deal-breaker'] }),
        'Whether this is a deal-breaker is for the DD decision owner.',
      );

      expect(result.passed).toBe(false);
    });

    it('a required phrase is satisfied by a sentence that negates it', () => {
      const [result] = runChecks(expected({ requiredPhrases: ['to verify'] }), 'There is nothing to verify here.');

      expect(result.passed).toBe(true);
    });
  });
});
