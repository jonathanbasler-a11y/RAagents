import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extraSpec, fixtureSpec, fixtureSpecs } from '@/server/agents/test-fixtures';
import { createLlmClient } from '@/server/llm';
import {
  DONE_EVENT,
  REPORTED_MODEL,
  captureLogs,
  chunkEvent,
  createFakeFetch,
  hangUntilAborted,
  jsonResponse,
  sseResponse,
  testConfig,
  type FakeStep,
  type RecordedCall,
} from '@/server/llm/test-support/fake-gateway';
import { startTurn, type TurnRunnerDeps } from '@/server/chat/turn-runner';
import { FROZEN_NOW, gate, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import type { AgentSpec, ChatEvent, LlmMessage, Message } from '@/shared/contracts';
import { isNoAddition, teamExecutor, type TeamDeps } from './team';

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  temp.cleanup();
});

// Rosa (lead), Carlos (cmc), Lena (labels, not selected), Oskar (conductor), Ruben (critic),
// Sofia (summary), plus Dara (dosing) and Pia (paeds), both selected.
function roster(): AgentSpec[] {
  return [
    ...fixtureSpecs(),
    extraSpec(),
    {
      ...fixtureSpec('lead'),
      id: 'paeds',
      name: 'Pia',
      letter: 'P',
      capability: 'Paediatric specialist',
      group: 'spec',
      order: 8,
      routing: { keywords: ['paediatric'], acronyms: ['PIP'] },
      handoffs: [],
    },
  ];
}

function setup(steps: FakeStep[], overrides: Partial<TeamDeps> = {}) {
  const agents = roster();
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const fake = createFakeFetch(steps);
  const deps: TeamDeps = {
    store: temp.store,
    agents,
    selected: new Set(agents.filter((agent) => agent.locked || agent.defaultSelected).map((agent) => agent.id)),
    getAgent: (id) => byId.get(id),
    llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
    now: () => FROZEN_NOW,
    newId: sequentialIds('msg'),
    log: console,
    ...overrides,
  };
  return { fake, deps };
}

function run(deps: TeamDeps, text: string, runner: Partial<TurnRunnerDeps> = {}) {
  const outcome = startTurn(
    { roomId: 'team', clientTurnId: `client-${text.length}`, text, timeZone: 'Europe/Paris' },
    teamExecutor(deps),
    { store: temp.store, bootId: 'boot-1', workspaceId: 'demo', now: () => FROZEN_NOW, newId: sequentialIds('runner'), log: console, ...runner },
  );
  if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
  const events: ChatEvent[] = [];
  outcome.channel.subscribe((event) => events.push(event));
  return { ...outcome, events };
}

const okStream = (...parts: string[]) =>
  sseResponse([...parts.map((part, index) => chunkEvent(part, { role: index === 0 })), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT]);

const systemOf = (call: RecordedCall) => (call.body.messages as LlmMessage[])[0].content;
const agentNameOf = (call: RecordedCall) => /^You are ([^.\n]+)\. Your capability:/m.exec(systemOf(call))?.[1] ?? '?';

/** One step per possible call; each answers with the reply scripted for the agent the prompt names. */
function byAgent(replies: Record<string, (call: RecordedCall) => Response | Promise<Response>>, calls = 6): FakeStep[] {
  const step: FakeStep = (call) => {
    const reply = replies[agentNameOf(call)];
    if (!reply) throw new Error(`no scripted reply for ${agentNameOf(call)}`);
    return reply(call);
  };
  return Array.from({ length: calls }, () => step);
}

function callFor(calls: RecordedCall[], name: string): RecordedCall {
  const call = calls.find((entry) => agentNameOf(entry) === name);
  if (!call) throw new Error(`${name} was not called`);
  return call;
}

