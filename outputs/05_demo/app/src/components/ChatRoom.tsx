'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PublicAgent, RoomId } from '@/shared/contracts';
import { chatClient, type ChatApi } from '@/client/chat-client';
import { isSetupMissing, useHealth } from '@/client/use-health';
import { useChatRoom, type RoomPhase } from '@/client/use-chat-room';
import { Avatar } from './Avatar';
import { EvidenceBanner, SetupBanner } from './Banners';
import { Composer } from './Composer';
import { demoPromptsFor } from './demo-prompts';
import { AUTONOMY_LABELS, isMentionable } from './labels';
import { AgentBubble, HumanBubble, SystemLine } from './MessageBubble';
import { useSelection } from './SelectionProvider';
import { TurnPanel } from './TurnPanel';

/** The live demo's team chat prompts (LIVE-DEMO.md steps 3 to 8), under the composer's "Demo prompts". */
const TEAM_DEMO_PROMPTS = demoPromptsFor('team');

const LIVE_STATUS: Record<RoomPhase, string> = {
  loading: 'Loading messages.',
  idle: '',
  sending: 'Sending your question.',
  streaming: 'Agents are replying.',
  polling: 'A turn is in progress.',
  error: 'Something went wrong.',
};

export interface ChatRoomProps {
  /** "team" or an agent id (that agent's 1:1 room). */
  roomId: RoomId;
  /** The roster (GET /api/agents shape), sorted by order. */
  agents: PublicAgent[];
  /** Injected in tests; the app uses the browser client. */
  client?: ChatApi;
}

