import type {
  AgentId,
  ChatErrorCode,
  ChatEvent,
  ContributionRole,
  Message,
  RoomMessagesResponse,
  RouteDecision,
  TerminalTurnStatus,
  Turn,
  TurnTrace,
} from '@/shared/contracts';

/**
 * What a room shows, as plain data: the saved thread (the API is the source of truth)
 * plus, while a turn streams, a live overlay built from its events. Live items that the
 * saved data already holds are hidden, matched by message id or by a shared line key,
 * so nothing shows twice and nothing received is dropped.
 *
 * Lines written by code from structured data:
 * - "<names> matched, not consulted." from the route (over the mention or keyword cap);
 * - "<Name> had nothing to add." from the trace or the no_addition event;
 * - turn-level failures and interruptions from the turn row.
 * Free-text notes (for example about an agent who is not selected) come from the server
 * as note messages and `note` events.
 */

export type AgentBubbleState =
  /** Named by the route; has not started yet. */
  | 'waiting'
  /** Started; no text yet. */
  | 'thinking'
  | 'streaming'
  /** The live stream was lost; this is the text received before that. */
  | 'detached'
  | 'complete'
  | 'partial'
  | 'error';

export interface LiveAgentItem {
  kind: 'agent';
  /** React key; stable for the life of the bubble. */
  key: string;
  messageId: string | null;
  agentId: AgentId;
  role: ContributionRole | null;
  text: string;
  state: AgentBubbleState;
  truncated: boolean;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
  /** Kept after the final reload because the server did not save it. */
  unsaved: boolean;
}

export interface LiveLineItem {
  kind: 'line';
  key: string;
  /** Matches the key of the same line built from saved data, or a saved message id. */
  dedupeKey: string;
  tone: 'note' | 'error';
  text: string;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
}

export type LiveItem = LiveAgentItem | LiveLineItem;

export interface LiveTurn {
  /** The question as sent. */
  text: string;
  turnId: string | null;
  /** Set by the `turn` event: the server has saved the question. */
  userMessageId: string | null;
  showHuman: boolean;
  route: RouteDecision | null;
  items: LiveItem[];
  done: TerminalTurnStatus | null;
  /** Counter for unique keys. */
  serial: number;
}

export type TimelineItem =
  | { kind: 'human'; key: string; text: string; pending: boolean }
  | {
      kind: 'agent';
      key: string;
      messageId: string | null;
      agentId: AgentId;
      agentName: string;
      text: string;
      state: AgentBubbleState;
      truncated: boolean;
      errorCode: ChatErrorCode | null;
      correlationId: string | null;
      unsaved: boolean;
    }
  | { kind: 'line'; key: string; tone: 'note' | 'error'; text: string; errorCode: ChatErrorCode | null; correlationId: string | null }
  /** "How this turn ran" for a finished turn. */
  | { kind: 'turn'; key: string; turn: Turn };

type AgentTimelineItem = Extract<TimelineItem, { kind: 'agent' }>;
type LineTimelineItem = Extract<TimelineItem, { kind: 'line' }>;

const ENDED: ReadonlySet<AgentBubbleState> = new Set(['complete', 'partial', 'error']);

export const TURN_FAILED_TEXT = 'This turn failed.';
// A reply is saved only once it has finished, so a restart loses the reply that was still
// running: the line says what the saved data holds, not what a tab may have shown.
export const TURN_INTERRUPTED_TEXT = 'This turn was interrupted: the server restarted while it ran. No reply was saved.';
export const TURN_INTERRUPTED_KEPT_TEXT =
  'This turn was interrupted: the server restarted while it ran. Replies that had finished are kept; a reply still running then was lost.';