const shown = (messages: Message[]) => messages.map((message) => [message.author, message.agentName, message.text]);
const startOf = (events: ChatEvent[], agentId: string) =>
  events.find((event): event is Extract<ChatEvent, { type: 'agent_start' }> => event.type === 'agent_start' && event.agentId === agentId);
const fenced = (from: string, text: string) =>
  new RegExp(`BEGIN UNTRUSTED TEXT (\\w+) \\(from: ${from}[^)]*\\)\\n${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nEND UNTRUSTED TEXT \\1`);

const QUESTION = '@Rosa @Carlos what are the main risks?';

describe('teamExecutor: a turn with two @mentions', () => {
  it('streams the first answer, adds the second complete, then Sofia sums up; saves all of it in order and finishes done', async () => {
    const { fake, deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa ', 'answer.'),
        Carlos: () => okStream('Carlos ', 'adds ', 'a risk.'),
        Sofia: () => okStream('Summary.'),
      }),
    );

    const turn = run(deps, QUESTION);
    const finished = await turn.finished;

    expect(turn.events.map((event) => event.type)).toEqual([
      'turn',
      'route',
      'agent_start',
      'delta',
      'delta',
      'agent_end',
      'agent_start',
      'delta',
      'agent_end',
      'agent_start',
      'delta',
      'agent_end',
      'done',
    ]);
    expect(turn.events[1]).toEqual({
      type: 'route',
      route: { source: 'explicit', primary: 'lead', secondaries: ['cmc'], notConsulted: [], notes: [], synthesis: true },
    });
    const rosa = startOf(turn.events, 'lead');
    const carlos = startOf(turn.events, 'cmc');
    const sofia = startOf(turn.events, 'summary');
    expect([rosa?.role, carlos?.role, sofia?.role]).toEqual(['primary', 'secondary', 'synthesis']);
    // The secondary's reply arrives whole, as one delta.
    expect(turn.events.filter((event) => event.type === 'delta' && event.messageId === carlos?.messageId)).toEqual([
      { type: 'delta', messageId: carlos?.messageId, text: 'Carlos adds a risk.' },
    ]);

    expect(shown(temp.store.listMessages(turn.thread.id))).toEqual([
      ['human', null, QUESTION],
      ['agent', 'Rosa', 'Rosa answer.'],
      ['agent', 'Carlos', 'Carlos adds a risk.'],
      ['agent', 'Sofia', 'Summary.'],
    ]);
    expect(finished).toMatchObject({ status: 'done', errorCode: null });
    expect(finished.trace).toEqual({
      route: { source: 'explicit', primary: 'lead', secondaries: ['cmc'], notConsulted: [], notes: [], synthesis: true },
      agents: [
        { agentId: 'lead', agentName: 'Rosa', role: 'primary', state: 'answered', messageId: rosa?.messageId, model: REPORTED_MODEL, durationMs: 0, truncated: false },
        { agentId: 'cmc', agentName: 'Carlos', role: 'secondary', state: 'answered', messageId: carlos?.messageId, model: REPORTED_MODEL, durationMs: 0, truncated: false },
        { agentId: 'summary', agentName: 'Sofia', role: 'synthesis', state: 'answered', messageId: sofia?.messageId, model: REPORTED_MODEL, durationMs: 0, truncated: false },
      ],
    });
    expect(fake.calls).toHaveLength(3);
    expect(turn.events.at(-1)).toEqual({ type: 'done', turnId: turn.turn.id, status: 'done' });
  });

  it('shows the secondary the first answer and Sofia every contribution, fenced; only secondaries are told about NO_ADDITION', async () => {
    const { fake, deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        Carlos: () => okStream('Carlos adds a risk.'),
        Sofia: () => okStream('Summary.'),
      }),
    );

    await run(deps, QUESTION).finished;

    const rosa = systemOf(callFor(fake.calls, 'Rosa'));
    const carlos = systemOf(callFor(fake.calls, 'Carlos'));
    const sofia = systemOf(callFor(fake.calls, 'Sofia'));
    expect(carlos).toMatch(fenced('Rosa', 'Rosa answer.'));
    expect(sofia).toMatch(fenced('Rosa', 'Rosa answer.'));
    expect(sofia).toMatch(fenced('Carlos', 'Carlos adds a risk.'));
    expect(carlos).toContain('NO_ADDITION');
    expect(rosa).not.toContain('NO_ADDITION');
    expect(sofia).not.toContain('NO_ADDITION');
    for (const system of [rosa, carlos, sofia]) expect(system).toContain('Room: the team chat');
    for (const call of fake.calls) expect((call.body.messages as LlmMessage[]).slice(1)).toEqual([{ role: 'user', content: QUESTION }]);
  });

  it('saves the route as soon as it is known, and each finished answer while the others still run', async () => {
    const hold = gate();
    const { deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        Carlos: async () => {
          await hold.promise;
          return okStream('Carlos adds a risk.');
        },
        Sofia: () => okStream('Summary.'),
      }),
    );

    const turn = run(deps, QUESTION);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const saved = temp.store.getTurn(turn.turn.id);
    expect(saved?.status).toBe('running');
    expect(saved?.trace?.route).toMatchObject({ source: 'explicit', primary: 'lead', secondaries: ['cmc'] });
    expect(saved?.trace?.agents.map((outcome) => [outcome.agentId, outcome.state])).toEqual([['lead', 'answered']]);
    hold.release();
    await turn.finished;
  });
});

