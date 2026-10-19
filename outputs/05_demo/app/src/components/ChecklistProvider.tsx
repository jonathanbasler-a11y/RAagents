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
import type { ChecklistItemId, ChecklistResponse, ChecklistState } from '@/shared/contracts';
import { chatClient, type ApiResult, type ChatApi } from '@/client/chat-client';

export type ChecklistClient = Pick<ChatApi, 'getChecklist' | 'submitChecklistState'>;

export type ChecklistItemView = ChecklistResponse['items'][number];

export interface ChecklistProblem {
  message: string;
  correlationId: string | null;
}

export interface ChecklistContextState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as "not checked". */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** undefined: not known yet. */
  items: ChecklistItemView[] | undefined;
  /** The item a change is being saved for. One change at a time. */
  saving: ChecklistItemId | null;
  /** The last change that was not saved, with the item it was for. */
  saveError: (ChecklistProblem & { item: ChecklistItemId }) | null;
  loadError: ChecklistProblem | null;
  /** Answers whether the change was saved. Ignored (false) while another is being saved. */
  set(item: ChecklistItemId, state: ChecklistState, reason?: string): Promise<boolean>;
  /** Reads the checklist again without showing "loading"; a failed read changes nothing. */
  refresh(): Promise<void>;
  reload(): void;
}

const UNAVAILABLE: ChecklistContextState = {
  status: 'unavailable',
  items: undefined,
  saving: null,
  saveError: null,
  loadError: null,
  set: async () => false,
  refresh: async () => undefined,
  reload: () => undefined,
};

const ChecklistContext = createContext<ChecklistContextState>(UNAVAILABLE);

export function useChecklist(): ChecklistContextState {
  return useContext(ChecklistContext);
}

const problemOf = (result: Extract<ApiResult<unknown>, { ok: false }>): ChecklistProblem => ({
  message: result.message,
  correlationId: result.error?.correlationId ?? null,
});

/** The workspace's regulatory checklist, shared by the checklist page and the home page. */
export function ChecklistProvider({ children, client = chatClient }: { children: ReactNode; client?: ChecklistClient }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<ChecklistItemView[] | undefined>(undefined);
  const [saving, setSaving] = useState<ChecklistItemId | null>(null);
  const [saveError, setSaveError] = useState<ChecklistContextState['saveError']>(null);
  const [loadError, setLoadError] = useState<ChecklistProblem | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const savingNow = useRef(false);
  /** Counts every change a save handed us, so a read that started before one can tell it was overtaken. */
  const writes = useRef(0);

  const apply = useCallback((data: ChecklistResponse) => {
    setItems(data.items);
    setLoadError(null);
    setStatus('ready');
  }, []);

  const fetchChecklist = useEffectEvent(() => client.getChecklist());

  useEffect(() => {
    let cancelled = false;
    fetchChecklist().then((result) => {
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
    const result = await client.getChecklist();
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

  const set = useCallback(
    async (item: ChecklistItemId, state: ChecklistState, reason?: string): Promise<boolean> => {
      if (savingNow.current) return false;
      savingNow.current = true;
      setSaving(item);
      setSaveError(null);
      try {
        const result = await client.submitChecklistState(item, state, reason);
        if (!result.ok) {
          setSaveError({ ...problemOf(result), item });
          // A 409 means the accepted findings behind the item are not what the screen showed: read what is saved.
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
    [client, apply, refresh],
  );

  const value = useMemo<ChecklistContextState>(
    () => ({ status, items, saving, saveError, loadError, set, refresh, reload }),
    [status, items, saving, saveError, loadError, set, refresh, reload],
  );

  return <ChecklistContext.Provider value={value}>{children}</ChecklistContext.Provider>;
}