/** "Lena", "Lena and Ines", "Lena, Ines and Dara". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const overCapText = (names: readonly string[]) => `${andList(names)} matched, not consulted.`;
const noAdditionText = (name: string) => `${name} had nothing to add.`;

// ---------------------------------------------------------------------------
// Live overlay
// ---------------------------------------------------------------------------

export function startLiveTurn(text: string, options: { soloAgentId?: AgentId }): LiveTurn {
  const live: LiveTurn = {
    text,
    turnId: null,
    userMessageId: null,
    showHuman: true,
    route: null,
    items: [],
    done: null,
    serial: 0,
  };
  // In a 1:1 room the speaker is known before the server answers.
  return options.soloAgentId ? addAgent(live, options.soloAgentId, 'thinking') : live;
}

function turnKey(live: LiveTurn): string {
  return live.turnId ?? 'live';
}

function addAgent(
  live: LiveTurn,
  agentId: AgentId,
  state: AgentBubbleState,
  extra: Partial<Pick<LiveAgentItem, 'messageId' | 'role' | 'text'>> = {},
): LiveTurn {
  const serial = live.serial + 1;
  const item: LiveAgentItem = {
    kind: 'agent',
    key: `live:agent:${serial}`,
    messageId: extra.messageId ?? null,
    agentId,
    role: extra.role ?? null,
    text: extra.text ?? '',
    state,
    truncated: false,
    errorCode: null,
    correlationId: null,
    unsaved: false,
  };
  return { ...live, serial, items: [...live.items, item] };
}

function ensureAgent(live: LiveTurn, agentId: AgentId, state: AgentBubbleState): LiveTurn {
  const exists = live.items.some((item) => item.kind === 'agent' && item.agentId === agentId);
  return exists ? live : addAgent(live, agentId, state);
}

function makeLine(
  dedupeKey: string,
  tone: LiveLineItem['tone'],
  text: string,
  errorCode: ChatErrorCode | null = null,
  correlationId: string | null = null,
): LiveLineItem {
  return { kind: 'line', key: `live:line:${dedupeKey}`, dedupeKey, tone, text, errorCode, correlationId };
}

function addLine(live: LiveTurn, line: LiveLineItem): LiveTurn {
  const exists = live.items.some((item) => item.kind === 'line' && item.dedupeKey === line.dedupeKey);
  return exists ? live : { ...live, items: [...live.items, line] };
}

/**
 * A server note goes before the bubbles of agents that have not started yet. The server
 * saves a note when it happens, before the replies still to come, so this is where the
 * saved thread will show it after the final reload: nothing jumps.
 */
function addNote(live: LiveTurn, line: LiveLineItem): LiveTurn {
  if (live.items.some((item) => item.kind === 'line' && item.dedupeKey === line.dedupeKey)) return live;
  const index = live.items.findIndex(
    (item) => item.kind === 'agent' && item.text === '' && (item.state === 'waiting' || item.state === 'thinking'),
  );
  if (index < 0) return { ...live, items: [...live.items, line] };
  return { ...live, items: [...live.items.slice(0, index), line, ...live.items.slice(index)] };
}

function indexOfMessage(live: LiveTurn, messageId: string): number {
  return live.items.findIndex((item) => item.kind === 'agent' && item.messageId === messageId);
}

function replaceAt(live: LiveTurn, index: number, item: LiveItem): LiveTurn {
  const items = [...live.items];
  items[index] = item;
  return { ...live, items };
}

