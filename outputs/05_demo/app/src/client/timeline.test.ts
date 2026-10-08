import { describe, expect, it } from 'vitest';
import type { ChatEvent, RouteDecision, TurnTrace } from '@/shared/contracts';
import { ROSTER, makeMessage, makeTurn, roomData } from './test-fixtures';
import {
  applyChatEvent,
  buildTimeline,
  detachLiveTurn,
  retainAfterReload,
  startLiveTurn,
  type LiveTurn,
  type TimelineItem,
} from './timeline';

const nameOf = (id: string) => ROSTER.find((agent) => agent.id === id)?.name ?? id;

/** A readable one-line rendering of an item, so expectations stay literal. */
function show(item: TimelineItem): string {
  switch (item.kind) {
    case 'human':
      return `${item.pending ? 'you (sending)' : 'you'}: ${item.text}`;
    case 'agent': {
      const flags = [item.state, item.truncated ? 'cut off' : '', item.unsaved ? 'unsaved' : ''].filter(Boolean);
      return `${item.agentName} [${flags.join(', ')}]: ${item.text}`;
    }
    case 'line':
      return `${item.tone}: ${item.text}`;
    case 'turn':
      return `panel ${item.turn.id}`;
  }
}

function run(live: LiveTurn, events: ChatEvent[]): LiveTurn {
  return events.reduce((state, event) => applyChatEvent(state, event, nameOf), live);
}

const EMPTY = roomData([], []);

const KEYWORD_ROUTE: RouteDecision = {
  source: 'keyword',
  primary: 'reglead',
  secondaries: ['cmcreg'],
  notConsulted: [
    { agentId: 'label', reason: 'over_cap' },
    { agentId: 'intel', reason: 'over_cap' },
  ],
  notes: [],
  synthesis: true,
};

const TURN_EVENT: ChatEvent = {
  type: 'turn',
  turnId: 't1',
  threadId: 'th1',
  roomId: 'team',
  clientTurnId: 'c1',
  userMessageId: 'u1',
  startedAt: '2026-10-07T09:00:00.000Z',
};

