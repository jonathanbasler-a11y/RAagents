'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from 'react';
import type { AgentId, ChatErrorCode, ChatEvent, RoomId, RoomMessagesResponse } from '@/shared/contracts';
import { chatClient, type ApiResult, type ChatApi, type PostTurnOutcome } from './chat-client';
import {
  applyChatEvent,
  buildTimeline,
  detachLiveTurn,
  retainAfterReload,
  startLiveTurn,
  type LiveTurn,
  type TimelineItem,
} from './timeline';

/**
 * One room's state machine:
 *
 *   loading → idle ⇄ sending → streaming → loading (reload) → idle
 *                      ↘ polling (turn running elsewhere, stream lost, duplicate) → idle
 *   loading → error (reload() retries)
 *
 * The API is the source of truth. After every turn the room reloads its messages; the
 * live overlay only bridges the time until the saved data catches up. A turn the server
 * has answered is never POSTed again; when its stream breaks, the room polls instead.
 */

export type RoomPhase = 'loading' | 'idle' | 'sending' | 'streaming' | 'polling' | 'error';

export interface RoomNotice {
  tone: 'info' | 'error';
  text: string;
  correlationId?: string | null;
  /** Progress notices disappear when the room is idle again. */
  clearOnIdle?: boolean;
}

export type SendOutcome =
  | { status: 'sent' }
  /** Nothing was saved: the caller may put the text back in the composer. */
  | { status: 'not_sent'; reason: string }
  /** A turn was already running or being sent. */
  | { status: 'ignored' };

export type RoomClient = Pick<ChatApi, 'postTurn' | 'getMessages' | 'newConversation'>;

export interface UseChatRoomOptions {
  client?: RoomClient;
  /** How often to poll while a turn runs without a live stream. */
  pollIntervalMs?: number;
  /** In a 1:1 room: the agent shown thinking as soon as the question is sent. */
  soloAgentId?: AgentId;
  nameOf?: (id: AgentId) => string;
  /**
   * Called when the model connection cannot be used: the server refused a turn because it is
   * not set up, or a reply failed because the gateway refused the key or the model.
   */
  onSetupProblem?: () => void;
}

export interface ChatRoomModel {
  phase: RoomPhase;
  /** True while loading, sending, streaming or polling: the composer is disabled. */
  busy: boolean;
  data: RoomMessagesResponse | null;
  timeline: TimelineItem[];
  notice: RoomNotice | null;
  loadError: { message: string; correlationId: string | null } | null;
  send(text: string): Promise<SendOutcome>;
  reload(): void;
  newConversation(): Promise<boolean>;
  dismissNotice(): void;
}

export const POLL_INTERVAL_MS = 2000;
/** About a minute of failed polls before the room shows an error with a retry button. */
const MAX_POLL_FAILURES = 30;

const STREAM_LOST: RoomNotice = {
  tone: 'info',
  text: 'The live connection dropped. The turn continues on the server; checking for the result every 2 seconds.',
  clearOnIdle: true,
};
const ALREADY_RECEIVED: RoomNotice = {
  tone: 'info',
  text: 'The server already had this question. Showing its progress.',
  clearOnIdle: true,
};
const POLL_TROUBLE: RoomNotice = {
  tone: 'info',
  text: 'Connection problem. Still checking for the result.',
  clearOnIdle: true,
};

interface State {
  phase: RoomPhase;
  data: RoomMessagesResponse | null;
  live: LiveTurn | null;
  /** Earlier live turns with replies the server did not save. */
  retained: LiveTurn[];
  notice: RoomNotice | null;
  loadError: { message: string; correlationId: string | null } | null;
  pollFailures: number;
  /** Bumped on every load or poll result, so the poll effect schedules the next tick. */
  pollTick: number;
}