/** Applies one stream event. Pure: returns a new LiveTurn (or the same one for a heartbeat). */
export function applyChatEvent(live: LiveTurn, event: ChatEvent, nameOf: (id: AgentId) => string): LiveTurn {
  switch (event.type) {
    case 'heartbeat':
      return live;

    case 'turn':
      return { ...live, turnId: event.turnId, userMessageId: event.userMessageId };

    case 'route': {
      let next: LiveTurn = { ...live, route: event.route };
      const overCap = event.route.notConsulted.filter((entry) => entry.reason === 'over_cap').map((entry) => entry.agentId);
      if (overCap.length > 0) next = addLine(next, makeLine(`overcap:${turnKey(live)}`, 'note', overCapText(overCap.map(nameOf))));
      if (event.route.primary) next = ensureAgent(next, event.route.primary, 'thinking');
      for (const agentId of event.route.secondaries) next = ensureAgent(next, agentId, 'waiting');
      return next;
    }

    case 'agent_start': {
      const index = live.items.findIndex(
        (item) => item.kind === 'agent' && item.agentId === event.agentId && item.messageId === null,
      );
      if (index < 0) return addAgent(live, event.agentId, 'thinking', { messageId: event.messageId, role: event.role });
      const item = live.items[index] as LiveAgentItem;
      return replaceAt(live, index, { ...item, messageId: event.messageId, role: event.role, state: 'thinking' });
    }

    case 'delta': {
      const index = indexOfMessage(live, event.messageId);
      // Text for a reply that never announced itself is still shown, never dropped.
      if (index < 0) return addAgent(live, 'unknown', 'streaming', { messageId: event.messageId, text: event.text });
      const item = live.items[index] as LiveAgentItem;
      const state = ENDED.has(item.state) ? item.state : 'streaming';
      return replaceAt(live, index, { ...item, text: item.text + event.text, state });
    }

    case 'no_addition': {
      const line = makeLine(
        event.messageId ?? `nta:${turnKey(live)}:${event.agentId}`,
        'note',
        noAdditionText(nameOf(event.agentId)),
      );
      let index = event.messageId ? indexOfMessage(live, event.messageId) : -1;
      if (index < 0) {
        index = live.items.findIndex(
          (item) => item.kind === 'agent' && item.agentId === event.agentId && !ENDED.has(item.state),
        );
      }
      return index >= 0 ? replaceAt(live, index, line) : addLine(live, line);
    }

    case 'agent_end': {
      const index = indexOfMessage(live, event.messageId);
      if (index < 0) return live;
      const item = live.items[index] as LiveAgentItem;
      return replaceAt(live, index, { ...item, state: event.status, truncated: event.truncated });
    }

    case 'note':
      return addNote(live, makeLine(event.messageId ?? `note:${turnKey(live)}:${live.items.length}`, 'note', event.text));

    case 'error': {
      if (!event.messageId) {
        return addLine(
          live,
          makeLine(`turnerr:${turnKey(live)}`, 'error', TURN_FAILED_TEXT, event.code, event.correlationId),
        );
      }
      const index = indexOfMessage(live, event.messageId);
      if (index < 0) {
        return addLine(live, makeLine(`err:${event.messageId}`, 'error', 'A reply failed.', event.code, event.correlationId));
      }
      const item = live.items[index] as LiveAgentItem;
      // The text received so far stays; the bubble gains the error.
      const state: AgentBubbleState = item.state === 'partial' ? 'partial' : 'error';
      return replaceAt(live, index, { ...item, state, errorCode: event.code, correlationId: event.correlationId });
    }

    case 'done': {
      const items = live.items
        .filter((item) => !(item.kind === 'agent' && (item.state === 'waiting' || item.state === 'thinking') && item.text === ''))
        .map((item) =>
          item.kind === 'agent' && !ENDED.has(item.state) ? { ...item, state: 'partial' as const } : item,
        );
      return { ...live, items, done: event.status };
    }
  }
}

/** The live stream was lost while the turn may still run on the server. */
export function detachLiveTurn(live: LiveTurn): LiveTurn {
  const items = live.items
    .filter((item) => !(item.kind === 'agent' && (item.state === 'waiting' || item.state === 'thinking') && item.text === ''))
    .map((item) => (item.kind === 'agent' && item.state === 'streaming' ? { ...item, state: 'detached' as const } : item));
  return { ...live, items };
}

/**
 * After the final reload the saved thread replaces the overlay, except for what the
 * server did not save: replies with text (or an error reference) and turn-level errors.
 * Those stay, marked unsaved, so received text is never erased.
 */
