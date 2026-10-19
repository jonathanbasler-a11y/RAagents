import type { Finding, OpenQuestion } from '@/shared/contracts';

// Findings and open questions for the component tests.

export function finding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    workspaceId: 'demo',
    claim: `Claim of ${id}`,
    quote: `Quote of ${id} that is long enough to count.`,
    documentId: 'DR-01',
    documentTitle: 'Licensor overview',
    sourceType: 'company-disclosure',
    basis: 'attributed',
    publishedAt: '2026-07-14',
    asOf: '2026-10-12',
    confidence: 'medium',
    confidenceReason: 'Explicit.',
    assumptions: [],
    owner: 'Regulatory lead',
    status: 'draft',
    draftedBy: { agentId: 'reglead', agentName: 'Rosa', agentVersion: '1', model: 'm', promptHash: 'h', turnId: 't1' },
    createdAt: '2026-10-12T08:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    ...overrides,
  };
}

export function question(id: string, overrides: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id,
    workspaceId: 'demo',
    claim: `Question ${id}`,
    reasonCode: 'quote_not_in_document',
    reason: 'The quote is not in the document.',
    documentId: 'DR-01',
    raisedBy: { agentId: 'reglead', agentName: 'Rosa', turnId: 't1' },
    createdAt: '2026-10-12T08:00:00.000Z',
    ...overrides,
  };
}