describe('teamExecutor: "nothing to add"', () => {
  it('turns a NO_ADDITION reply into "had nothing to add", saves a note instead of a reply, and Sofia waits for 2 contributions', async () => {
    const { fake, deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        Carlos: () => okStream('NOTHING_', 'TO_ADD'),
      }),
    );

    const turn = run(deps, QUESTION);
    const finished = await turn.finished;

    const carlos = startOf(turn.events, 'cmc');
    expect(turn.events.filter((event) => 'messageId' in event && event.messageId === carlos?.messageId)).toEqual([
      { type: 'agent_start', agentId: 'cmc', messageId: carlos?.messageId, role: 'secondary' },
      { type: 'no_addition', agentId: 'cmc', messageId: carlos?.messageId },
    ]);
    const messages = temp.store.listMessages(turn.thread.id);
    expect(shown(messages)).toEqual([
      ['human', null, QUESTION],
      ['agent', 'Rosa', 'Rosa answer.'],
      ['note', null, 'Carlos had nothing to add.'],
    ]);
    expect(messages[2].id).toBe(carlos?.messageId);
    expect(finished.status).toBe('done');
    expect(finished.trace?.agents.slice(1)).toEqual([
      { agentId: 'cmc', agentName: 'Carlos', role: 'secondary', state: 'no_addition', messageId: carlos?.messageId, model: REPORTED_MODEL, durationMs: 0, truncated: false },
      { agentId: 'summary', agentName: 'Sofia', role: 'synthesis', state: 'not_consulted', reason: 'too_few_contributions' },
    ]);
    expect(fake.calls).toHaveLength(2);
  });

  it.each([
    ['NO_ADDITION', true],
    [' no_addition \n', true],
    ['**NO_ADDITION**', true],
    ['`NO_ADDITION`', true],
    ['Nothing to add.', true],
    ['NOTHING TO ADD', true],
    ['"Nothing to add"', true],
    ['NO_ADDITION - Rosa covered the CMC side.', true],
    ['', false],
    ['Carlos adds a risk.', false],
    ['Nothing to add on comparability, but the stability data need a check before filing because shelf life drives the label.', false],
    ['There is something to add: NO_ADDITION is not right here.', false],
    ['No additional concerns from the CMC side.', false],
    ['No addition', true],
  ])('reads %j as nothing to add: %s', (text, expected) => {
    expect(isNoAddition(text)).toBe(expected);
  });
});

