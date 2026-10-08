'use client';

import type { HealthCheckState, HealthReport, HealthStatus } from '@/shared/contracts';
import { chatClient, type ChatApi } from '@/client/chat-client';
import { useHealth } from '@/client/use-health';

const OVERALL: Record<HealthStatus, string> = {
  ok: 'All checks pass',
  degraded: 'Degraded',
  error: 'Error',
};

const CHECK: Record<HealthCheckState, string> = {
  ok: 'OK',
  error: 'Error',
  not_configured: 'Not set up',
};

function startedAtText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function HealthChecks({ report }: { report: HealthReport }) {
  return (
    <>
      <p className={`status-overall is-${report.status}`}>{OVERALL[report.status]}</p>
      <dl className="status-checks">
        <div>
          <dt>Model connection</dt>
          <dd>
            {report.checks.llm === 'error' ? 'Refused by the model gateway' : report.llm.configured ? 'Set up' : 'Not set up'}
            {report.checks.llm === 'error' && report.llm.message && <span className="status-detail"> {report.llm.message}</span>}
            {!report.llm.configured && report.llm.missing.length > 0 && (
              <span className="status-missing">
                {' '}
                Missing:{' '}
                {report.llm.missing.map((name, index) => (
                  <span key={name}>
                    {index > 0 && ', '}
                    <code>{name}</code>
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Agent specs</dt>
          <dd>{report.checks.agents === 'ok' ? `${report.agentCount} agents loaded` : CHECK[report.checks.agents]}</dd>
        </div>
        <div>
          <dt>Chat database</dt>
          <dd>{CHECK[report.checks.database]}</dd>
        </div>
        <div>
          <dt>Server running since</dt>
          <dd className="mono">{startedAtText(report.startedAt)}</dd>
        </div>
      </dl>
    </>
  );
}

/** The app's own status, from GET /api/health: names and states only, never values or hosts. */
export function StatusPanel({ client = chatClient }: { client?: Pick<ChatApi, 'getHealth'> }) {
  const { health, refresh } = useHealth(client);
  return (
    <section className="sheet status-panel" aria-labelledby="status-title" aria-live="polite">
      <h2 id="status-title">Status</h2>
      {health.status === 'loading' && (
        <p className="note" aria-busy="true">
          Checking…
        </p>
      )}
      {health.status === 'error' && (
        <p className="note">
          Could not check the status: {health.message}{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={refresh}>
            Check again
          </button>
        </p>
      )}
      {health.status === 'ready' && health.report === null && <p className="note">Status checks are not available yet.</p>}
      {health.status === 'ready' && health.report && <HealthChecks report={health.report} />}
    </section>
  );
}
