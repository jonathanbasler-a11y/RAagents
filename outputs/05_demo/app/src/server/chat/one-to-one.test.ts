import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureSpecs } from '@/server/agents/test-fixtures';
import { createLlmClient } from '@/server/llm';
import {
  DONE_EVENT,
  REPORTED_MODEL,
  captureLogs,
  chunkEvent,
  createFakeFetch,
  jsonResponse,
  socketClosed,
  sseResponse,
  testConfig,
  type FakeStep,
} from '@/server/llm/test-support/fake-gateway';
import { historyForTurn, oneToOneExecutor, type OneToOneDeps } from '@/server/chat/one-to-one';
import { startTurn, type StartTurnInput } from '@/server/chat/turn-runner';
import { FROZEN_NOW, gate, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import { hashPrompt } from '@/server/prompts';
import type { AgentSpec, ChatEvent, LlmMessage, Message } from '@/shared/contracts';

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(() => {
  temp.cleanup();
});

function lookup(specs: AgentSpec[] = fixtureSpecs()) {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return (id: string) => byId.get(id);
}

function setup(steps: FakeStep[], overrides: Partial<OneToOneDeps> = {}) {
  const fake = createFakeFetch(steps);
  const deps: OneToOneDeps = {
    store: temp.store,
    getAgent: lookup(),
    llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
    now: () => FROZEN_NOW,
    newId: sequentialIds('msg'),
    log: console,
    ...overrides,
  };
  return { fake, deps };
}

function run(deps: OneToOneDeps, agentId = 'lead', input: Partial<StartTurnInput> = {}) {
  const outcome = startTurn(
    { roomId: agentId, clientTurnId: 'client-new', text: 'What would you check first?', timeZone: 'Europe/Paris', ...input },
    oneToOneExecutor(agentId, deps),
    { store: temp.store, bootId: 'boot-1', workspaceId: 'demo', now: () => FROZEN_NOW, newId: sequentialIds('runner'), log: console },
  );
  if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
  const events: ChatEvent[] = [];
  outcome.channel.subscribe((event) => events.push(event));
  return { ...outcome, events };
}

const okStream = (...parts: string[]) =>
  sseResponse([...parts.map((part, index) => chunkEvent(part, { role: index === 0 })), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT]);

/** Saves finished exchanges in the lead's room, oldest first. */
function prefill(exchanges: Array<{ question: string; reply: string; status?: 'complete' | 'error' }>) {
  exchanges.forEach((exchange, index) => {
    const { turn } = temp.store.startTurn({
      workspaceId: 'demo',
      roomId: 'lead',
      clientTurnId: `old-${index}`,
      bootId: 'boot-1',
      deadlineAt: '2026-10-07T20:48:00.000Z',
    });
    temp.store.appendUserMessage({ turnId: turn.id, text: exchange.question });
    temp.store.appendAgentMessage({
      id: `old-reply-${index}`,
      turnId: turn.id,
      agentId: 'lead',
      agentName: 'Rosa',
      agentVersion: '0.1.0',
      promptHash: null,
      model: null,
      text: exchange.reply,
      status: exchange.status ?? 'complete',
      truncated: false,
    });
    temp.store.finishTurn({ turnId: turn.id, status: exchange.status === 'error' ? 'error' : 'done', trace: null });
  });
}

const DIRECT_ROUTE = { source: 'direct', primary: 'lead', secondaries: [], notConsulted: [], notes: [], synthesis: false };

describe('oneToOneExecutor: a normal turn', () => {
  it('streams route, agent_start, deltas and agent_end, saves the reply under the agent_start id and finishes done with a direct trace', async () => {
    const { fake, deps } = setup([okStream('Check ', 'the label.')]);

    const turn = run(deps);
    const finished = await turn.finished;

    expect(turn.events.map((event) => event.type)).toEqual(['turn', 'route', 'agent_start', 'delta', 'delta', 'agent_end', 'done']);
    expect(turn.events[1]).toEqual({ type: 'route', route: DIRECT_ROUTE });
    const start = turn.events[2] as Extract<ChatEvent, { type: 'agent_start' }>;
    expect(start).toMatchObject({ agentId: 'lead', role: 'solo' });

    const reply = temp.store.listMessages(turn.thread.id).find((message) => message.author === 'agent');
    expect(reply).toMatchObject({
      id: start.messageId,
      turnId: turn.turn.id,
      agentId: 'lead',
      agentName: 'Rosa',
      agentVersion: '0.1.0',
      model: REPORTED_MODEL,
      status: 'complete',
      truncated: false,
      text: 'Check the label.',
      provenance: 'derived',
    });
    expect(reply?.promptHash).toBe(hashPrompt(fake.calls[0].body.messages as LlmMessage[]));

    expect(finished).toMatchObject({ status: 'done', errorCode: null });
    expect(finished.trace).toEqual({
      route: DIRECT_ROUTE,
      agents: [
        {
          agentId: 'lead',
          agentName: 'Rosa',
          role: 'solo',
          state: 'answered',
          messageId: start.messageId,
          model: REPORTED_MODEL,
          durationMs: 0,
          truncated: false,
        },
      ],
    });
    expect(turn.events.at(-1)).toEqual({ type: 'done', turnId: turn.turn.id, status: 'done' });
  });

  it('saves the route while the turn runs, so a reload in the middle can show it', async () => {
    const hold = gate();
    const { deps } = setup([
      async () => {
        await hold.promise;
        return okStream('Late');
      },
    ]);

    const turn = run(deps);
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(temp.store.getTurn(turn.turn.id)).toMatchObject({ status: 'running', trace: { route: DIRECT_ROUTE, agents: [] } });
    hold.release();
    await turn.finished;
  });

  it('puts the browser time zone into the prompt', async () => {
    const { fake, deps } = setup([okStream('Hi')]);

    await run(deps, 'lead', { timeZone: 'Asia/Tokyo' }).finished;

    expect((fake.calls[0].body.messages as LlmMessage[])[0].content).toContain('Asia/Tokyo');
  });
});

describe('oneToOneExecutor: history', () => {
  it('sends the last valid messages of the active thread, ending with the question, with a note when earlier ones were cut', async () => {
    prefill(Array.from({ length: 15 }, (_, index) => ({ question: `question ${index}`, reply: `reply ${index}` })));
    const { fake, deps } = setup([okStream('Hi')]);

    await run(deps).finished;

    const sent = fake.calls[0].body.messages as LlmMessage[];
    const history = sent.slice(1);
    // 31 valid messages; 20 would open with a reply, so 19 are sent and 12 left out.
    expect(history).toHaveLength(19);
    expect(history[0]).toEqual({ role: 'user', content: 'question 6' });
    expect(history.at(-1)).toEqual({ role: 'user', content: 'What would you check first?' });
    expect(sent[0].content).toContain('Earlier messages in this conversation are not included (12 left out)');
  });

  it('sends the whole thread with no note when it is short (positive control)', async () => {
    prefill([{ question: 'question 0', reply: 'reply 0' }]);
    const { fake, deps } = setup([okStream('Hi')]);

    await run(deps).finished;

    const sent = fake.calls[0].body.messages as LlmMessage[];
    expect(sent.slice(1)).toEqual([
      { role: 'user', content: 'question 0' },
      { role: 'assistant', content: 'reply 0' },
      { role: 'user', content: 'What would you check first?' },
    ]);
    expect(sent[0].content).not.toContain('Earlier messages');
  });

  it('leaves out failed and empty replies, and merges the questions that are then in a row', async () => {
    prefill([{ question: 'question 0', reply: '', status: 'error' }]);
    const { fake, deps } = setup([okStream('Hi')]);

    await run(deps).finished;

    expect((fake.calls[0].body.messages as LlmMessage[]).slice(1)).toEqual([
      { role: 'user', content: 'question 0\n\nWhat would you check first?' },
    ]);
  });
});

describe('historyForTurn', () => {
  const message = (overrides: Partial<Message>): Message => ({
    id: 'id',
    threadId: 'thread',
    turnId: 'turn-a',
    seq: 1,
    author: 'human',
    agentId: null,
    agentName: null,
    agentVersion: null,
    promptHash: null,
    model: null,
    provenance: 'derived',
    status: 'complete',
    truncated: false,
    text: 'text',
    errorCode: null,
    correlationId: null,
    createdAt: '2026-10-07T20:45:00.000Z',
    ...overrides,
  });

  it('ends with the question even when a late reply to an older turn was saved after it', () => {
    const question = message({ id: 'q2', turnId: 'turn-b', seq: 3, text: 'new question' });
    const messages = [
      message({ id: 'q1', seq: 1, text: 'old question' }),
      message({ id: 'a1', seq: 2, author: 'agent', text: 'old answer' }),
      question,
      message({ id: 'late', seq: 4, author: 'agent', text: 'late answer to the old turn' }),
    ];

    expect(historyForTurn(messages, question)).toEqual({
      messages: [
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'new question' },
      ],
      omitted: 0,
    });
  });
});