describe('teamExecutor: failures', () => {
  it('skips the secondaries with a note when the first answer fails, and ends the turn as error with its reference', async () => {
    const logs = captureLogs();
    const { fake, deps } = setup(byAgent({ Rosa: () => jsonResponse({ error: { message: 'bad request' } }, 400) }));

    const turn = run(deps, QUESTION);
    const finished = await turn.finished;

    const messages = temp.store.listMessages(turn.thread.id);
    expect(shown(messages)).toEqual([
      ['human', null, QUESTION],
      ['agent', 'Rosa', ''],
      ['note', null, 'Carlos was not asked: Rosa’s reply failed.'],
    ]);
    const rosa = messages[1];
    expect(rosa).toMatchObject({ status: 'error', errorCode: 'llm_request' });
    expect(turn.events).toContainEqual({ type: 'note', text: 'Carlos was not asked: Rosa’s reply failed.', messageId: messages[2].id });
    expect(finished).toMatchObject({ status: 'error', errorCode: 'llm_request', correlationId: rosa.correlationId });
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.state, outcome.reason ?? outcome.errorCode])).toEqual([
      ['lead', 'failed', 'llm_request'],
      ['cmc', 'not_consulted', 'primary_failed'],
      ['summary', 'not_consulted', 'too_few_contributions'],
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(logs.errors().join('\n')).toContain(rosa.correlationId as string);
  });

  it('keeps going when one secondary fails: the others and Sofia still answer, and the turn is partial', async () => {
    captureLogs();
    const { fake, deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        Carlos: () => jsonResponse({ error: { message: 'bad request' } }, 400),
        Dara: () => okStream('Dara adds a dosing point.'),
        Sofia: () => okStream('Summary.'),
      }),
    );

    const turn = run(deps, '@Rosa @Carlos @Dara your views?');
    const finished = await turn.finished;

    expect(shown(temp.store.listMessages(turn.thread.id))).toEqual([
      ['human', null, '@Rosa @Carlos @Dara your views?'],
      ['agent', 'Rosa', 'Rosa answer.'],
      ['agent', 'Carlos', ''],
      ['agent', 'Dara', 'Dara adds a dosing point.'],
      ['agent', 'Sofia', 'Summary.'],
    ]);
    expect(finished).toMatchObject({ status: 'partial', errorCode: 'llm_request' });
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.state])).toEqual([
      ['lead', 'answered'],
      ['cmc', 'failed'],
      ['dosing', 'answered'],
      ['summary', 'answered'],
    ]);
    expect(fake.calls).toHaveLength(4);
  });

  it('says so in the thread when a secondary cannot be asked at all, and the turn is partial', async () => {
    const logs = captureLogs();
    const agents = roster();
    const { fake, deps } = setup(byAgent({ Rosa: () => okStream('Rosa answer.') }), {
      // Carlos left the roster after routing: runAgent refuses him before any model call.
      getAgent: (id) => (id === 'cmc' ? undefined : agents.find((agent) => agent.id === id)),
    });

    const turn = run(deps, QUESTION);
    const finished = await turn.finished;

    const messages = temp.store.listMessages(turn.thread.id);
    expect(shown(messages).map(([author, , text]) => [author, text])).toEqual([
      ['human', QUESTION],
      ['agent', 'Rosa answer.'],
      ['note', expect.stringMatching(/^Carlos could not be asked: something went wrong in the app \(reference \S+\)\.$/)],
    ]);
    expect(finished).toMatchObject({ status: 'partial', errorCode: 'internal' });
    expect(logs.errors().join('\n')).toContain(finished.correlationId as string);
    expect(messages[2].text).toContain(finished.correlationId as string);
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.state])).toEqual([
      ['lead', 'answered'],
      ['cmc', 'failed'],
      ['summary', 'not_consulted'],
    ]);
    expect(fake.calls).toHaveLength(1);
  });

  it('marks the summary out of time when the deadline passes before it can start, with a note', async () => {
    captureLogs();
    const { fake, deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        // Answers in full, but only once the turn deadline has passed.
        Carlos: async (call) => {
          await new Promise((resolve) => call.signal?.addEventListener('abort', resolve, { once: true }));
          return okStream('Carlos adds a risk.');
        },
      }),
    );

    const turn = run(deps, QUESTION, { turnDeadlineMs: 50 });
    const finished = await turn.finished;

    expect(finished).toMatchObject({ status: 'partial', errorCode: 'out_of_time' });
    expect(finished.trace?.agents.at(-1)).toEqual({ agentId: 'summary', agentName: 'Sofia', role: 'synthesis', state: 'out_of_time', errorCode: 'out_of_time' });
    expect(shown(temp.store.listMessages(turn.thread.id)).at(-1)).toEqual(['note', null, 'Sofia did not sum up: the turn ran out of time.']);
    expect(fake.calls).toHaveLength(2);
  });

  it('marks secondaries cut off by the turn deadline as out of time, distinct from failed, and finishes the turn as partial', async () => {
    captureLogs();
    const { deps } = setup(byAgent({ Rosa: () => okStream('Rosa answer.'), Carlos: hangUntilAborted, Dara: hangUntilAborted }));

    const turn = run(deps, '@Rosa @Carlos @Dara your views?', { turnDeadlineMs: 50 });
    const finished = await turn.finished;

    expect(finished.status).toBe('partial');
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.state, outcome.errorCode ?? outcome.reason])).toEqual([
      ['lead', 'answered', undefined],
      ['cmc', 'out_of_time', 'out_of_time'],
      ['dosing', 'out_of_time', 'out_of_time'],
      ['summary', 'not_consulted', 'too_few_contributions'],
    ]);
  });
});