describe('buildTimeline from saved data', () => {
  it('lists saved messages by seq as your text, agent replies and notes', () => {
    const data = roomData(
      [
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Start with the designation.', seq: 3 }),
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'What first?', seq: 1 }),
        makeMessage({ id: 'n1', turnId: 't1', author: 'note', text: 'Lena is not selected for this DD.', seq: 2 }),
      ],
      [makeTurn({ id: 't1' })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: What first?',
      'note: Lena is not selected for this DD.',
      'Rosa [complete]: Start with the designation.',
    ]);
  });

  it('keeps the agent name saved with the message, even if the roster changed since', () => {
    const data = roomData(
      [makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosalind', text: 'Hi.' })],
      [makeTurn({ id: 't1' })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual(['Rosalind [complete]: Hi.']);
  });

  it('shows "matched, not consulted" after the question and "had nothing to add" at the end of the turn', () => {
    const trace: TurnTrace = {
      route: KEYWORD_ROUTE,
      agents: [
        { agentId: 'reglead', agentName: 'Rosa', role: 'primary', state: 'answered', messageId: 'a1', model: 'model-a', durationMs: 900 },
        { agentId: 'cmcreg', agentName: 'Carlos', role: 'secondary', state: 'no_addition', durationMs: 400 },
        { agentId: 'label', agentName: 'Lena', role: 'secondary', state: 'not_consulted', reason: 'over_cap' },
        { agentId: 'intel', agentName: 'Ines', role: 'secondary', state: 'not_consulted', reason: 'over_cap' },
      ],
    };
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Orphan question', seq: 1 }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Answer.', seq: 2 }),
      ],
      [makeTurn({ id: 't1', trace })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Orphan question',
      'note: Lena and Ines matched, not consulted.',
      'Rosa [complete]: Answer.',
      'note: Carlos had nothing to add.',
      'panel t1',
    ]);
  });

  it('does not repeat "had nothing to add" when the server saved it as a message', () => {
    const trace: TurnTrace = {
      route: { ...KEYWORD_ROUTE, notConsulted: [] },
      agents: [{ agentId: 'cmcreg', agentName: 'Carlos', role: 'secondary', state: 'no_addition', messageId: 'n9' }],
    };
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'n9', turnId: 't1', author: 'note', text: 'Carlos had nothing to add.', seq: 2 }),
      ],
      [makeTurn({ id: 't1', trace })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Carlos had nothing to add.',
      'panel t1',
    ]);
  });

  it('adds a turn-level error line with the correlation id when no message carries it', () => {
    const data = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })],
      [makeTurn({ id: 't1', status: 'error', errorCode: 'llm_timeout', correlationId: 'corr-77' })],
    );

    const items = buildTimeline(data, null, nameOf);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'line', tone: 'error', errorCode: 'llm_timeout', correlationId: 'corr-77' });
  });

  it('does not add the turn-level error line when the failed reply already shows it', () => {
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({
          id: 'a1',
          turnId: 't1',
          author: 'agent',
          agentId: 'reglead',
          agentName: 'Rosa',
          status: 'error',
          errorCode: 'llm_timeout',
          correlationId: 'corr-77',
          seq: 2,
        }),
      ],
      [makeTurn({ id: 't1', status: 'error', errorCode: 'llm_timeout', correlationId: 'corr-77' })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual(['you: Q', 'Rosa [error]: ']);
  });

  it('says so when a turn was interrupted by a restart', () => {
    const data = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })],
      [makeTurn({ id: 't1', status: 'interrupted' })],
    );

    const last = buildTimeline(data, null, nameOf).at(-1);

    expect(last).toMatchObject({ kind: 'line', tone: 'error' });
    expect(last?.kind === 'line' && last.text).toMatch(/interrupted/i);
  });

  it('after a restart that saved no reply, says no reply was saved, never that text was kept', () => {
    const data = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })],
      [makeTurn({ id: 't1', status: 'interrupted' })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Q',
      'error: This turn was interrupted: the server restarted while it ran. No reply was saved.',
    ]);
  });

  it('after a restart that came between replies, says the finished ones are kept and a running one was lost', () => {
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'First answer.', seq: 2 }),
      ],
      [makeTurn({ id: 't1', status: 'interrupted' })],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Q',
      'Rosa [complete]: First answer.',
      'error: This turn was interrupted: the server restarted while it ran. Replies that had finished are kept; a reply still running then was lost.',
    ]);
  });

  it('shows "How this turn ran" only for finished turns that have a trace', () => {
    const trace: TurnTrace = { route: { ...KEYWORD_ROUTE, notConsulted: [] }, agents: [] };
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'One', seq: 1 }),
        makeMessage({ id: 'u2', turnId: 't2', author: 'human', text: 'Two', seq: 2 }),
        makeMessage({ id: 'u3', turnId: 't3', author: 'human', text: 'Three', seq: 3 }),
      ],
      [
        makeTurn({ id: 't1', trace }),
        makeTurn({ id: 't2', trace: null }),
        makeTurn({ id: 't3', trace, status: 'running', finishedAt: null }),
      ],
    );

    // The running turn has no panel yet; its route's speakers show as pending instead.
    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: One',
      'panel t1',
      'you: Two',
      'you: Three',
      'Rosa [thinking]: ',
      'Carlos [waiting]: ',
    ]);
  });
});

describe('a turn running on the server that this tab is not streaming (after a reload or a room switch)', () => {
  const runningTurn = (agents: TurnTrace['agents'] = []) =>
    makeTurn({ id: 't1', status: 'running', finishedAt: null, trace: { route: KEYWORD_ROUTE, agents } });

  it('shows the agents of its route, with their names, as thinking and waiting', () => {
    const data = roomData([makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })], [runningTurn()]);

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Lena and Ines matched, not consulted.',
      'Rosa [thinking]: ',
      'Carlos [waiting]: ',
    ]);
  });

  it('once the first answer is saved, shows the agents still to come as thinking', () => {
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Answer.', seq: 2 }),
      ],
      [runningTurn([{ agentId: 'reglead', agentName: 'Rosa', role: 'primary', state: 'answered', messageId: 'a1' }])],
    );

    expect(buildTimeline(data, null, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Lena and Ines matched, not consulted.',
      'Rosa [complete]: Answer.',
      'Carlos [thinking]: ',
    ]);
  });

  it('adds nothing for agents the live stream of this tab already shows', () => {
    const live = run(startLiveTurn('Q', {}), [TURN_EVENT, { type: 'route', route: KEYWORD_ROUTE }]);
    const data = roomData([makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })], [runningTurn()]);

    expect(buildTimeline(data, live, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Lena and Ines matched, not consulted.',
      'Rosa [thinking]: ',
      'Carlos [waiting]: ',
    ]);
  });

  it('shows nothing extra once the turn has finished (positive control)', () => {
    const data = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 })],
      [makeTurn({ id: 't1', status: 'error', trace: { route: KEYWORD_ROUTE, agents: [] } })],
    );

    expect(buildTimeline(data, null, nameOf).map((item) => item.kind)).not.toContain('agent');
  });
});

