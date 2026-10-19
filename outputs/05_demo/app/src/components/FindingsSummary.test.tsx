// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { FindingsResponse } from '@/shared/contracts';
import { finding, question } from './findings-fixtures';
import { FindingsProvider } from './FindingsProvider';
import { FindingsSummary } from './FindingsSummary';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function renderSummary(result: ApiResult<FindingsResponse> | Promise<ApiResult<FindingsResponse>>) {
  const client = {
    getFindings: vi.fn<ChatApi['getFindings']>().mockImplementation(() => Promise.resolve(result)),
    submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
  };
  return render(
    <FindingsProvider client={client}>
      <FindingsSummary />
    </FindingsProvider>,
  );
}

const register = (findings: FindingsResponse['findings'], openQuestions: FindingsResponse['openQuestions'] = []): FindingsResponse => ({
  workspaceId: 'demo',
  findings,
  openQuestions,
});

describe('FindingsSummary', () => {
  it('renders nothing without a provider', () => {
    const { container } = render(<FindingsSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not say "no findings" while it is still loading', () => {
    renderSummary(new Promise(() => undefined));

    expect(screen.getByText('Loading the findings…')).toBeInTheDocument();
    expect(screen.queryByText(/No findings yet/)).not.toBeInTheDocument();
  });

  it('says it could not load, not that there are none', async () => {
    renderSummary({ ok: false, status: 0, error: null, message: 'down' });

    expect(await screen.findByText('The findings could not be loaded.')).toBeInTheDocument();
  });

  it('explains how findings come to be when the register is empty', async () => {
    renderSummary(ok(register([])));

    expect(await screen.findByText(/No findings yet\. An agent drafts them from the data room.*a person accepts or rejects each one\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the findings' })).toHaveAttribute('href', '/findings');
  });

  it('counts the drafts waiting for a person, the decided findings and the open questions', async () => {
    renderSummary(
      ok(
        register(
          [finding('F-001'), finding('F-002'), finding('F-003', { status: 'rejected', decidedBy: 'x', decidedAt: '2026-10-12T09:00:00.000Z' })],
          [question('Q-001')],
        ),
      ),
    );

    expect(await screen.findByText('2 drafts waiting for a person, 1 decided, 1 open question.')).toBeInTheDocument();
  });
});
