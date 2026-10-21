'use client';

import type { PublicAgent } from '@/shared/contracts';
import { useAgentSwitch } from './use-agent-switch';

/**
 * "Selected for this DD" for one agent. Locked team roles show "Always on". While the
 * saved selection is unknown, no switch is shown: unknown is never shown as off. A switch
 * waits while the DD setup is being saved, because that save rewrites the selection.
 */
export function SelectionSwitch({ agent }: { agent: PublicAgent }) {
  const control = useAgentSwitch(agent);

  switch (control.kind) {
    case 'hidden':
      return null;

    case 'locked':
      return (
        <button
          type="button"
          role="switch"
          aria-checked="true"
          aria-disabled="true"
          className="switch"
          aria-label={`${agent.name}: always on for this DD`}
        >
          <span className="track" aria-hidden="true" />
          Always on
        </button>
      );

    case 'failed':
      return (
        <span className="switch-unknown">
          Selection unavailable.{' '}
          <button type="button" className="btn btn-quiet btn-sm" onClick={control.reload}>
            Retry
          </button>
        </span>
      );

    case 'loading':
      return (
        <span className="switch-unknown" aria-busy="true">
          Loading selection…
        </span>
      );

    case 'ready':
      return (
        <span className="switch-wrap">
          <button
            type="button"
            role="switch"
            aria-checked={control.on}
            aria-busy={control.saving}
            disabled={control.disabled}
            className="switch"
            aria-label={`${agent.name}: selected for this DD`}
            onClick={() => control.set(!control.on)}
          >
            <span className="track" aria-hidden="true" />
            Selected for this DD
          </button>
          {control.problem && (
            <span className="switch-error" role="alert">
              Not saved: {control.problem.message}
              {control.problem.correlationId && <span className="mono"> Reference {control.problem.correlationId}</span>}
            </span>
          )}
        </span>
      );
  }
}