describe('live turn', () => {
  it('shows your text at once and, in a 1:1 room, a thinking bubble for that agent', () => {
    const live = startLiveTurn('Hello Rosa', { soloAgentId: 'reglead' });

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual(['you (sending): Hello Rosa', 'Rosa [thinking]: ']);
  });

  it('in the team chat, names nobody until the route arrives', () => {
    const live = startLiveTurn('Hello team', {});

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual(['you (sending): Hello team']);
  });

  it('builds bubbles from route, agent_start, delta and agent_end', () => {
    const live = run(startLiveTurn('Orphan question', {}), [
      TURN_EVENT,
      { type: 'route', route: KEYWORD_ROUTE },
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'delta', messageId: 'm1', text: 'Check the ' },
      { type: 'delta', messageId: 'm1', text: 'designation.' },
      { type: 'agent_end', messageId: 'm1', status: 'complete', truncated: true },
    ]);

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual([
      'you: Orphan question',
      'note: Lena and Ines matched, not consulted.',
      'Rosa [complete, cut off]: Check the designation.',
      'Carlos [waiting]: ',
    ]);
  });

  it('keeps the partial text when an error arrives for a reply', () => {
    const live = run(startLiveTurn('Q', { soloAgentId: 'reglead' }), [
      TURN_EVENT,
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'solo' },
      { type: 'delta', messageId: 'm1', text: 'Half an answer' },
      { type: 'error', code: 'llm_network', correlationId: 'corr-5', messageId: 'm1' },
    ]);

    const bubble = buildTimeline(EMPTY, live, nameOf)[1];

    expect(bubble).toMatchObject({
      kind: 'agent',
      agentName: 'Rosa',
      text: 'Half an answer',
      state: 'error',
      errorCode: 'llm_network',
      correlationId: 'corr-5',
    });
  });

  it('adds a turn-level error line for an error without a message id', () => {
    const live = run(startLiveTurn('Q', {}), [TURN_EVENT, { type: 'error', code: 'llm_config', correlationId: 'corr-9' }]);

    expect(buildTimeline(EMPTY, live, nameOf).at(-1)).toMatchObject({
      kind: 'line',
      tone: 'error',
      errorCode: 'llm_config',
      correlationId: 'corr-9',
    });
  });

  it('replaces a waiting bubble with "had nothing to add"', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'route', route: { ...KEYWORD_ROUTE, notConsulted: [] } },
      { type: 'agent_start', agentId: 'cmcreg', messageId: 'm2', role: 'secondary' },
      { type: 'no_addition', agentId: 'cmcreg', messageId: 'm2' },
    ]);

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual([
      'you: Q',
      'Rosa [thinking]: ',
      'note: Carlos had nothing to add.',
    ]);
  });

  it('shows note events once, even if the same note arrives twice', () => {
    const note: ChatEvent = { type: 'note', text: 'Oskar joins by rule, not by mention.', messageId: 'n1' };
    const live = run(startLiveTurn('Q', {}), [TURN_EVENT, note, note]);

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Oskar joins by rule, not by mention.',
    ]);
  });

  it('places routing notes where the saved thread has them: after "matched, not consulted", before agents that have not started', () => {
    const note = 'Oona is not selected for this DD; switch them on in the team overview to bring them in.';
    const live = run(startLiveTurn('Q', {}), [TURN_EVENT, { type: 'route', route: KEYWORD_ROUTE }, { type: 'note', text: note, messageId: 'n1' }]);
    const saved = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'n1', turnId: 't1', author: 'note', text: note, seq: 2 }),
      ],
      [makeTurn({ id: 't1', status: 'running', finishedAt: null, trace: { route: KEYWORD_ROUTE, agents: [] } })],
    );

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual([
      'you: Q',
      'note: Lena and Ines matched, not consulted.',
      `note: ${note}`,
      'Rosa [thinking]: ',
      'Carlos [waiting]: ',
    ]);
    expect(buildTimeline(saved, null, nameOf).map(show).slice(0, 3)).toEqual([
      'you: Q',
      'note: Lena and Ines matched, not consulted.',
      `note: ${note}`,
    ]);
  });

  it('puts a note that follows a finished answer below that answer', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'route', route: { ...KEYWORD_ROUTE, notConsulted: [] } },
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'agent_end', messageId: 'm1', status: 'error', truncated: false },
      { type: 'note', text: 'Carlos was not asked: Rosa’s reply failed.', messageId: 'n2' },
    ]);

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual([
      'you: Q',
      'Rosa [error]: ',
      'note: Carlos was not asked: Rosa’s reply failed.',
      'Carlos [waiting]: ',
    ]);
  });

  it('drops bubbles that never started once the turn is done', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'route', route: { ...KEYWORD_ROUTE, notConsulted: [] } },
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'agent_end', messageId: 'm1', status: 'error', truncated: false },
      { type: 'done', turnId: 't1', status: 'error' },
    ]);

    expect(buildTimeline(EMPTY, live, nameOf).map(show)).toEqual(['you: Q', 'Rosa [error]: ']);
  });

  it('hides live items the saved data already holds', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'delta', messageId: 'm1', text: 'Saved reply' },
    ]);
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'm1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Saved reply', seq: 2 }),
      ],
      [makeTurn({ id: 't1', status: 'running', finishedAt: null })],
    );

    expect(buildTimeline(data, live, nameOf).map(show)).toEqual(['you: Q', 'Rosa [complete]: Saved reply']);
  });
});