/** The team chat and every 1:1 room. The API owns history; this shows it and the live turn. */
export function ChatRoom({ roomId, agents, client = chatClient }: ChatRoomProps) {
  const roster = useMemo(() => [...agents].sort((a, b) => a.order - b.order), [agents]);
  const agentsById = useMemo(() => new Map(roster.map((agent) => [agent.id, agent])), [roster]);
  const nameOf = useCallback((id: string) => agentsById.get(id)?.name ?? id, [agentsById]);
  const isTeam = roomId === 'team';
  const agent = isTeam ? undefined : agentsById.get(roomId);

  const { health, refresh: refreshHealth } = useHealth(client);
  const room = useChatRoom(roomId, {
    client,
    nameOf,
    soloAgentId: isTeam ? undefined : roomId,
    onSetupProblem: refreshHealth,
  });
  const selection = useSelection();

  const setupMissing = isSetupMissing(health);
  const loadFailed = room.phase === 'error' && room.data === null;
  const disabled = room.busy || setupMissing || loadFailed;
  const disabledReason = setupMissing
    ? 'The model connection cannot be used. See the banner above.'
    : room.phase === 'sending' || room.phase === 'streaming'
      ? 'Waiting for the reply…'
      : room.phase === 'polling'
        ? 'A turn is in progress. Checking every 2 seconds…'
        : loadFailed
          ? 'Messages could not be loaded.'
          : null;

  const empty = room.data !== null && room.timeline.length === 0;
  const orchestrator = roster.find((member) => member.kind === 'orchestrator');
  const synthesiser = roster.find((member) => member.teamRole === 'synthesiser');

  const mentionChips = useMemo(() => {
    if (!isTeam || !selection.selected) return [];
    const selected = selection.selected;
    return roster
      .filter((member) => (member.locked || selected.has(member.id)) && isMentionable(member))
      .map((member) => ({ id: member.id, name: member.name }));
  }, [isTeam, selection.selected, roster]);

  // A 1:1 room's starters: the walkthrough's prompt for this room first (Rosa: step 2), then the
  // agent's example prompts. The team chat offers the walkthrough's prompts instead.
  const starterPrompts =
    empty && !isTeam ? [...new Set([...demoPromptsFor(roomId).map((prompt) => prompt.text), ...(agent?.examplePrompts ?? [])])] : [];

  // Follow the conversation while the reader is at the bottom; leave them alone if they
  // scrolled up, until they send: their own question and its reply always come into view.
  // A layout effect pins in the same task as the render: a browser scroll event that lands
  // after a render but before a later (passive) pin would read the new content as the reader
  // having scrolled up, and the log would stop following.
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const element = log.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [room.timeline]);
  // The log's own height changes too: the @mention chips arrive after the messages, the composer
  // grows or shrinks, the window is resized. A reader at the bottom stays at the bottom.
  useEffect(() => {
    const element = log.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { send: sendToRoom } = room;
  const send = useCallback(
    (text: string) => {
      atBottom.current = true;
      return sendToRoom(text);
    },
    [sendToRoom],
  );

  const loadErrorBox = room.loadError && (
    <div className="state-error" role="alert">
      <p>Could not load this room’s messages. {room.loadError.message}</p>
      {room.loadError.correlationId && <p className="mono">Reference {room.loadError.correlationId}</p>}
      <button type="button" className="btn btn-quiet btn-sm" onClick={room.reload}>
        Try again
      </button>
    </div>
  );

  return (
    <section className="room" data-room-state={room.phase} aria-labelledby="room-title">
      <header className="room-head">
        {agent ? (
          <>
            <Avatar src={agent.avatar} letter={agent.letter} size={52} />
            <div className="room-id">
              <h1 id="room-title" className="room-title">
                {agent.name}
              </h1>
              <p className="room-sub">
                {agent.capability} <span className="badge">{AUTONOMY_LABELS[agent.autonomyLevel]}</span>{' '}
                <span className="room-owner">Human owner: {agent.humanOwner}</span>
              </p>
              <p className="note">
                1:1 room: only {agent.name} answers here. For several views, ask in the <Link href="/team">team chat</Link>.
                {selection.selected && !agent.locked && !selection.selected.has(agent.id) && (
                  <> Not selected for this DD: the team chat leaves this agent out until you switch it on.</>
                )}
              </p>
            </div>
          </>
        ) : (
          <div className="room-id">
            <h1 id="room-title" className="room-title">
              Team chat
            </h1>
            <p className="note">
              Mention agents with @Name to bring them in (up to 4). Without a mention, routing picks up to 3 selected
              specialists by topic
              {orchestrator ? `; if nobody fits, ${orchestrator.name} answers and names who fits` : ''}.
              {synthesiser ? ` ${synthesiser.name} sums up unverified views after 2 or more contributions.` : ''}
            </p>
          </div>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-sm room-new"
          disabled={room.busy || room.data === null}
          onClick={() => void room.newConversation()}
        >
          New conversation
        </button>
      </header>

      {health.status === 'ready' && health.report && !health.report.llm.configured && <SetupBanner llm={health.report.llm} />}
      {agent?.teamRole === 'evidence-checker' && <EvidenceBanner name={agent.name} />}

      <div
        ref={log}
        className="log"
        role="log"
        aria-label="Messages"
        aria-live="polite"
        aria-busy={room.busy}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        {room.data === null && room.phase === 'loading' && (
          <p className="state-line" aria-busy="true">
            Loading messages…
          </p>
        )}
        {room.data === null && loadErrorBox}
        {empty && (
          <p className="state-line">
            No messages yet. {isTeam ? 'Ask the team a question.' : `Ask ${agent?.name ?? 'this agent'} a question.`}
          </p>
        )}
        {room.timeline.map((item) => {
          switch (item.kind) {
            case 'human':
              return <HumanBubble key={item.key} text={item.text} pending={item.pending} />;
            case 'agent':
              return <AgentBubble key={item.key} item={item} agent={agentsById.get(item.agentId)} />;
            case 'line':
              return (
                <SystemLine
                  key={item.key}
                  tone={item.tone}
                  text={item.text}
                  errorCode={item.errorCode}
                  correlationId={item.correlationId}
                />
              );
            case 'turn':
              return <TurnPanel key={item.key} turn={item.turn} />;
          }
        })}
        {room.phase === 'polling' && <p className="sysline">In progress. Checking for the result every 2 seconds…</p>}
        {room.data !== null && loadErrorBox}
      </div>

      {room.notice && (
        <div
          className={room.notice.tone === 'error' ? 'notice notice-error' : 'notice'}
          role={room.notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{room.notice.text}</span>
          {room.notice.correlationId && <span className="mono"> Reference {room.notice.correlationId}</span>}
          <button type="button" className="btn btn-quiet btn-sm" onClick={room.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      <p className="visually-hidden" role="status">
        {LIVE_STATUS[room.phase]}
      </p>

      <Composer
        label={agent ? `Message ${agent.name}` : 'Message the team'}
        placeholder={agent ? `Ask ${agent.name} a question…` : 'Ask the team. Use @Name to bring in specific agents…'}
        onSend={send}
        disabled={disabled}
        disabledReason={disabledReason}
        mentionChips={mentionChips}
        starterPrompts={starterPrompts}
        demoPrompts={isTeam ? TEAM_DEMO_PROMPTS : undefined}
        demoPromptsOpenByDefault={empty}
      />
    </section>
  );
}
