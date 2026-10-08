// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi } from '@/client/chat-client';
import type { HealthReport, HealthResponse } from '@/shared/contracts';
import { StatusPanel } from './StatusPanel';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

const REPORT: HealthReport = {
  status: 'ok',
  checks: { database: 'ok', agents: 'ok', llm: 'ok' },
  agentCount: 25,
  llm: { configured: true, missing: [], message: null },
  startedAt: '2026-10-07T08:00:00.000Z',
};

function client(result: ApiResult<HealthResponse> | Promise<ApiResult<HealthResponse>>) {
  return { getHealth: vi.fn<ChatApi['getHealth']>(() => Promise.resolve(result)) };
}

describe('StatusPanel', () => {
  it('says it is checking until the health report arrives', () => {
    render(<StatusPanel client={{ getHealth: vi.fn<ChatApi['getHealth']>(() => new Promise(() => undefined)) }} />);

    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('shows each check from GET /api/health', async () => {
    render(<StatusPanel client={client(ok<HealthResponse>(REPORT))} />);

    expect(await screen.findByText('All checks pass')).toBeInTheDocument();
    expect(screen.getByText('25 agents loaded')).toBeInTheDocument();
    expect(screen.getByText('Model connection')).toBeInTheDocument();
    expect(screen.getByText('Set up')).toBeInTheDocument();
  });

  it('names the missing variables when the model connection is not set up', async () => {
    const report: HealthReport = {
      ...REPORT,
      status: 'degraded',
      checks: { ...REPORT.checks, llm: 'not_configured' },
      llm: { configured: false, missing: ['LLM_BASE_URL', 'LLM_API_KEY'], message: 'Set the model variables.' },
    };
    render(<StatusPanel client={client(ok<HealthResponse>(report))} />);

    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    expect(screen.getByText('LLM_BASE_URL')).toBeInTheDocument();
    expect(screen.getByText('LLM_API_KEY')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('says the gateway refused the connection, and how to fix it, when health reports the model route refused', async () => {
    const message = 'The model gateway refused the key. Fix LLM_API_KEY, then restart the server.';
    const report: HealthReport = {
      ...REPORT,
      status: 'degraded',
      checks: { ...REPORT.checks, llm: 'error' },
      llm: { configured: false, missing: [], message },
    };
    render(<StatusPanel client={client(ok<HealthResponse>(report))} />);

    expect(await screen.findByText('Refused by the model gateway')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Set up')).not.toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('says so while the API only has its stub', async () => {
    render(<StatusPanel client={client(ok<HealthResponse>({ status: 'stub' }))} />);

    expect(await screen.findByText('Status checks are not available yet.')).toBeInTheDocument();
  });

  it('shows a failed check as unknown, with a retry', async () => {
    const user = userEvent.setup();
    const getHealth = vi
      .fn<ChatApi['getHealth']>()
      .mockResolvedValueOnce({ ok: false, status: 0, error: null, message: 'Could not reach the server.' })
      .mockResolvedValueOnce(ok<HealthResponse>(REPORT));
    render(<StatusPanel client={{ getHealth }} />);

    expect(await screen.findByText(/Could not check the status/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('All checks pass')).toBeInTheDocument();
  });
});