type Action =
  | { type: 'reload_start' }
  | { type: 'loaded'; data: RoomMessagesResponse }
  | { type: 'load_failed'; message: string; correlationId: string | null }
  | { type: 'poll_failed' }
  | { type: 'send_start'; text: string; soloAgentId?: AgentId }
  | { type: 'responded'; status: number }
  | { type: 'event'; event: ChatEvent; nameOf: (id: AgentId) => string }
  | { type: 'stream_lost' }
  | { type: 'not_sent'; notice: RoomNotice; follow: boolean }
  | { type: 'follow'; notice: RoomNotice }
  | { type: 'notice'; notice: RoomNotice | null };

const INITIAL_STATE: State = {
  phase: 'loading',
  data: null,
  live: null,
  retained: [],
  notice: null,
  loadError: null,
  pollFailures: 0,
  pollTick: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reload_start':
      return { ...state, phase: 'loading', loadError: null };

    case 'loaded': {
      const { data } = action;
      const running = data.runningTurn !== null;
      let { live, retained } = state;
      if (state.data !== null && state.data.thread.id !== data.thread.id) {
        // A new conversation (here or in another tab): what this tab kept belongs to the archived thread.
        live = null;
        retained = [];
      }
      if (running) {
        // The saved running turn holds the question; a live copy without an id would show twice.
        if (live && live.userMessageId === null) live = { ...live, showHuman: false };
      } else {
        if (live) {
          const kept = retainAfterReload(live, data);
          if (kept) retained = [...retained, kept];
          live = null;
        }
        retained = retained.flatMap((entry) => retainAfterReload(entry, data) ?? []);
      }
      const notice = !running && state.notice?.clearOnIdle ? null : state.notice;
      return {
        ...state,
        phase: running ? 'polling' : 'idle',
        data,
        live,
        retained,
        notice,
        loadError: null,
        pollFailures: 0,
        pollTick: state.pollTick + 1,
      };
    }

    case 'load_failed':
      return { ...state, phase: 'error', loadError: { message: action.message, correlationId: action.correlationId } };

    case 'poll_failed': {
      const pollFailures = state.pollFailures + 1;
      if (pollFailures >= MAX_POLL_FAILURES) {
        return {
          ...state,
          phase: 'error',
          pollFailures,
          loadError: { message: 'Lost contact with the server while a turn was running.', correlationId: null },
        };
      }
      return { ...state, pollFailures, notice: POLL_TROUBLE, pollTick: state.pollTick + 1 };
    }

    case 'send_start':
      return { ...state, phase: 'sending', notice: null, live: startLiveTurn(action.text, { soloAgentId: action.soloAgentId }) };

    case 'responded':
      return action.status === 200 && state.phase === 'sending' ? { ...state, phase: 'streaming' } : state;

    case 'event':
      if (!state.live) return state;
      return { ...state, phase: 'streaming', live: applyChatEvent(state.live, action.event, action.nameOf) };

    case 'stream_lost':
      return {
        ...state,
        phase: 'polling',
        live: state.live ? detachLiveTurn(state.live) : null,
        notice: STREAM_LOST,
        pollTick: state.pollTick + 1,
      };

    case 'not_sent':
      return {
        ...state,
        phase: action.follow ? 'polling' : 'idle',
        live: null,
        notice: action.notice,
        pollTick: state.pollTick + 1,
      };

    case 'follow':
      return { ...state, phase: 'polling', live: null, notice: action.notice, pollTick: state.pollTick + 1 };

    case 'notice':
      return { ...state, notice: action.notice };
  }
}

const BUSY_PHASES: ReadonlySet<RoomPhase> = new Set(['loading', 'sending', 'streaming', 'polling']);

/** Reply errors after which the server refuses every call until it restarts: the setup state must be checked again. */
const SETUP_REFUSALS: ReadonlySet<ChatErrorCode> = new Set(['llm_auth', 'llm_model']);

/** Fallback when no roster names are given; module-level so its identity never changes. */
const idAsName = (id: AgentId) => id;

/** getMessages that never rejects: an unexpected throw becomes a load failure, never a hang. */
async function loadMessages(
  client: RoomClient,
  roomId: RoomId,
  signal?: AbortSignal,
): Promise<ApiResult<RoomMessagesResponse>> {
  try {
    return await client.getMessages(roomId, { signal });
  } catch (error) {
    if (!signal?.aborted) console.error('[chat] loading the messages failed unexpectedly', error);
    return { ok: false, status: 0, error: null, message: 'Could not load the messages (unexpected error).' };
  }
}

