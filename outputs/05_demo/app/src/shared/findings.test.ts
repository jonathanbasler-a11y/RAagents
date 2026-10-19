import { describe, expect, it } from 'vitest';
import type { DocumentSourceType } from './contracts';
import {
  MAX_CLAIM_CHARS,
  MAX_PROPOSED_PER_TURN,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  basisOf,
  checkProposal,
  checkProposedFinding,
  foldForMatch,
  parseProposalReply,
  quoteIsInDocument,
  type DocumentFacts,
  type ProposalContext,
} from './findings';

const AS_OF = '2026-10-12';
const TEXT_01 = 'The agency has agreed that one adequate and well-controlled pivotal study is sufficient for approval.\n\nA paediatric plan has been agreed.';
const TEXT_02 = 'A single study “may be sufficient if it is supported by confirmatory evidence” – the agency did not agree.';

function facts(overrides: Partial<DocumentFacts> = {}): DocumentFacts {
  return { sourceType: 'company-disclosure', title: 'Licensor overview', publishedAt: '2026-07-14', withdrawn: false, texts: [TEXT_01], ...overrides };
}

function context(overrides: Partial<ProposalContext> = {}): ProposalContext {
  return {
    asOf: AS_OF,
    documents: new Map([
      ['DR-01', facts()],
      ['DR-02', facts({ sourceType: 'agency-record', title: 'Agency minutes', publishedAt: '2026-03-20', texts: [TEXT_02] })],
    ]),
    shownIds: new Set(['DR-01', 'DR-02']),
    ...overrides,
  };
}

const good = {
  claim: 'The licensor says the agency agreed a single pivotal study is enough.',
  documentId: 'DR-01',
  quote: 'one adequate and well-controlled pivotal study is sufficient for approval',
  confidence: 'medium',
  confidenceReason: 'The sentence is explicit, but it is the seller’s own account.',
  assumptions: ['The overview is the licensor’s current position.'],
};

const refusal = (raw: unknown, ctx: ProposalContext = context()) => {
  const result = checkProposedFinding(raw, ctx);
  if (result.ok) throw new Error('expected a refusal');
  return result;
};

describe('foldForMatch', () => {
  it('makes quote marks, dashes, spaces and line breaks the same', () => {
    expect(foldForMatch('A “quote” – it’s here\n\n  now')).toBe('A "quote" - it\'s here now');
    expect(foldForMatch('x — y − z')).toBe('x - y - z');
    expect(foldForMatch('‘single’')).toBe("'single'");
  });

  it('keeps case and the words themselves', () => {
    expect(foldForMatch('  Mixed Case  ')).toBe('Mixed Case');
  });

  it('puts accents in one form', () => {
    expect(foldForMatch('café')).toBe(foldForMatch('café'));
  });
});

describe('quoteIsInDocument', () => {
  it('finds a quote across a line break and in curly quotes', () => {
    expect(quoteIsInDocument('sufficient for approval. A paediatric plan', [TEXT_01])).toBe(true);
    expect(quoteIsInDocument('"may be sufficient if it is supported by confirmatory evidence" - the agency', [TEXT_02])).toBe(true);
  });

  it('does not find a changed word, a different case or a reordered phrase', () => {
    expect(quoteIsInDocument('one adequate and well-controlled pivotal study is necessary for approval', [TEXT_01])).toBe(false);
    expect(quoteIsInDocument('ONE ADEQUATE AND WELL-CONTROLLED PIVOTAL STUDY', [TEXT_01])).toBe(false);
    expect(quoteIsInDocument('sufficient for approval is one adequate', [TEXT_01])).toBe(false);
  });

  it('finds it in any of the texts it is given (the original or the one the model saw)', () => {
    expect(quoteIsInDocument('only the second text has this phrase', ['nothing here', 'and only the second text has this phrase indeed'])).toBe(true);
  });

  it('finds nothing in no text', () => {
    expect(quoteIsInDocument('anything at all here', [])).toBe(false);
  });
});

describe('basisOf', () => {
  it.each([
    ['company-disclosure', 'attributed'],
    ['agency-record', 'primary-record'],
    ['registry', 'primary-record'],
    ['publication', 'primary-record'],
  ] as const)('%s gives %s', (sourceType, basis) => {
    expect(basisOf(sourceType as DocumentSourceType)).toBe(basis);
  });
});

