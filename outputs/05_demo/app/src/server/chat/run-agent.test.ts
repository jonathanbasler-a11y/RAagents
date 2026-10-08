import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRegistry } from '@/server/agents';
import { changed, fixtureSpecs, makeLayout, writeSpecs, type TempLayout } from '@/server/agents/test-fixtures';
import { AgentUnavailableError, runAgent, type RunAgentContext, type RunAgentDeps } from '@/server/chat/run-agent';
import { createLlmClient } from '@/server/llm';
import {
  DONE_EVENT,
  REPORTED_MODEL,
  captureLogs,
  chunkEvent,
  createFakeFetch,
  hangUntilAborted,
  jsonResponse,
  socketClosed,
  sseResponse,
  testConfig,
  type FakeStep,
} from '@/server/llm/test-support/fake-gateway';
import { PROMPT_MARKER, hashPrompt } from '@/server/prompts';
import type { AgentSpec, ChatEvent, LlmMessage } from '@/shared/contracts';

const NOW = new Date('2026-10-07T20:45:00.000Z');
const QUESTION: LlmMessage = { role: 'user', content: 'What would you check first?' };

function rosterLookup(specs: AgentSpec[] = fixtureSpecs()) {
  const byId = new Map(specs.filter((spec) => spec.active).map((spec) => [spec.id, spec]));
  return (id: string) => byId.get(id);
}

function setup(steps: FakeStep[], overrides: Partial<RunAgentDeps> = {}) {
  const fake = createFakeFetch(steps);
  const deps: RunAgentDeps = {
    getAgent: rosterLookup(),
    llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
    now: () => NOW,
    newId: () => 'generated-id',
    ...overrides,
  };
  return { fake, deps };
}

function context(overrides: Partial<RunAgentContext> = {}): RunAgentContext & { events: ChatEvent[] } {
  const events: ChatEvent[] = [];
  return {
    room: 'one-to-one',
    role: 'solo',
    history: [QUESTION],
    timeZone: 'Europe/Paris',
    signal: new AbortController().signal,
    messageId: 'msg-1',
    emit: (event) => events.push(event),
    events,
    ...overrides,
  };
}

const okStream = (...parts: string[]) =>
  sseResponse([...parts.map((part, index) => chunkEvent(part, { role: index === 0 })), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT]);