export function retainAfterReload(live: LiveTurn, data: RoomMessagesResponse): LiveTurn | null {
  const savedIds = new Set(data.messages.map((message) => message.id));
  const failedTurns = new Set(data.turns.filter((turn) => turn.status === 'error').map((turn) => turn.id));
  const items: LiveItem[] = [];
  for (const item of live.items) {
    if (item.kind === 'agent') {
      if (item.messageId && savedIds.has(item.messageId)) continue;
      if (item.text === '' && item.correlationId === null) continue;
      items.push({ ...item, state: ENDED.has(item.state) ? item.state : 'partial', unsaved: true });
    } else if (item.dedupeKey.startsWith('turnerr:') && !failedTurns.has(item.dedupeKey.slice('turnerr:'.length))) {
      items.push(item);
    }
  }
  return items.length > 0 ? { ...live, showHuman: false, items } : null;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function messageItem(message: Message, nameOf: (id: AgentId) => string): TimelineItem {
  if (message.author === 'human') return { kind: 'human', key: message.id, text: message.text, pending: false };
  if (message.author === 'note') {
    return { kind: 'line', key: message.id, tone: 'note', text: message.text, errorCode: null, correlationId: null };
  }
  const agentId = message.agentId ?? 'unknown';
  return {
    kind: 'agent',
    key: message.id,
    messageId: message.id,
    agentId,
    agentName: message.agentName ?? nameOf(agentId),
    text: message.text,
    state: message.status,
    truncated: message.truncated,
    errorCode: message.errorCode,
    correlationId: message.correlationId,
    unsaved: false,
  };
}

function savedLine(key: string, tone: LineTimelineItem['tone'], text: string, turn?: Turn): LineTimelineItem {
  return {
    kind: 'line',
    key,
    tone,
    text,
    errorCode: turn?.errorCode ?? null,
    correlationId: turn?.correlationId ?? null,
  };
}

function nameInTrace(trace: TurnTrace, agentId: AgentId, nameOf: (id: AgentId) => string): string {
  return trace.agents.find((outcome) => outcome.agentId === agentId)?.agentName ?? nameOf(agentId);
}

function overCapLine(turn: Turn, nameOf: (id: AgentId) => string): LineTimelineItem | null {
  const trace = turn.trace;
  if (!trace) return null;
  const names = trace.route.notConsulted
    .filter((entry) => entry.reason === 'over_cap')
    .map((entry) => nameInTrace(trace, entry.agentId, nameOf));
  return names.length > 0 ? savedLine(`overcap:${turn.id}`, 'note', overCapText(names)) : null;
}

function footerItems(turn: Turn, group: readonly Message[], savedIds: ReadonlySet<string>): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const outcome of turn.trace?.agents ?? []) {
    if (outcome.state !== 'no_addition') continue;
    if (outcome.messageId && savedIds.has(outcome.messageId)) continue;
    items.push(savedLine(outcome.messageId ?? `nta:${turn.id}:${outcome.agentId}`, 'note', noAdditionText(outcome.agentName)));
  }
  if (turn.status === 'error') {
    const shown = turn.correlationId
      ? group.some((message) => message.correlationId === turn.correlationId)
      : group.some((message) => message.author === 'agent' && message.status === 'error');
    if (!shown) items.push(savedLine(`turnerr:${turn.id}`, 'error', TURN_FAILED_TEXT, turn));
  }
  if (turn.status === 'interrupted') {
    const kept = group.some((message) => message.author === 'agent');
    items.push(savedLine(`interrupted:${turn.id}`, 'error', kept ? TURN_INTERRUPTED_KEPT_TEXT : TURN_INTERRUPTED_TEXT));
  }
  if (turn.status !== 'running' && turn.trace) items.push({ kind: 'turn', key: `panel:${turn.id}`, turn });
  return items;
}

interface Segment {
  turnId: string;
  head: TimelineItem[];
  foot: TimelineItem[];
}

/**
 * A turn running on the server that this tab does not stream (it reloaded or came back to
 * the room): its route names the speakers, so their bubbles show as thinking (or waiting
 * for the first answer) until the saved replies arrive. The streamed text itself exists
 * only on the server until each reply is saved.
 */
function pendingAgents(
  turn: Turn,
  group: readonly Message[],
  lives: readonly LiveTurn[],
  nameOf: (id: AgentId) => string,
): TimelineItem[] {
  const route = turn.trace?.route;
  if (turn.status !== 'running' || !route?.primary) return [];
  const shown = new Set<AgentId>([
    ...(turn.trace?.agents ?? []).map((outcome) => outcome.agentId),
    ...group.flatMap((message) => (message.author === 'agent' && message.agentId ? [message.agentId] : [])),
    ...lives
      .filter((entry) => entry.turnId === turn.id || (entry.turnId === null && entry.done === null))
      .flatMap((entry) => entry.items.flatMap((item) => (item.kind === 'agent' ? [item.agentId] : []))),
  ]);
  const primaryDone = shown.has(route.primary);
  const pending: Array<[AgentId, AgentBubbleState]> = [
    [route.primary, 'thinking'],
    ...route.secondaries.map((id): [AgentId, AgentBubbleState] => [id, primaryDone ? 'thinking' : 'waiting']),
  ];
  return pending
    .filter(([agentId]) => !shown.has(agentId))
    .map(([agentId, state]) => ({
      kind: 'agent',
      key: `pending:${turn.id}:${agentId}`,
      messageId: null,
      agentId,
      agentName: nameOf(agentId),
      text: '',
      state,
      truncated: false,
      errorCode: null,
      correlationId: null,
      unsaved: false,
    }));
}

