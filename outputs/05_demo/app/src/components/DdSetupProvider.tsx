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
import type { AgentId, DdSetup } from '@/shared/contracts';
import { chatClient, type ChatApi } from '@/client/chat-client';
import { useSelection } from './SelectionProvider';

export type DdSetupClient = Pick<ChatApi, 'getDdSetup' | 'setDdSetup'>;

export interface DdSetupProblem {
  message: string;
  correlationId: string | null;
}

/** Who joined and who left the team in one save, in the order the server lists them. */
export interface TeamChange {
  joined: readonly AgentId[];
  left: readonly AgentId[];
}

export interface DdSetupState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as the default. */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** The saved setup (GET /api/dd-setup), or null while unknown. */
  setup: DdSetup | null;
  /** default: nothing saved yet, the playbook default is shown. */
  source: 'default' | 'saved' | null;
  saving: boolean;
  saveError: DdSetupProblem | null;
  loadError: DdSetupProblem | null;
  /** The last save that went through. `team` is null when the team before it was not known. */
  lastSave: { team: TeamChange | null } | null;
  /** Saves the whole setup through POST /api/dd-setup; the team follows in the same save. */
  change(next: DdSetup): Promise<void>;
  reload(): void;
}

const UNAVAILABLE: DdSetupState = {
  status: 'unavailable',
  setup: null,
  source: null,
  saving: false,
  saveError: null,
  loadError: null,
  lastSave: null,
  change: async () => undefined,
  reload: () => undefined,
};

const DdSetupContext = createContext<DdSetupState>(UNAVAILABLE);

export function useDdSetup(): DdSetupState {
  return useContext(DdSetupContext);
}

function teamChange(before: ReadonlySet<AgentId>, after: readonly AgentId[]): TeamChange {
  const now = new Set(after);
  return {
    joined: after.filter((id) => !before.has(id)),
    left: [...before].filter((id) => !now.has(id)),
  };
}

/** The asset's stage and classification: what the team follows. Sits inside the SelectionProvider. */
export function DdSetupProvider({ children, client = chatClient }: { children: ReactNode; client?: DdSetupClient }) {
  const selection = useSelection();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [setup, setSetup] = useState<DdSetup | null>(null);
  const [source, setSource] = useState<'default' | 'saved' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DdSetupProblem | null>(null);
  const [loadError, setLoadError] = useState<DdSetupProblem | null>(null);
  const [lastSave, setLastSave] = useState<DdSetupState['lastSave']>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const savingNow = useRef(false);
  /** Counts every state a save handed us, so a read that started before one can tell it was overtaken. */
  const writes = useRef(0);

  const fetchSetup = useEffectEvent(() => client.getDdSetup());

  useEffect(() => {
    let cancelled = false;
    fetchSetup().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSetup(result.data.setup);
        setSource(result.data.source);
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

  /** Reads again without showing "loading". A failed read changes nothing: what is shown stays. */
  const refreshQuietly = useEffectEvent(async () => {
    const before = writes.current;
    const result = await client.getDdSetup();
    if (!result.ok || writes.current !== before) return;
    setSetup(result.data.setup);
    setSource(result.data.source);
    setLoadError(null);
    setStatus('ready');
  });

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshQuietly();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setLoadRequest((count) => count + 1);
  }, []);

  const { selected: selectedNow, saving: switchesSaving, adopt } = selection;
  const switchSaving = switchesSaving.size > 0;

  const change = useCallback(
    async (next: DdSetup) => {
      if (savingNow.current || switchSaving) return;
      savingNow.current = true;
      setSaving(true);
      setSaveError(null);
      setLastSave(null);
      try {
        const result = await client.setDdSetup(next);
        if (result.ok) {
          writes.current += 1;
          setSetup(result.data.setup);
          setSource(result.data.source);
          adopt(result.data.selection.selected);
          setLastSave({ team: selectedNow ? teamChange(selectedNow, result.data.selection.selected) : null });
        } else {
          setSaveError({ message: result.message, correlationId: result.error?.correlationId ?? null });
        }
      } finally {
        savingNow.current = false;
        setSaving(false);
      }
    },
    [client, adopt, selectedNow, switchSaving],
  );

  const value = useMemo<DdSetupState>(
    () => ({ status, setup, source, saving, saveError, loadError, lastSave, change, reload }),
    [status, setup, source, saving, saveError, loadError, lastSave, change, reload],
  );

  return <DdSetupContext.Provider value={value}>{children}</DdSetupContext.Provider>;
}