describe('oneToOneExecutor: failures', () => {
  it('saves an error reply with the code and the correlation id of the server log when the model fails before any text', async () => {
    const logs = captureLogs();
    const { deps } = setup([jsonResponse({ error: { message: 'no' } }, 401)]);

    const turn = run(deps);
    const finished = await turn.finished;

    const reply = temp.store.listMessages(turn.thread.id).find((message) => message.author === 'agent');
    expect(reply).toMatchObject({ status: 'error', text: '', errorCode: 'llm_auth', model: null });
    expect(reply?.correlationId).toEqual(expect.any(String));
    expect(logs.errors().join('\n')).toContain(reply?.correlationId as string);
    expect(finished).toMatchObject({ status: 'error', errorCode: 'llm_auth', correlationId: reply?.correlationId });
    expect(finished.trace?.agents[0]).toMatchObject({ state: 'failed', errorCode: 'llm_auth', messageId: reply?.id });
    expect(turn.events.at(-1)).toEqual({ type: 'done', turnId: turn.turn.id, status: 'error' });
  });

  it('saves the text received before a stream broke, as partial, and finishes the turn as partial', async () => {
    captureLogs();
    const { deps } = setup([sseResponse([chunkEvent('Half a reply', { role: true })], { end: { error: socketClosed() } })]);

    const turn = run(deps);
    const finished = await turn.finished;

    const reply = temp.store.listMessages(turn.thread.id).find((message) => message.author === 'agent');
    expect(reply).toMatchObject({ status: 'partial', text: 'Half a reply', errorCode: 'llm_network' });
    expect(finished).toMatchObject({ status: 'partial', errorCode: 'llm_network', correlationId: reply?.correlationId });
  });

  it('ends the turn as error with no model call and no reply when the agent is no longer active', async () => {
    const logs = captureLogs();
    const { fake, deps } = setup([okStream('never')], { getAgent: () => undefined });

    const turn = run(deps);
    const finished = await turn.finished;

    expect(fake.calls).toHaveLength(0);
    expect(temp.store.listMessages(turn.thread.id).filter((message) => message.author === 'agent')).toEqual([]);
    expect(finished).toMatchObject({ status: 'error', errorCode: 'internal', correlationId: expect.any(String) });
    expect(turn.events.slice(-2)).toEqual([
      { type: 'error', code: 'internal', correlationId: finished.correlationId },
      { type: 'done', turnId: turn.turn.id, status: 'error' },
    ]);
    expect(logs.errors().join('\n')).toContain(finished.correlationId as string);
  });
});