function sameQuestionSaved(data: RoomMessagesResponse, knownIds: ReadonlySet<string>, text: string): boolean {
  const question = text.trim();
  return data.messages.some((message) => message.author === 'human' && !knownIds.has(message.id) && message.text.trim() === question);
}

export function useChatRoom(roomId: RoomId, options: UseChatRoomOptions = {}): ChatRoomModel {
  const client = options.client ?? chatClient;
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const { soloAgentId, onSetupProblem } = options;
  const nameOf = options.nameOf ?? idAsName;

  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const inFlight = useRef(false);
  const streamAbort = useRef<AbortController | null>(null);

  // Effects read the latest client without depending on its identity: a caller that
  // passes a new client object on every render must not cause a fetch loop.
  const fetchMessages = useEffectEvent((signal?: AbortSignal) => loadMessages(client, roomId, signal));

  // Initial load. A room change remounts the component (ChatRoom is keyed by room).
  useEffect(() => {
    const controller = new AbortController();
    fetchMessages(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) dispatch({ type: 'loaded', data: result.data });
      else dispatch({ type: 'load_failed', message: result.message, correlationId: result.error?.correlationId ?? null });
    });
    return () => controller.abort();
  }, [roomId]);

  // Poll while a turn runs without a live stream.
  useEffect(() => {
    if (state.phase !== 'polling') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchMessages(controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) dispatch({ type: 'loaded', data: result.data });
        else dispatch({ type: 'poll_failed' });
      });
    }, pollMs);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [state.phase, state.pollTick, roomId, pollMs]);

  // Leaving the room stops reading the stream; the turn itself keeps running on the server.
  useEffect(() => () => streamAbort.current?.abort(), []);

  const reloadNow = useCallback(async (): Promise<RoomMessagesResponse | null> => {
    dispatch({ type: 'reload_start' });
    const result = await loadMessages(client, roomId);
    if (result.ok) {
      dispatch({ type: 'loaded', data: result.data });
      return result.data;
    }
    dispatch({ type: 'load_failed', message: result.message, correlationId: result.error?.correlationId ?? null });
    return null;
  }, [client, roomId]);

  /** The server may or may not have the turn (no response, or a 5xx). The saved data decides. */
  const settleUnknown = useCallback(
    async (text: string, knownIds: ReadonlySet<string>, notice: RoomNotice): Promise<SendOutcome> => {
      const data = await reloadNow();
      if (data && (data.runningTurn !== null || sameQuestionSaved(data, knownIds, text))) return { status: 'sent' };
      dispatch({ type: 'not_sent', notice, follow: false });
      return { status: 'not_sent', reason: notice.text };
    },
    [reloadNow],
  );

  const handleOutcome = useCallback(
    async (outcome: PostTurnOutcome, text: string, knownIds: ReadonlySet<string>): Promise<SendOutcome> => {
      switch (outcome.kind) {
        case 'stream':
          if (outcome.done) {
            await reloadNow();
          } else {
            dispatch({ type: 'stream_lost' });
          }
          return { status: 'sent' };

        case 'duplicate':
          dispatch({ type: 'follow', notice: ALREADY_RECEIVED });
          return { status: 'sent' };

        case 'aborted':
          return { status: 'sent' };

        case 'invalid': {
          const notice: RoomNotice = { tone: 'error', text: outcome.message };
          dispatch({ type: 'not_sent', notice, follow: false });
          return { status: 'not_sent', reason: outcome.message };
        }

        case 'network_error':
          return settleUnknown(text, knownIds, {
            tone: 'error',
            text: 'Could not reach the server, so your question was not sent. It is back in the box.',
          });

        case 'rejected': {
          const correlationId = outcome.error?.correlationId ?? null;
          if (outcome.error?.error === 'room_busy') {
            const notice: RoomNotice = {
              tone: 'info',
              text: 'Another turn is running in this room. Your question is back in the box; send it when that turn ends.',
              correlationId,
              clearOnIdle: true,
            };
            dispatch({ type: 'not_sent', notice, follow: true });
            return { status: 'not_sent', reason: notice.text };
          }
          if (outcome.error?.error === 'llm_not_configured') {
            onSetupProblem?.();
            const notice: RoomNotice = {
              tone: 'error',
              text: 'The model connection is not set up, so nothing was sent.',
              correlationId,
            };
            dispatch({ type: 'not_sent', notice, follow: false });
            return { status: 'not_sent', reason: notice.text };
          }
          if (outcome.status >= 500 || outcome.status === 200) {
            return settleUnknown(text, knownIds, {
              tone: 'error',
              text: 'The server could not start this turn. Your question is back in the box.',
              correlationId,
            });
          }
          const notice: RoomNotice = {
            tone: 'error',
            text: outcome.error?.message ?? `The server refused the question (status ${outcome.status}).`,
            correlationId,
          };
          dispatch({ type: 'not_sent', notice, follow: false });
          return { status: 'not_sent', reason: notice.text };
        }
      }
    },
    [reloadNow, settleUnknown, onSetupProblem],
  );

  const busy = BUSY_PHASES.has(state.phase);
  const knownIds = useMemo(() => new Set((state.data?.messages ?? []).map((message) => message.id)), [state.data]);

  const send = useCallback(
    async (text: string): Promise<SendOutcome> => {
      if (inFlight.current || busy) return { status: 'ignored' };
      inFlight.current = true;
      const controller = new AbortController();
      streamAbort.current = controller;
      dispatch({ type: 'send_start', text: text.trim(), soloAgentId });
      try {
        const outcome = await client.postTurn(
          roomId,
          text,
          {
            onResponse: (status) => dispatch({ type: 'responded', status }),
            onEvent: (event) => {
              dispatch({ type: 'event', event, nameOf });
              if (event.type === 'error' && SETUP_REFUSALS.has(event.code)) onSetupProblem?.();
            },
          },
          { signal: controller.signal },
        );
        return await handleOutcome(outcome, text, knownIds);
      } catch (error) {
        // Never leave the room stuck in "sending": the saved data decides what happened.
        console.error('[chat] sending failed unexpectedly', error);
        return await settleUnknown(text, knownIds, {
          tone: 'error',
          text: 'Something went wrong while sending. Your question is back in the box.',
        });
      } finally {
        inFlight.current = false;
        if (streamAbort.current === controller) streamAbort.current = null;
      }
    },
    [busy, client, roomId, soloAgentId, nameOf, onSetupProblem, handleOutcome, settleUnknown, knownIds],
  );

  const reload = useCallback(() => {
    void reloadNow();
  }, [reloadNow]);

  const newConversation = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || busy) return false;
    inFlight.current = true;
    // Busy from the click on: the composer is disabled until the room has reloaded, so
    // nothing can be typed into a send that would be ignored.
    dispatch({ type: 'reload_start' });
    try {
      const result = await client.newConversation(roomId);
      if (!result.ok) {
        const text =
          result.error?.error === 'room_busy'
            ? 'A turn is still running in this room. Start a new conversation when it ends.'
            : result.message;
        dispatch({ type: 'notice', notice: { tone: 'error', text, correlationId: result.error?.correlationId ?? null } });
        await reloadNow();
        return false;
      }
      await reloadNow();
      return true;
    } finally {
      inFlight.current = false;
    }
  }, [busy, client, roomId, reloadNow]);

  const dismissNotice = useCallback(() => dispatch({ type: 'notice', notice: null }), []);

  const timeline = useMemo(
    () => buildTimeline(state.data, state.live ? [...state.retained, state.live] : state.retained, nameOf),
    [state.data, state.live, state.retained, nameOf],
  );

  return {
    phase: state.phase,
    busy,
    data: state.data,
    timeline,
    notice: state.notice,
    loadError: state.loadError,
    send,
    reload,
    newConversation,
    dismissNotice,
  };
}
