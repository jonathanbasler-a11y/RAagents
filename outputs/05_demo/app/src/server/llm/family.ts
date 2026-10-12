import 'server-only';

/** Vendor family of a model id, used to check that the judge differs from the agents. */
export type ModelFamily = 'anthropic' | 'openai' | 'google' | 'meta' | 'mistral' | 'unknown';

// A short vendor token counts only as a whole segment of the id (segments are split by
// . / : _ -), so "solar" or "console" never read as the "sol" models.
const FAMILY_PATTERNS: ReadonlyArray<readonly [ModelFamily, RegExp]> = [
  ['anthropic', /anthropic|claude/],
  ['openai', /openai|gpt|(?:^|[./:_-])(?:o\d+|sol)(?=$|[./:_-])/],
  ['google', /google|gemini|gemma/],
  ['meta', /(?:^|[./:_-])meta(?=$|[./:_-])|llama/],
  ['mistral', /mistral|mixtral|codestral/],
];

/** The vendor family a model id belongs to, or "unknown" when the id does not say. */
export function modelFamily(model: string | null | undefined): ModelFamily {
  const id = (model ?? '').toLowerCase();
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(id)) return family;
  }
  return 'unknown';
}