describe('teamExecutor: routes and budget', () => {
  it('saves the routing notes before the replies and streams them as notes', async () => {
    const { deps } = setup(byAgent({ Rosa: () => okStream('Rosa answer.') }));

    const turn = run(deps, '@Lena @Rosa what goes in the label?');
    const finished = await turn.finished;

    const note = 'Lena is not selected for this DD; switch them on in the team overview to bring them in.';
    const messages = temp.store.listMessages(turn.thread.id);
    expect(shown(messages)).toEqual([
      ['human', null, '@Lena @Rosa what goes in the label?'],
      ['note', null, note],
      ['agent', 'Rosa', 'Rosa answer.'],
    ]);
    expect(turn.events.map((event) => event.type).slice(0, 4)).toEqual(['turn', 'route', 'note', 'agent_start']);
    expect(turn.events[2]).toEqual({ type: 'note', text: note, messageId: messages[1].id });
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.role, outcome.state, outcome.reason])).toEqual([
      ['lead', 'primary', 'answered', undefined],
      ['labels', 'secondary', 'not_consulted', 'not_selected'],
    ]);
  });

  it('lets Oskar answer a question nobody matches, telling him who is selected so he can name who fits', async () => {
    const { fake, deps } = setup(byAgent({ Oskar: () => okStream('Ask Rosa.') }));

    const turn = run(deps, 'Hello team, what can you do?');
    const finished = await turn.finished;

    const system = systemOf(callFor(fake.calls, 'Oskar'));
    expect(system).toContain('Rosa (Regulatory lead)');
    expect(system).toContain('Carlos (CMC regulatory)');
    expect(system).not.toContain('Lena (Labelling)');
    expect(fake.calls).toHaveLength(1);
    expect(finished).toMatchObject({ status: 'done', trace: { route: { source: 'none', primary: 'conductor' } } });
    expect(startOf(turn.events, 'conductor')?.role).toBe('primary');
  });

  it('makes at most 5 model calls: 4 agents brought in plus the summary, the fifth mention matched but not consulted', async () => {
    const { fake, deps } = setup(
      byAgent(
        {
          Rosa: () => okStream('Rosa answer.'),
          Carlos: () => okStream('Carlos point.'),
          Dara: () => okStream('Dara point.'),
          Pia: () => okStream('Pia point.'),
          Ruben: () => okStream('Ruben challenge.'),
          Sofia: () => okStream('Summary.'),
        },
        5,
      ),
    );

    const finished = await run(deps, '@Rosa @Carlos @Dara @Pia @Ruben all of you, please').finished;

    expect(fake.calls).toHaveLength(5);
    expect(fake.calls.map(agentNameOf).sort()).toEqual(['Carlos', 'Dara', 'Pia', 'Rosa', 'Sofia']);
    expect(finished.trace?.agents.map((outcome) => [outcome.agentId, outcome.state])).toEqual([
      ['lead', 'answered'],
      ['cmc', 'answered'],
      ['dosing', 'answered'],
      ['paeds', 'answered'],
      ['critic', 'not_consulted'],
      ['summary', 'answered'],
    ]);
  });
});