describe('parseProposalReply', () => {
  const body = { findings: [good], unsupported: [{ claim: 'The study is positive.', reason: 'No document says so.' }] };

  it('reads a fenced json block after a sentence', () => {
    const result = parseProposalReply(`I propose one finding.\n\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\`\n`);

    expect(result).toEqual({ ok: true, findings: [good], unsupported: body.unsupported });
  });

  it('reads plain json, and json with prose around it', () => {
    expect(parseProposalReply(JSON.stringify(body))).toMatchObject({ ok: true });
    expect(parseProposalReply(`Here you go: ${JSON.stringify(body)} Anything else?`)).toMatchObject({ ok: true });
  });

  it('reads a bare list as the findings', () => {
    expect(parseProposalReply(JSON.stringify([good]))).toEqual({ ok: true, findings: [good], unsupported: [] });
  });

  it('accepts none proposed', () => {
    expect(parseProposalReply('{"findings": [], "unsupported": []}')).toEqual({ ok: true, findings: [], unsupported: [] });
    expect(parseProposalReply('{"findings": []}')).toEqual({ ok: true, findings: [], unsupported: [] });
  });

  it.each([
    ['no json at all', 'I could not find anything to propose.'],
    ['broken json', '{"findings": [ {"claim": '],
    ['json without findings', '{"unsupported": []}'],
    ['findings that is not a list', '{"findings": "none"}'],
    ['unsupported that is not a list', '{"findings": [], "unsupported": 3}'],
    ['a number', '42'],
    ['nothing', ''],
  ])('says it cannot read %s', (_label, text) => {
    const result = parseProposalReply(text);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/findings/i);
  });
});

describe('checkProposedFinding: what becomes a finding', () => {
  it('accepts a claim with a verbatim quote from a document the agent was shown, and works out the rest', () => {
    const result = checkProposedFinding(good, context());

    expect(result).toEqual({
      ok: true,
      finding: {
        claim: good.claim,
        quote: good.quote,
        documentId: 'DR-01',
        documentTitle: 'Licensor overview',
        sourceType: 'company-disclosure',
        basis: 'attributed',
        publishedAt: '2026-07-14',
        confidence: 'medium',
        confidenceReason: good.confidenceReason,
        assumptions: good.assumptions,
      },
    });
  });

  it('gives an agency record a primary-record basis, whatever the agent says', () => {
    const result = checkProposedFinding(
      { ...good, documentId: 'DR-02', quote: 'may be sufficient if it is supported by confirmatory evidence', basis: 'attributed' },
      context(),
    );

    expect(result.ok && result.finding.basis).toBe('primary-record');
  });

  it('ignores fields it does not know, including a status or a basis the agent tries to set', () => {
    const result = checkProposedFinding({ ...good, status: 'accepted', basis: 'primary-record', decidedBy: 'x', id: 'F-099' }, context());

    expect(result.ok).toBe(true);
    expect(result.ok && result.finding).not.toHaveProperty('status');
    expect(result.ok && result.finding.basis).toBe('attributed');
    expect(result.ok && result.finding).not.toHaveProperty('id');
  });

  it('trims the claim, the quote and the reasons, and strips quotation marks the agent put around the quote', () => {
    const result = checkProposedFinding({ ...good, claim: `  ${good.claim}  `, quote: `  “${good.quote}”  `, confidenceReason: `  ${good.confidenceReason} ` }, context());

    expect(result.ok && result.finding.claim).toBe(good.claim);
    expect(result.ok && result.finding.quote).toBe(good.quote);
    expect(result.ok && result.finding.confidenceReason).toBe(good.confidenceReason);
  });

  it('takes no assumptions as an empty list', () => {
    const { assumptions: _assumptions, ...without } = good;

    expect(checkProposedFinding(without, context())).toMatchObject({ ok: true, finding: { assumptions: [] } });
  });

  it('accepts a quote that is in the second text it was given', () => {
    const ctx = context({ documents: new Map([['DR-01', facts({ texts: ['unrelated text entirely', TEXT_01] })]]) });

    expect(checkProposedFinding(good, ctx).ok).toBe(true);
  });
});

