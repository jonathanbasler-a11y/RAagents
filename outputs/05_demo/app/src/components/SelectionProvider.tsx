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
import type { AgentId } from '@/shared/contracts';
import { chatClient, type ChatApi } from '@/client/chat-client';

export type SelectionClient = Pick<ChatApi, 'getSelection' | 'setSelection'>;

export interface SelectionProblem {
  message: string;
  correlationId: string | null;
}

export interface SelectionState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as "off". */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** The saved selection (GET /api/selection), or null while unknown. */
  selected: ReadonlySet<AgentId> | null;
  /** Switches whose change is being saved. */
  saving: ReadonlySet<AgentId>;
  saveErrors: Readonly<Record<AgentId, SelectionProblem>>;
  loadError: SelectionProblem | null;
  /** Flips one switch through POST /api/selection; the reply is the new saved state. */
  setSelected(agentId: AgentId, selected: boolean): Promise<void>;
  reload(): void;
}

const NOTHING: ReadonlySet<AgentId> = new Set();

const UNAVAILABLE: SelectionState = {
  status: 'unavailable',
  selected: null,
  saving: NOTHING,
  saveErrors: {},
  loadError: null,
  setSelected: async () => undefined,
  reload: () => undefined,
};

const SelectionContext = createContext<SelectionState>(UNAVAILABLE);

export function useSelection(): SelectionState {
  return useContext(SelectionContext);
}

/** "Selected for this DD", shared by the rail, the team page and the team chat's chips. */
export function SelectionProvider({ children, client = chatClient }: { children: ReactNode; client?: SelectionClient }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelectedIds] = useState<ReadonlySet<AgentId> | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<AgentId>>(NOTHING);
  const [saveErrors, setSaveErrors] = useState<Record<AgentId, SelectionProblem>>({});
  const [loadError, setLoadError] = useState<SelectionProblem | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const savingNow = useRef(new Set<AgentId>());

  const fetchSelection = useEffectEvent(() => client.getSelection());

  useEffect(() => {
    let cancelled = false;
    fetchSelection().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSelectedIds(new Set(result.data.selected));
        setLoadError(null);
        setStatus('ready');
      } else {
        setLoadError({ message: result.message, correlationId: result.error?.correlationId ?? null });
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  const reload = useCallback(() => {
    setStatus('loading');
    setLoadRequest((count) => count + 1);
  }, []);

  const setSelected = useCallback(
    async (agentId: AgentId, on: boolean) => {
      if (savingNow.current.has(agentId)) return;
      savingNow.current.add(agentId);
      setSaving(new Set(savingNow.current));
      setSaveErrors((current) => {
        const next = { ...current };
        delete next[agentId];
        return next;
      });
      try {
        const result = await client.setSelection(agentId, on);
        if (result.ok) {
          setSelectedIds(new Set(result.data.selected));
        } else {
          setSaveErrors((current) => ({
            ...current,
            [agentId]: { message: result.message, correlationId: result.error?.correlationId ?? null },
          }));
        }
      } finally {
        savingNow.current.delete(agentId);
        setSaving(new Set(savingNow.current));
      }
    },
    [client],
  );

  const value = useMemo<SelectionState>(
    () => ({ status, selected, saving, saveErrors, loadError, setSelected, reload }),
    [status, selected, saving, saveErrors, loadError, setSelected, reload],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