describe('detachLiveTurn and retainAfterReload', () => {
  it('when the stream is lost, drops empty bubbles and marks replies in progress as detached', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'route', route: { ...KEYWORD_ROUTE, notConsulted: [] } },
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'delta', messageId: 'm1', text: 'So far' },
    ]);

    expect(buildTimeline(EMPTY, detachLiveTurn(live), nameOf).map(show)).toEqual([
      'you: Q',
      'Rosa [detached]: So far',
    ]);
  });

  it('after the final reload keeps only replies with text that the server did not save', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'delta', messageId: 'm1', text: 'Saved' },
      { type: 'agent_start', agentId: 'cmcreg', messageId: 'm2', role: 'secondary' },
      { type: 'delta', messageId: 'm2', text: 'Lost on the server' },
    ]);
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'm1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Saved', seq: 2 }),
      ],
      [makeTurn({ id: 't1' })],
    );

    const kept = retainAfterReload(live, data);

    expect(buildTimeline(data, kept, nameOf).map(show)).toEqual([
      'you: Q',
      'Rosa [complete]: Saved',
      'Carlos [partial, unsaved]: Lost on the server',
    ]);
  });

  it('keeps an unsaved reply next to its own turn when newer turns follow', () => {
    const live = run(startLiveTurn('First', {}), [
      TURN_EVENT,
      { type: 'agent_start', agentId: 'cmcreg', messageId: 'm2', role: 'secondary' },
      { type: 'delta', messageId: 'm2', text: 'Only copy' },
    ]);
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'First', seq: 1 }),
        makeMessage({ id: 'u2', turnId: 't2', author: 'human', text: 'Second', seq: 2 }),
      ],
      [makeTurn({ id: 't1' }), makeTurn({ id: 't2' })],
    );

    const kept = retainAfterReload(live, data);

    expect(kept).not.toBeNull();
    expect(buildTimeline(data, kept ? [kept] : [], nameOf).map(show)).toEqual([
      'you: First',
      'Carlos [partial, unsaved]: Only copy',
      'you: Second',
    ]);
  });

  it('returns null when the server saved everything', () => {
    const live = run(startLiveTurn('Q', {}), [
      TURN_EVENT,
      { type: 'agent_start', agentId: 'reglead', messageId: 'm1', role: 'primary' },
      { type: 'delta', messageId: 'm1', text: 'Saved' },
    ]);
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Q', seq: 1 }),
        makeMessage({ id: 'm1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Saved', seq: 2 }),
      ],
      [makeTurn({ id: 't1' })],
    );

    expect(retainAfterReload(live, data)).toBeNull();
  });
});
