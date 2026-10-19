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
import type { Finding, FindingDecisionRequest, FindingsResponse, OpenQuestion } from '@/shared/contracts';
import { chatClient, type ApiResult, type ChatApi } from '@/client/chat-client';

export type FindingsClient = Pick<ChatApi, 'getFindings' | 'submitFindingDecision'>;

export interface FindingsProblem {
  message: string;
  correlationId: string | null;
}

export interface FindingsState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as "no findings". */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** undefined: not known yet. [] : the register is empty. */
  findings: Finding[] | undefined;
  openQuestions: OpenQuestion[] | undefined;
  /** The finding a decision is being saved for. One decision at a time. */
  deciding: string | null;
  /** The last decision that was not saved, with the finding it was for. */
  decideError: (FindingsProblem & { findingId: string }) | null;
  loadError: FindingsProblem | null;
  /** Answers whether the decision was saved. Ignored (false) while another is being saved. */
  decide(findingId: string, decision: FindingDecisionRequest['decision'], note?: string): Promise<boolean>;
  /** Reads the register again without showing "loading"; a failed read changes nothing. */
  refresh(): Promise<void>;
  reload(): void;
}

const UNAVAILABLE: FindingsState = {
  status: 'unavailable',
  findings: undefined,
  openQuestions: undefined,
  deciding: null,
  decideError: null,
  loadError: null,
  decide: async () => false,
  refresh: async () => undefined,
  reload: () => undefined,
};

const FindingsContext = createContext<FindingsState>(UNAVAILABLE);

export function useFindings(): FindingsState {
  return useContext(FindingsContext);
}

const problemOf = (result: Extract<ApiResult<unknown>, { ok: false }>): FindingsProblem => ({
  message: result.message,
  correlationId: result.error?.correlationId ?? null,
});

/** The workspace's findings register: drafts, decided findings and open questions, shared by the findings page, the home page and the 1:1 rooms. */
export function FindingsProvider({ children, client = chatClient }: { children: ReactNode; client?: FindingsClient }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [findings, setFindings] = useState<Finding[] | undefined>(undefined);
  const [openQuestions, setOpenQuestions] = useState<OpenQuestion[] | undefined>(undefined);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<FindingsState['decideError']>(null);
  const [loadError, setLoadError] = useState<FindingsProblem | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const decidingNow = useRef(false);
  /** Counts every change a decision handed us, so a read that started before one can tell it was overtaken. */
  const writes = useRef(0);

  const apply = useCallback((data: FindingsResponse) => {
    setFindings(data.findings);
    setOpenQuestions(data.openQuestions);
    setLoadError(null);
    setStatus('ready');
  }, []);

  const fetchRegister = useEffectEvent(() => client.getFindings());

  useEffect(() => {
    let cancelled = false;
    fetchRegister().then((result) => {
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
    const result = await client.getFindings();
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

  const decide = useCallback(
    async (findingId: string, decision: FindingDecisionRequest['decision'], note?: string): Promise<boolean> => {
      if (decidingNow.current) return false;
      decidingNow.current = true;
      setDeciding(findingId);
      setDecideError(null);
      try {
        const result = await client.submitFindingDecision(findingId, decision, note);
        if (!result.ok) {
          setDecideError({ ...problemOf(result), findingId });
          // Someone else decided it, or its document was withdrawn: show what is saved, not what was on screen.
          if (result.status === 409 || result.status === 404) void refresh();
          return false;
        }
        writes.current += 1;
        const saved = result.data.finding;
        setFindings((current) => current?.map((finding) => (finding.id === saved.id ? saved : finding)));
        return true;
      } finally {
        decidingNow.current = false;
        setDeciding(null);
      }
    },
    [client, refresh],
  );

  const value = useMemo<FindingsState>(
    () => ({ status, findings, openQuestions, deciding, decideError, loadError, decide, refresh, reload }),
    [status, findings, openQuestions, deciding, decideError, loadError, decide, refresh, reload],
  );

  return <FindingsContext.Provider value={value}>{children}</FindingsContext.Provider>;
}
