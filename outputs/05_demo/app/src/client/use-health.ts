'use client';

import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { HealthReport } from '@/shared/contracts';
import { chatClient, type ChatApi } from './chat-client';

export type HealthState =
  | { status: 'loading' }
  /** report is null while the API only has its contracts-phase stub. */
  | { status: 'ready'; report: HealthReport | null }
  | { status: 'error'; message: string };

/** GET /api/health once on mount, and again on refresh(). */
export function useHealth(client: Pick<ChatApi, 'getHealth'> = chatClient): { health: HealthState; refresh: () => void } {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [request, setRequest] = useState(0);
  const fetchHealth = useEffectEvent(() => client.getHealth());

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setHealth({ status: 'error', message: result.message });
        return;
      }
      const data = result.data;
      setHealth({ status: 'ready', report: 'llm' in data ? data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const refresh = useCallback(() => setRequest((count) => count + 1), []);
  return { health, refresh };
}

/** The model route cannot be used: the composer stays disabled and the setup banner shows. */
export function isSetupMissing(health: HealthState): boolean {
  return health.status === 'ready' && health.report !== null && !health.report.llm.configured;
}