describe('teamExecutor: order and context', () => {
  it('saves the secondaries in route order even when a later one finishes first', async () => {
    const hold = gate();
    const { deps } = setup(
      byAgent({
        Rosa: () => okStream('Rosa answer.'),
        Carlos: async () => {
          await hold.promise;
          return okStream('Carlos, late.');
        },
        Dara: () => okStream('Dara, early.'),
        Sofia: () => okStream('Summary.'),
      }),
    );

    const turn = run(deps, '@Rosa @Carlos @Dara your views?');
    setTimeout(() => hold.release(), 30);
    await turn.finished;

    const ends = turn.events.filter((event) => event.type === 'agent_end').map((event) => event.messageId);
    expect(ends.indexOf(startOf(turn.events, 'dosing')?.messageId as string)).toBeLessThan(
      ends.indexOf(startOf(turn.events, 'cmc')?.messageId as string),
    );
    expect(shown(temp.store.listMessages(turn.thread.id)).map(([, name]) => name)).toEqual([null, 'Rosa', 'Carlos', 'Dara', 'Sofia']);
  });

  it('gives team agents the last 8 human and specialist messages as fenced context, never summaries or notes', async () => {
    for (let index = 1; index <= 5; index += 1) {
      const { turn } = temp.store.startTurn({
        workspaceId: 'demo',
        roomId: 'team',
        clientTurnId: `old-${index}`,
        bootId: 'boot-1',
        deadlineAt: '2026-10-07T20:48:00.000Z',
      });
      temp.store.appendUserMessage({ turnId: turn.id, text: `old question ${index}` });
      const reply = { turnId: turn.id, agentVersion: '0.1.0', promptHash: null, model: null, status: 'complete' as const, truncated: false };
      temp.store.appendAgentMessage({ ...reply, id: `old-rosa-${index}`, agentId: 'lead', agentName: 'Rosa', text: `old reply ${index}` });
      temp.store.appendAgentMessage({ ...reply, id: `old-sofia-${index}`, agentId: 'summary', agentName: 'Sofia', text: `old summary ${index}` });
      temp.store.appendNote({ turnId: turn.id, text: `old note ${index}` });
      temp.store.finishTurn({ turnId: turn.id, status: 'done', trace: null });
    }
    const { fake, deps } = setup(byAgent({ Rosa: () => okStream('Rosa answer.') }));

    await run(deps, '@Rosa and now?').finished;

    const system = systemOf(callFor(fake.calls, 'Rosa'));
    for (let index = 2; index <= 5; index += 1) {
      expect(system).toMatch(fenced('a person in the team chat', `old question ${index}`));
      expect(system).toMatch(fenced('Rosa', `old reply ${index}`));
    }
    for (const left of ['old question 1', 'old reply 1', 'old summary', 'old note']) expect(system).not.toContain(left);
  });
});
