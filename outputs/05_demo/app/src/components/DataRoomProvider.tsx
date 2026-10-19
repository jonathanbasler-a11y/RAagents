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
import type {
  AddDocumentRequest,
  DataRoomDocumentResponse,
  DataRoomResponse,
  DataRoomStartRequest,
} from '@/shared/contracts';
import { MAX_DOCUMENT_CHARS, MAX_TURN_DOCUMENT_CHARS, planTurn } from '@/shared/data-room';
import { chatClient, type ApiResult, type ChatApi } from '@/client/chat-client';
import type { DocumentsConnected } from './labels';

export type DataRoomClient = Pick<ChatApi, 'getDataRoom' | 'getDocument' | 'startDataRoom' | 'addDocument' | 'withdrawDocument'>;

/** The data room as the page lists it: no document text. */
export type DataRoomView = NonNullable<DataRoomResponse['dataRoom']>;

export interface DataRoomProblem {
  message: string;
  correlationId: string | null;
}

export interface DataRoomState {
  /** unavailable: no provider (nothing is shown). Unknown is never shown as "no data room". */
  status: 'unavailable' | 'loading' | 'ready' | 'error';
  /** undefined: not known yet. null: this workspace has no data room. */
  dataRoom: DataRoomView | null | undefined;
  practiceAvailable: boolean;
  limits: DataRoomResponse['limits'];
  /** A start, an add or a withdrawal is being saved. */
  saving: boolean;
  saveError: DataRoomProblem | null;
  loadError: DataRoomProblem | null;
  /** Each action answers whether it was saved. A second action is ignored (false) while one runs. */
  start(request: DataRoomStartRequest): Promise<boolean>;
  add(request: AddDocumentRequest): Promise<boolean>;
  withdraw(documentId: string, reason: string): Promise<boolean>;
  /** One document with its text, for the viewer. Changes no state. */
  loadDocument(documentId: string): Promise<ApiResult<DataRoomDocumentResponse>>;
  reload(): void;
}

const DEFAULT_LIMITS: DataRoomResponse['limits'] = { documentChars: MAX_DOCUMENT_CHARS, turnChars: MAX_TURN_DOCUMENT_CHARS };

const UNAVAILABLE: DataRoomState = {
  status: 'unavailable',
  dataRoom: undefined,
  practiceAvailable: false,
  limits: DEFAULT_LIMITS,
  saving: false,
  saveError: null,
  loadError: null,
  start: async () => false,
  add: async () => false,
  withdraw: async () => false,
  loadDocument: async () => ({ ok: false, status: 0, error: null, message: 'The data room is not available here.' }),
  reload: () => undefined,
};

const DataRoomContext = createContext<DataRoomState>(UNAVAILABLE);

export function useDataRoom(): DataRoomState {
  return useContext(DataRoomContext);
}

/**
 * Whether the agents can read documents right now. Without a provider the page keeps its old wording (none). While the
 * data room is loading or failed to load, it is unknown, and no page may say "no documents". With a room, it is connected
 * when at least one document is shown to the agents.
 */
export function useDocumentsConnected(): { documents: DocumentsConnected; shown: number } {
  const { status, dataRoom, limits } = useDataRoom();
  if (status === 'unavailable') return { documents: 'none', shown: 0 };
  if (dataRoom === undefined) return { documents: 'unknown', shown: 0 };
  if (dataRoom === null) return { documents: 'none', shown: 0 };
  const shown = planTurn(
    dataRoom.documents.map((document) => ({
      id: document.id,
      provided: document.provided,
      publishedAt: document.publishedAt,
      withdrawn: document.withdrawnAt !== null,
      size: document.chars,
    })),
    dataRoom.asOf,
    limits.turnChars,
  ).filter((entry) => entry.state === 'shown').length;
  return { documents: shown > 0 ? 'connected' : 'none', shown };
}

const problemOf = (result: Extract<ApiResult<unknown>, { ok: false }>): DataRoomProblem => ({
  message: result.message,
  correlationId: result.error?.correlationId ?? null,
});

/** The workspace's data room: the as-of date and the list of documents, shared by the data room page, the home page and the wording. */
export function DataRoomProvider({ children, client = chatClient }: { children: ReactNode; client?: DataRoomClient }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dataRoom, setDataRoom] = useState<DataRoomView | null | undefined>(undefined);
  const [practiceAvailable, setPracticeAvailable] = useState(false);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DataRoomProblem | null>(null);
  const [loadError, setLoadError] = useState<DataRoomProblem | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const savingNow = useRef(false);
  /** Counts every state a save handed us, so a read that started before one can tell it was overtaken. */
  const writes = useRef(0);

  const apply = useCallback((data: DataRoomResponse) => {
    setDataRoom(data.dataRoom);
    setPracticeAvailable(data.practiceAvailable);
    setLimits(data.limits);
    setLoadError(null);
    setStatus('ready');
  }, []);

  const fetchRoom = useEffectEvent(() => client.getDataRoom());

  useEffect(() => {
    let cancelled = false;
    fetchRoom().then((result) => {
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

  /** Reads again without showing "loading". A failed read changes nothing: what is shown stays. */
  const refreshQuietly = useEffectEvent(async () => {
    const before = writes.current;
    const result = await client.getDataRoom();
    if (!result.ok || writes.current !== before) return;
    apply(result.data);
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

  /** Runs one saving action: one at a time, the old error cleared, the busy flag always lowered. */
  const act = useCallback(async (work: () => Promise<boolean>): Promise<boolean> => {
    if (savingNow.current) return false;
    savingNow.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      return await work();
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }, []);

  /** After a document was saved: read the list again, so what is shown is what is saved. */
  const readAgain = useCallback(async (): Promise<void> => {
    const result = await client.getDataRoom();
    writes.current += 1;
    if (result.ok) {
      apply(result.data);
    } else {
      setSaveError({ message: `Saved, but the list could not be read again: ${result.message}`, correlationId: result.error?.correlationId ?? null });
    }
  }, [client, apply]);

  const start = useCallback(
    (request: DataRoomStartRequest) =>
      act(async () => {
        const result = await client.startDataRoom(request);
        if (!result.ok) {
          setSaveError(problemOf(result));
          return false;
        }
        writes.current += 1;
        apply(result.data);
        return true;
      }),
    [act, client, apply],
  );

  const add = useCallback(
    (request: AddDocumentRequest) =>
      act(async () => {
        const result = await client.addDocument(request);
        if (!result.ok) {
          setSaveError(problemOf(result));
          return false;
        }
        await readAgain();
        return true;
      }),
    [act, client, readAgain],
  );

  const withdraw = useCallback(
    (documentId: string, reason: string) =>
      act(async () => {
        const result = await client.withdrawDocument(documentId, reason);
        if (!result.ok) {
          setSaveError(problemOf(result));
          return false;
        }
        await readAgain();
        return true;
      }),
    [act, client, readAgain],
  );

  const loadDocument = useCallback((documentId: string) => client.getDocument(documentId), [client]);

  const value = useMemo<DataRoomState>(
    () => ({ status, dataRoom, practiceAvailable, limits, saving, saveError, loadError, start, add, withdraw, loadDocument, reload }),
    [status, dataRoom, practiceAvailable, limits, saving, saveError, loadError, start, add, withdraw, loadDocument, reload],
  );

  return <DataRoomContext.Provider value={value}>{children}</DataRoomContext.Provider>;
}
