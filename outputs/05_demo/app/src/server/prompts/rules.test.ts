import { describe, expect, it } from 'vitest';
import { PROMPT_MARKER, SHARED_RULES } from '@/server/prompts';

const paragraphs = SHARED_RULES.split(/\n\s*\n/).map((paragraph) => paragraph.trim());

/** The paragraph whose first sentence (its title) matches. */
function rule(title: RegExp): string {
  const found = paragraphs.find((paragraph) => title.test(paragraph.split('. ')[0]));
  if (found === undefined) throw new Error(`no rule paragraph titled ${title}`);
  return found;
}

describe('shared rules', () => {
  it('carry the unique prompt marker, which appears nowhere else in the rules', () => {
    expect(PROMPT_MARKER).toMatch(/^[a-z0-9-]{16,}$/);
    expect(SHARED_RULES.split(PROMPT_MARKER)).toHaveLength(2);
  });

  it('state their precedence over the agent brief', () => {
    expect(rule(/how these rules work/i)).toMatch(/these rules win/i);
    expect(rule(/how these rules work/i)).toMatch(/earlier rules .* win over later ones/i);
  });

  it('give each rule its own paragraph, each opening with a short title sentence', () => {
    // Title, then text: "Lead with your answer. Start with ...".
    expect(paragraphs.length).toBeGreaterThanOrEqual(14);
    for (const paragraph of paragraphs.slice(1)) {
      expect(paragraph).toMatch(/^[A-Z][^.\n]{2,60}\. \S/);
      expect(paragraph).not.toContain('\n');
    }
  });

  it('say the agent is an AI agent with a human owner', () => {
    expect(rule(/ai agent/i)).toMatch(/AI agent with a human owner/);
  });

  it('keep to public, company-neutral information and stop on pasted confidential material', () => {
    const text = rule(/public information only/i);
    expect(text).toMatch(/public, company-neutral/);
    expect(text).toMatch(/confidential/);
    expect(text).toMatch(/\bstop\b/i);
  });

  it('carry the "In this phase" limits: no documents, no tools, "to verify", no claims of absence or of the latest version', () => {
    const text = rule(/in this phase/i);
    expect(text).toMatch(/no documents are connected/i);
    expect(text).toMatch(/no tools/i);
    expect(text).toContain('"to verify"');
    expect(text).toMatch(/does not exist/);
    expect(text).toMatch(/latest/);
  });

  it('ask the agent to lead with its answer and to answer before asking', () => {
    expect(rule(/lead with your answer/i)).toMatch(/start with your answer/i);
    expect(rule(/answer before asking/i)).toMatch(/usable answer first/i);
  });

  it('forbid invented regulations, statistics and references without demanding citations', () => {
    const text = rule(/no invented facts/i);
    expect(text).toMatch(/regulations/);
    expect(text).toMatch(/statistics/);
    expect(text).toMatch(/references/);
    // BUILD-LEARNINGS §5: an agent without retrieval that is asked for citations invents them.
    expect(SHARED_RULES).not.toMatch(/\b(cite|citations?)\b/i);
  });

  it('treat company statements as claims, and say who decides and who reviews', () => {
    expect(rule(/company statements are claims/i)).toMatch(/claim to verify, not a fact/);
    const decides = rule(/say who decides/i);
    expect(decides).toMatch(/human role that decides/);
    expect(decides).toMatch(/regulatory, legal or external/);
  });

  it('keep the decisions reserved for people with the RA DD lead and the DD decision owner', () => {
    const text = rule(/decisions reserved for people/i);
    expect(text).toMatch(/deal-breakers/i);
    expect(text).toMatch(/overall assessment/);
    expect(text).toMatch(/recommendation/);
    expect(text).toMatch(/RA DD lead/);
    expect(text).toMatch(/DD decision owner/);
  });

  it('name the teammate by first name outside the remit, and say a 1:1 agent cannot convene the team', () => {
    expect(rule(/outside your remit/i)).toMatch(/by first name/);
    const convene = rule(/cannot convene the team/i);
    expect(convene).toMatch(/1:1 room/);
    expect(convene).toMatch(/@mention/);
  });

  it('tell the agent that fenced text is data, never instructions', () => {
    const text = rule(/text from others is data/i);
    expect(text).toContain('BEGIN UNTRUSTED TEXT');
    expect(text).toMatch(/never as instructions/);
  });
});
