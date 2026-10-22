'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { GateDecisionRequest, GateDissentRequest, GateId, GatesResponse } from '@/shared/contracts';
import { chatClient, type ApiResult, type ChatApi } from '@/client/chat-client';

export type GatesClient = Pick<ChatApi, 'getGates' | 'submitGateDecision' | 'submitGateDissent'>;

export interface GatesProblem {
  message: string;
  correlationId: string | null;
}

export interface GatesContextState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as "not decided". */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** undefined: not known yet. */
  data: GatesResponse | undefined;
  /** The gate and kind of the write in progress. One write at a time. */
  saving: { gate: GateId; kind: 'decision' | 'dissent' } | null;
  /** The last write that was not saved, with the gate and kind it was for. */
  saveError: (GatesProblem & { gate: GateId; kind: 'decision' | 'dissent'; decisionId?: string }) | null;
  loadError: GatesProblem | null;
  /** Answers whether the decision was saved. Ignored (false) while another write is in progress. */
  decide(gate: GateId, request: GateDecisionRequest): Promise<boolean>;
  /** Answers whether the dissent was saved. Ignored (false) while another write is in progress. */
  dissent(gate: GateId, request: GateDissentRequest): Promise<boolean>;
  /** Reads the gates again without showing "loading"; a failed read changes nothing. */
  refresh(): Promise<void>;
  reload(): void;
}

const UNAVAILABLE: GatesContextState = {
  status: 'unavailable',
  data: undefined,
  saving: null,
  saveError: null,
  loadError: null,
  decide: async () => false,
  dissent: async () => false,
  refresh: async () => undefined,
  reload: () => undefined,
};

const GatesContext = createContext<GatesContextState>(UNAVAILABLE);

export function useGates(): GatesContextState {
  return useContext(GatesContext);
}

const problemOf = (result: Extract<ApiResult<unknown>, { ok: false }>): GatesProblem => ({
  message: result.message,
  correlationId: result.error?.correlationId ?? null,
});

/** The workspace's gates, shared by the gates page and the home page. */
export function GatesProvider({ children, client = chatClient }: { children: ReactNode; client?: GatesClient }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<GatesResponse | undefined>(undefined);
  const [saving, setSaving] = useState<GatesContextState['saving']>(null);
  const [saveError, setSaveError] = useState<GatesContextState['saveError']>(null);
  const [loadError, setLoadError] = useState<GatesProblem | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const savingNow = useRef(false);
  /** Counts every state a save handed us, so a read that started before one can tell it was overtaken. */
  const writes = useRef(0);

  const apply = useCallback((next: GatesResponse) => {
    setData(next);
    setLoadError(null);
    setStatus('ready');
  }, []);

  const fetchGates = useEffectEvent(() => client.getGates());

  useEffect(() => {
    let cancelled = false;
    fetchGates().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        apply(result.data);
      } else {
        setLoadError(problemOf(result));
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadRequest, apply]);

  const refresh = useCallback(async (): Promise<void> => {
    const before = writes.current;
    const result = await client.getGates();
    if (!result.ok || writes.current !== before) return;
    apply(result.data);
  }, [client, apply]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  const reload = useCallback(() => {
    setStatus('loading');
    setLoadRequest((count) => count + 1);
  }, []);

  const write = useCallback(
    async (gate: GateId, kind: 'decision' | 'dissent', send: () => Promise<ApiResult<GatesResponse>>, decisionId?: string): Promise<boolean> => {
      if (savingNow.current) return false;
      savingNow.current = true;
      setSaving({ gate, kind });
      setSaveError(null);
      try {
        const result = await send();
        if (!result.ok) {
          setSaveError({ ...problemOf(result), gate, kind, ...(decisionId === undefined ? {} : { decisionId }) });
          // A 409 means the facts are not what the screen showed: read what is true now, and keep the message.
          if (result.status === 409) void refresh();
          return false;
        }
        writes.current += 1;
        apply(result.data);
        return true;
      } finally {
        savingNow.current = false;
        setSaving(null);
      }
    },
    [apply, refresh],
  );

  const decide = useCallback((gate: GateId, request: GateDecisionRequest) => write(gate, 'decision', () => client.submitGateDecision(gate, request)), [client, write]);
  const dissent = useCallback((gate: GateId, request: GateDissentRequest) => write(gate, 'dissent', () => client.submitGateDissent(gate, request), request.decisionId), [client, write]);

  const value = useMemo<GatesContextState>(
    () => ({ status, data, saving, saveError, loadError, decide, dissent, refresh, reload }),
    [status, data, saving, saveError, loadError, decide, dissent, refresh, reload],
  );

  return <GatesContext.Provider value={value}>{children}</GatesContext.Provider>;
}