describe('checkProposedFinding: what is refused, and why', () => {
  it.each([
    ['null', null, 'not_an_object'],
    ['a list', [], 'not_an_object'],
    ['text', 'a claim', 'not_an_object'],
  ])('refuses %s', (_label, raw, code) => {
    expect(refusal(raw).code).toBe(code);
  });

  it.each([
    ['no claim', { ...good, claim: undefined }, 'claim_missing'],
    ['an empty claim', { ...good, claim: '   ' }, 'claim_missing'],
    ['a claim that is not text', { ...good, claim: 5 }, 'claim_missing'],
    ['a claim over the limit', { ...good, claim: 'x'.repeat(MAX_CLAIM_CHARS + 1) }, 'claim_too_long'],
    ['no document', { ...good, documentId: undefined }, 'document_missing'],
    ['an empty document id', { ...good, documentId: ' ' }, 'document_missing'],
    ['a document that is not in the room', { ...good, documentId: 'DR-77' }, 'document_unknown'],
    ['no quote', { ...good, quote: undefined }, 'quote_missing'],
    ['an empty quote', { ...good, quote: '  ' }, 'quote_missing'],
    ['a quote that is not text', { ...good, quote: 7 }, 'quote_missing'],
    ['a quote that is too short', { ...good, quote: 'x'.repeat(MIN_QUOTE_CHARS - 1) }, 'quote_too_short'],
    ['a quote over the limit', { ...good, quote: 'a'.repeat(MAX_QUOTE_CHARS + 1) }, 'quote_too_long'],
    ['a quote that is not in the document', { ...good, quote: 'the agency has refused a single study outright' }, 'quote_not_in_document'],
    ['a quote from another document', { ...good, quote: 'may be sufficient if it is supported by confirmatory evidence' }, 'quote_not_in_document'],
    ['an unknown confidence', { ...good, confidence: 'certain' }, 'confidence_invalid'],
    ['no confidence', { ...good, confidence: undefined }, 'confidence_invalid'],
    ['no reason for the confidence', { ...good, confidenceReason: ' ' }, 'confidence_reason_missing'],
    ['a reason that is too long', { ...good, confidenceReason: 'x'.repeat(301) }, 'confidence_reason_missing'],
    ['assumptions that are not a list', { ...good, assumptions: 'none' }, 'assumptions_invalid'],
    ['an assumption that is not text', { ...good, assumptions: [3] }, 'assumptions_invalid'],
    ['an empty assumption', { ...good, assumptions: [' '] }, 'assumptions_invalid'],
    ['an assumption that is too long', { ...good, assumptions: ['x'.repeat(201)] }, 'assumptions_invalid'],
    ['six assumptions', { ...good, assumptions: ['a1 x', 'b2 x', 'c3 x', 'd4 x', 'e5 x', 'f6 x'] }, 'assumptions_invalid'],
  ])('refuses %s with %s', (_label, raw, code) => {
    const result = refusal(raw);

    expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('says in words that the quote is not in the document, and names the document', () => {
    expect(refusal({ ...good, quote: 'the agency has refused a single study outright' }).message).toMatch(/DR-01/);
  });

  it('accepts the limits exactly (positive control)', () => {
    expect(checkProposedFinding({ ...good, claim: 'x'.repeat(MAX_CLAIM_CHARS), confidenceReason: 'y'.repeat(300), assumptions: ['a'.repeat(200), 'b b', 'c c', 'd d', 'e e'] }, context()).ok).toBe(true);
    expect(checkProposedFinding({ ...good, quote: 'sufficient for approval' }, context()).ok).toBe(true);
  });

  it('refuses a quote shorter than the minimum even if it is in the document', () => {
    const result = refusal({ ...good, quote: 'agreed' });

    expect(result.code).toBe('quote_too_short');
  });

  describe('the document', () => {
    it('refuses one that was in the room but not shown to the agent in that turn', () => {
      const ctx = context({ shownIds: new Set(['DR-02']) });

      expect(refusal(good, ctx).code).toBe('document_not_shown');
    });

    it('refuses a withdrawn document, even one that was shown', () => {
      const ctx = context({ documents: new Map([['DR-01', facts({ withdrawn: true })]]) });

      expect(refusal(good, ctx).code).toBe('document_withdrawn');
    });

    it('refuses a document dated after the as-of date, and one with no date', () => {
      expect(refusal(good, context({ documents: new Map([['DR-01', facts({ publishedAt: '2026-10-13' })]]) })).code).toBe('document_after_as_of');
      expect(refusal(good, context({ documents: new Map([['DR-01', facts({ publishedAt: null })]]) })).code).toBe('document_after_as_of');
    });

    it('accepts a document dated on the as-of date (positive control)', () => {
      expect(checkProposedFinding(good, context({ documents: new Map([['DR-01', facts({ publishedAt: AS_OF })]]) })).ok).toBe(true);
    });

    it('reports a withdrawn document as withdrawn even if it was also not shown', () => {
      const ctx = context({ documents: new Map([['DR-01', facts({ withdrawn: true })]]), shownIds: new Set() });

      expect(refusal(good, ctx).code).toBe('document_withdrawn');
    });

    it('reports an unknown document before anything about its quote', () => {
      expect(refusal({ ...good, documentId: 'DR-77', quote: 'nonsense that is nowhere at all' }).code).toBe('document_unknown');
    });
  });
});

describe('checkProposal', () => {
  const reply = (findings: unknown[], unsupported: unknown[] = []) => `One finding.\n\n\`\`\`json\n${JSON.stringify({ findings, unsupported })}\n\`\`\``;

  it('sorts the claims into findings and refusals, keeping each refusal’s claim and reason', () => {
    const bad = { ...good, claim: 'The agency refused outright.', quote: 'the agency has refused a single study outright' };

    const result = checkProposal(reply([good, bad]), context());

    expect(result.parseError).toBeNull();
    expect(result.checked.map((entry) => entry.claim)).toEqual([good.claim]);
    expect(result.refused).toEqual([
      { claim: 'The agency refused outright.', code: 'quote_not_in_document', message: expect.stringContaining('DR-01'), documentId: 'DR-01' },
    ]);
  });

  it('turns what the agent itself says it cannot support into refusals of its own kind', () => {
    const result = checkProposal(reply([], [{ claim: 'The study is positive.', reason: 'No document says so.' }]), context());

    expect(result.refused).toEqual([{ claim: 'The study is positive.', code: 'declared_unsupported', message: 'No document says so.', documentId: null }]);
  });

  it('skips an unsupported entry with no claim', () => {
    const result = checkProposal(reply([], [{ reason: 'x' }, 'text', null, { claim: '  ', reason: 'y' }]), context());

    expect(result.refused).toEqual([]);
  });

  it('keeps the first eight and refuses the rest as too many', () => {
    const many = Array.from({ length: MAX_PROPOSED_PER_TURN + 2 }, (_value, index) => ({ ...good, claim: `Claim ${index + 1}` }));

    const result = checkProposal(reply(many), context());

    expect(result.checked).toHaveLength(MAX_PROPOSED_PER_TURN);
    expect(result.refused.map((entry) => [entry.claim, entry.code])).toEqual([
      ['Claim 9', 'too_many'],
      ['Claim 10', 'too_many'],
    ]);
  });

  it('counts the claims that are refused against the limit too', () => {
    const items = [...Array.from({ length: MAX_PROPOSED_PER_TURN }, () => ({ ...good, quote: 'a made up sentence that is nowhere' })), good];

    const result = checkProposal(reply(items), context());

    expect(result.checked).toEqual([]);
    expect(result.refused.at(-1)?.code).toBe('too_many');
  });

  it('says it could not read a reply that is not a proposal, and proposes nothing', () => {
    const result = checkProposal('I do not have anything to propose.', context());

    expect(result.checked).toEqual([]);
    expect(result.refused).toEqual([]);
    expect(result.parseError).toMatch(/findings/i);
  });

  it('does not let one broken entry stop the others', () => {
    const result = checkProposal(reply([null, good, 'text']), context());

    expect(result.checked).toHaveLength(1);
    expect(result.refused.map((entry) => entry.code)).toEqual(['not_an_object', 'not_an_object']);
  });
});