function liveItems(
  live: LiveTurn,
  savedIds: ReadonlySet<string>,
  savedKeys: ReadonlySet<string>,
  nameOf: (id: AgentId) => string,
): TimelineItem[] {
  const out: TimelineItem[] = [];
  if (live.showHuman && !(live.userMessageId && savedIds.has(live.userMessageId))) {
    out.push({ kind: 'human', key: `live:human:${live.turnId ?? 'new'}`, text: live.text, pending: live.userMessageId === null });
  }
  for (const item of live.items) {
    if (item.kind === 'agent') {
      if (item.messageId && savedIds.has(item.messageId)) continue;
      const agentItem: AgentTimelineItem = {
        kind: 'agent',
        key: item.key,
        messageId: item.messageId,
        agentId: item.agentId,
        agentName: nameOf(item.agentId),
        text: item.text,
        state: item.state,
        truncated: item.truncated,
        errorCode: item.errorCode,
        correlationId: item.correlationId,
        unsaved: item.unsaved,
      };
      out.push(agentItem);
    } else {
      if (savedKeys.has(item.dedupeKey) || savedIds.has(item.dedupeKey)) continue;
      out.push({
        kind: 'line',
        key: item.key,
        tone: item.tone,
        text: item.text,
        errorCode: item.errorCode,
        correlationId: item.correlationId,
      });
    }
  }
  return out;
}

/**
 * The items a room renders, in order: for each saved turn its messages (with
 * "matched, not consulted" after the question), any live items of that turn, then its
 * footer (nothing to add, failure lines, "How this turn ran"). Live turns not yet in the
 * saved data come last.
 */
export function buildTimeline(
  data: RoomMessagesResponse | null,
  live: LiveTurn | readonly LiveTurn[] | null,
  nameOf: (id: AgentId) => string,
): TimelineItem[] {
  const lives: readonly LiveTurn[] = live === null ? [] : Array.isArray(live) ? live : [live as LiveTurn];
  const messages = [...(data?.messages ?? [])].sort((a, b) => a.seq - b.seq);
  const savedIds = new Set(messages.map((message) => message.id));
  const turnsById = new Map((data?.turns ?? []).map((turn) => [turn.id, turn]));

  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const group = groups.get(message.turnId);
    if (group) group.push(message);
    else groups.set(message.turnId, [message]);
  }

  const segments: Segment[] = [];
  for (const [turnId, group] of groups) {
    const turn = turnsById.get(turnId);
    const head: TimelineItem[] = [];
    const overCap = turn ? overCapLine(turn, nameOf) : null;
    let overCapPlaced = overCap === null;
    for (const message of group) {
      head.push(messageItem(message, nameOf));
      if (!overCapPlaced && message.author === 'human' && overCap) {
        head.push(overCap);
        overCapPlaced = true;
      }
    }
    if (!overCapPlaced && overCap) head.unshift(overCap);
    segments.push({ turnId, head, foot: turn ? footerItems(turn, group, savedIds) : [] });
  }
  // A finished turn with no saved message (it failed before the question was saved).
  for (const turn of data?.turns ?? []) {
    if (!groups.has(turn.id) && turn.status !== 'running') {
      segments.push({ turnId: turn.id, head: [], foot: footerItems(turn, [], savedIds) });
    }
  }

  const savedKeys = new Set<string>();
  for (const segment of segments) {
    for (const item of [...segment.head, ...segment.foot]) savedKeys.add(item.key);
  }

  const livesByTurn = new Map<string, LiveTurn[]>();
  const trailing: LiveTurn[] = [];
  for (const entry of lives) {
    if (entry.turnId && groups.has(entry.turnId)) {
      const list = livesByTurn.get(entry.turnId) ?? [];
      list.push(entry);
      livesByTurn.set(entry.turnId, list);
    } else {
      trailing.push(entry);
    }
  }

  const items: TimelineItem[] = [];
  for (const segment of segments) {
    items.push(...segment.head);
    for (const entry of livesByTurn.get(segment.turnId) ?? []) items.push(...liveItems(entry, savedIds, savedKeys, nameOf));
    const turn = turnsById.get(segment.turnId);
    if (turn) items.push(...pendingAgents(turn, groups.get(segment.turnId) ?? [], lives, nameOf));
    items.push(...segment.foot);
  }
  for (const entry of trailing) items.push(...liveItems(entry, savedIds, savedKeys, nameOf));
  return items;
}