describe('runAgent: a normal reply', () => {
  it('streams agent_start, deltas and agent_end under one message id, and returns the text, status, model and prompt hash', async () => {
    const { fake, deps } = setup([okStream('Hello ', 'world')]);
    const ctx = context();

    const result = await runAgent('lead', ctx, deps);

    expect(ctx.events).toEqual([
      { type: 'agent_start', agentId: 'lead', messageId: 'msg-1', role: 'solo' },
      { type: 'delta', messageId: 'msg-1', text: 'Hello ' },
      { type: 'delta', messageId: 'msg-1', text: 'world' },
      { type: 'agent_end', messageId: 'msg-1', status: 'complete', truncated: false },
    ]);
    expect(result).toMatchObject({
      messageId: 'msg-1',
      agentId: 'lead',
      agentName: 'Rosa',
      agentVersion: '0.1.0',
      role: 'solo',
      text: 'Hello world',
      status: 'complete',
      truncated: false,
      model: REPORTED_MODEL,
      errorCode: null,
      correlationId: null,
      state: 'answered',
    });
    const sent = fake.calls[0].body.messages as LlmMessage[];
    expect(result.promptHash).toBe(hashPrompt(sent));
  });

  it('sends one system message with the rules, the brief and the date in the browser time zone, then the history ending with the question', async () => {
    const { fake, deps } = setup([okStream('Hi')]);
    const history: LlmMessage[] = [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Earlier answer' }, QUESTION];

    await runAgent('lead', context({ history, timeZone: 'Asia/Tokyo' }), deps);

    const sent = fake.calls[0].body.messages as LlmMessage[];
    expect(sent[0].role).toBe('system');
    expect(sent[0].content).toContain(PROMPT_MARKER);
    expect(sent[0].content).toContain('You are Rosa.');
    expect(sent[0].content).toContain('Asia/Tokyo');
    expect(sent[0].content).toContain('Thursday 8 October 2026');
    expect(sent.slice(1)).toEqual(history);
    expect(fake.calls[0].body.stream).toBe(true);
  });

  it('names its handoff teammates that are in the roster', async () => {
    const { fake, deps } = setup([okStream('Hi')]);

    await runAgent('lead', context(), deps);

    expect((fake.calls[0].body.messages as LlmMessage[])[0].content).toMatch(/^- Carlos: CMC regulatory$/m);
  });

  it('allocates a message id when none is given', async () => {
    const { deps } = setup([okStream('Hi')]);
    const ctx = context({ messageId: undefined });

    const result = await runAgent('lead', ctx, deps);

    expect(result.messageId).toBe('generated-id');
    expect(ctx.events[0]).toMatchObject({ type: 'agent_start', messageId: 'generated-id' });
  });

  it('runs silently and still returns the reply when no emitter is given', async () => {
    const { deps } = setup([okStream('Quiet ', 'reply')]);

    const result = await runAgent('lead', context({ emit: undefined }), deps);

    expect(result.text).toBe('Quiet reply');
  });

  it('keeps the whole reply when the emitter throws', async () => {
    const { deps } = setup([okStream('Kept ', 'text')]);
    const logs = captureLogs();

    const result = await runAgent(
      'lead',
      context({
        emit: () => {
          throw new Error('emitter broke');
        },
      }),
      deps,
    );

    expect(result).toMatchObject({ text: 'Kept text', status: 'complete' });
    expect(logs.all()).toContain('emitter broke');
  });
});

describe('runAgent: refusals', () => {
  let layout: TempLayout;

  beforeEach(() => {
    layout = makeLayout();
  });

  afterEach(() => {
    layout.cleanup();
  });

  it('refuses an inactive agent before any event or model call', async () => {
    writeSpecs(layout, changed('labels', { active: false }));
    const registry = loadRegistry({ specsDir: layout.specsDir, publicDir: layout.publicDir });
    const { fake, deps } = setup([okStream('never')], { getAgent: (id) => registry.get(id) });
    const ctx = context();

    await expect(runAgent('labels', ctx, deps)).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(fake.calls).toHaveLength(0);
    expect(ctx.events).toEqual([]);
  });

  it('runs an active agent from the same registry (positive control)', async () => {
    writeSpecs(layout, changed('labels', { active: false }));
    const registry = loadRegistry({ specsDir: layout.specsDir, publicDir: layout.publicDir });
    const { fake, deps } = setup([okStream('Yes')], { getAgent: (id) => registry.get(id) });

    await expect(runAgent('lead', context(), deps)).resolves.toMatchObject({ status: 'complete' });
    expect(fake.calls).toHaveLength(1);
  });

  it('refuses an unknown agent', async () => {
    const { fake, deps } = setup([okStream('never')]);

    await expect(runAgent('nobody', context(), deps)).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('runAgent: replies that end badly', () => {
  it('marks a reply that stopped at the output cap as complete and cut off', async () => {
    const { deps } = setup([sseResponse([chunkEvent('Long text', { role: true }), chunkEvent(null, { finishReason: 'length' }), DONE_EVENT])]);
    const ctx = context();

    const result = await runAgent('lead', ctx, deps);

    expect(result).toMatchObject({ status: 'complete', truncated: true, state: 'answered', errorCode: null });
    expect(ctx.events.at(-1)).toEqual({ type: 'agent_end', messageId: 'msg-1', status: 'complete', truncated: true });
  });

  it('keeps the text of a stream that broke after the first token, as partial with an error code and a correlation id', async () => {
    const { deps } = setup([sseResponse([chunkEvent('Half a ', { role: true })], { end: { error: socketClosed() } })]);
    const ctx = context();
    captureLogs();

    const result = await runAgent('lead', ctx, deps);

    expect(result).toMatchObject({ text: 'Half a ', status: 'partial', errorCode: 'llm_network', state: 'failed' });
    expect(result.correlationId).toEqual(expect.any(String));
    expect(ctx.events.slice(-2)).toEqual([
      { type: 'error', code: 'llm_network', correlationId: result.correlationId, messageId: 'msg-1' },
      { type: 'agent_end', messageId: 'msg-1', status: 'partial', truncated: false },
    ]);
  });

  it('gives a reply that broke off the correlation id of the client log line that holds the cause', async () => {
    const { deps } = setup([sseResponse([chunkEvent('Half a ', { role: true })], { end: { error: socketClosed() } })]);
    const ctx = context();
    const logs = captureLogs();

    const result = await runAgent('lead', ctx, deps);

    expect(result.status).toBe('partial');
    expect(logs.warnings().join('\n')).toContain(`answer is partial (correlation ${result.correlationId})`);
    expect(ctx.events).toContainEqual({ type: 'error', code: 'llm_network', correlationId: result.correlationId, messageId: 'msg-1' });
  });

  it('reports a failure before any text as an error that carries the correlation id of the server log line', async () => {
    const { deps } = setup([jsonResponse({ error: { message: 'bad key' } }, 401)]);
    const ctx = context();
    const logs = captureLogs();

    const result = await runAgent('lead', ctx, deps);

    expect(result).toMatchObject({ text: '', status: 'error', errorCode: 'llm_auth', model: null, state: 'failed' });
    expect(result.correlationId).toEqual(expect.any(String));
    expect(logs.errors().join('\n')).toContain(result.correlationId as string);
    expect(ctx.events).toEqual([
      { type: 'agent_start', agentId: 'lead', messageId: 'msg-1', role: 'solo' },
      { type: 'error', code: 'llm_auth', correlationId: result.correlationId, messageId: 'msg-1' },
      { type: 'agent_end', messageId: 'msg-1', status: 'error', truncated: false },
    ]);
  });

  it('marks a reply cut short by the turn deadline as out_of_time and keeps the text', async () => {
    const turn = new AbortController();
    const { deps } = setup([
      (call) => sseResponse([chunkEvent('Started ', { role: true })], { end: 'hang', signal: call.signal }),
    ]);
    const ctx = context({
      signal: turn.signal,
      emit: (event) => {
        ctx.events.push(event);
        if (event.type === 'delta') turn.abort(new Error('turn deadline'));
      },
    });
    captureLogs();

    const result = await runAgent('lead', ctx, deps);

    expect(result).toMatchObject({ text: 'Started ', status: 'partial', errorCode: 'out_of_time', state: 'out_of_time' });
  });

  it('marks a call stopped by the turn deadline before any text as out_of_time', async () => {
    const turn = new AbortController();
    const { deps } = setup([
      (call) => {
        setTimeout(() => turn.abort(new Error('turn deadline')), 5);
        return hangUntilAborted(call);
      },
    ]);
    captureLogs();

    const result = await runAgent('lead', context({ signal: turn.signal }), deps);

    expect(result).toMatchObject({ text: '', status: 'error', errorCode: 'out_of_time', state: 'out_of_time' });
  });

  it('hands the turn signal to the model call', async () => {
    const turn = new AbortController();
    const { fake, deps } = setup([okStream('Hi')]);

    await runAgent('lead', context({ signal: turn.signal }), deps);
    expect(fake.calls[0].signal?.aborted).toBe(false);
    turn.abort();

    expect(fake.calls[0].signal?.aborted).toBe(true);
  });
});
