import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extraSpec, fixtureSpecs } from '@/server/agents/test-fixtures';
import { createLlmClient } from '@/server/llm';
import {
  DONE_EVENT,
  chunkEvent,
  createFakeFetch,
  sseResponse,
  testConfig,
  type FakeStep,
  type RecordedCall,
} from '@/server/llm/test-support/fake-gateway';
import { oneToOneExecutor } from '@/server/chat/one-to-one';
import { startTurn } from '@/server/chat/turn-runner';
import { FROZEN_NOW, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import { DATA_ROOM_INSTRUCTIONS } from '@/server/prompts/data-room';
import type { AgentSpec, LlmMessage, NewDocument } from '@/shared/contracts';
import { teamExecutor, type TeamDeps } from './team';

// A workspace with a data room puts its index and documents in front of the agents that answer, on every turn,
// and records what they saw in the turn's trace. A workspace without one is untouched.

let temp: TempStore;
let clock = 0;

beforeEach(() => {
  temp = tempStore();
  clock = 0;
});

afterEach(() => {
  temp.cleanup();
});

const AS_OF = '2026-10-12';
const doc = (overrides: Partial<NewDocument> = {}): NewDocument => ({
  title: 'Licensor overview',
  sourceType: 'company-disclosure',
  publishedAt: '2026-07-14',
  provided: true,
  text: 'The licensor says the asset has orphan designation.',
  ...overrides,
});

const okStream = (...parts: string[]) =>
  sseResponse([...parts.map((part, index) => chunkEvent(part, { role: index === 0 })), chunkEvent(null, { finishReason: 'stop' }), DONE_EVENT]);
const systemOf = (call: RecordedCall) => (call.body.messages as LlmMessage[])[0].content;
const agentNameOf = (call: RecordedCall) => /^You are ([^.\n]+)\. Your capability:/m.exec(systemOf(call))?.[1] ?? '?';
const steps = (count: number): FakeStep[] => Array.from({ length: count }, () => () => okStream('A usable reply.'));

function oneToOne(count = 3) {
  const specs = fixtureSpecs();
  const fake = createFakeFetch(steps(count));
  const deps = {
    store: temp.store,
    getAgent: (id: string) => specs.find((spec) => spec.id === id),
    llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
    now: () => FROZEN_NOW,
    newId: sequentialIds('msg'),
    log: console,
  };
  const ask = async (text: string) => {
    clock += 1;
    const outcome = startTurn(
      { roomId: 'lead', clientTurnId: `client-${clock}`, text, timeZone: 'Europe/Paris' },
      oneToOneExecutor('lead', deps),
      { store: temp.store, bootId: 'boot-1', workspaceId: 'demo', now: () => FROZEN_NOW, newId: sequentialIds(`runner${clock}`), log: console },
    );
    if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
    await outcome.finished;
    return temp.store.getTurn(outcome.turn.id);
  };
  return { fake, ask };
}

describe('the 1:1 room with a data room', () => {
  it('leaves the prompt exactly as it was when the workspace has no data room', async () => {
    const { fake, ask } = oneToOne();

    const turn = await ask('What would you check first?');

    const system = systemOf(fake.calls[0]);
    expect(system).not.toContain('Room context');
    expect(system).not.toContain('Data room');
    expect(system).not.toContain(DATA_ROOM_INSTRUCTIONS[0]);
    expect(turn?.trace).not.toHaveProperty('dataRoom');
  });

  it('puts the instructions, the index and the shown documents in front of the agent, and records what it saw', async () => {
    const { fake, ask } = oneToOne();
    temp.store.createDataRoom('demo', {
      asOf: AS_OF,
      documents: [doc({ id: 'DR-01' }), doc({ id: 'DR-09', title: 'Paediatric study plan', provided: false, text: null, publishedAt: null })],
    });

    const turn = await ask('Is the orphan designation in place?');

    const system = systemOf(fake.calls[0]);
    for (const line of DATA_ROOM_INSTRUCTIONS) expect(system).toContain(line);
    expect(system).toContain('## Room context');
    expect(system).toMatch(/BEGIN UNTRUSTED TEXT \w+ \(from: Data room index, written by the app\)/);
    expect(system).toContain('DR-09 | Paediatric study plan | listed, not provided');
    expect(system).toMatch(/BEGIN UNTRUSTED TEXT \w+ \(from: Data room document DR-01: Licensor overview \(company disclosure, dated 2026-07-14\)\)/);
    expect(system).toContain('The licensor says the asset has orphan designation.');
    expect(turn?.trace?.dataRoom).toEqual({ asOf: AS_OF, shown: ['DR-01'], notShown: [{ id: 'DR-09', reason: 'not_provided' }] });
  });

  it('reads the room again on every turn: a document added later is seen next time, a withdrawn one is gone', async () => {
    const { fake, ask } = oneToOne();
    temp.store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    await ask('First question');
    temp.store.addDocument('demo', doc({ title: 'Clinical summary', text: 'Topline table text.' }));
    await ask('Second question');
    temp.store.withdrawDocument('demo', 'DR-01', 'wrong file');
    const turn = await ask('Third question');

    expect(systemOf(fake.calls[0])).not.toContain('Topline table text.');
    expect(systemOf(fake.calls[1])).toContain('Topline table text.');
    expect(systemOf(fake.calls[1])).toContain('orphan designation');
    expect(systemOf(fake.calls[2])).not.toContain('orphan designation');
    expect(systemOf(fake.calls[2])).toContain('Topline table text.');
    expect(turn?.trace?.dataRoom?.notShown).toEqual([{ id: 'DR-01', reason: 'withdrawn' }]);
  });

  it('never shows a document that got into the room dated after the as-of date', async () => {
    const { fake, ask } = oneToOne();
    temp.store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });
    // Past the store's own checks, as a second wall test: a raw insert with the trigger dropped.
    const raw = (await import('@/server/db/sqlite')).openDatabase(temp.dbPath);
    raw.exec('DROP TRIGGER data_room_documents_as_of');
    raw
      .prepare(
        `INSERT INTO data_room_documents (workspace_id, id, title, source_type, published_at, provided, origin, body, added_at)
         VALUES ('demo', 'DR-02', 'From the future', 'company-disclosure', '2026-12-01', 1, 'added', 'Later text.', 'x')`,
      )
      .run();
    raw.close();

    const turn = await ask('Anything new?');

    expect(systemOf(fake.calls[0])).not.toContain('Later text.');
    expect(systemOf(fake.calls[0])).not.toContain('From the future');
    expect(turn?.trace?.dataRoom?.notShown).toEqual([{ id: 'DR-02', reason: 'after_as_of' }]);
  });
});

describe('the team chat with a data room', () => {
  function roster(): AgentSpec[] {
    return [...fixtureSpecs(), extraSpec()];
  }

  function team(count = 6) {
    const agents = roster();
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const fake = createFakeFetch(steps(count));
    const deps: TeamDeps = {
      store: temp.store,
      agents,
      selected: new Set(agents.filter((agent) => agent.locked || agent.defaultSelected).map((agent) => agent.id)),
      getAgent: (id) => byId.get(id),
      llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
      now: () => FROZEN_NOW,
      newId: sequentialIds('msg'),
      log: console,
    };
    const ask = async (text: string) => {
      clock += 1;
      const outcome = startTurn(
        { roomId: 'team', clientTurnId: `client-${clock}`, text, timeZone: 'Europe/Paris' },
        teamExecutor(deps),
        { store: temp.store, bootId: 'boot-1', workspaceId: 'demo', now: () => FROZEN_NOW, newId: sequentialIds(`runner${clock}`), log: console },
      );
      if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
      await outcome.finished;
      return temp.store.getTurn(outcome.turn.id);
    };
    return { fake, ask };
  }

  const QUESTION = '@Rosa @Carlos does the licensor overview match the record?';

  it('leaves every prompt as it was when the workspace has no data room', async () => {
    const { fake, ask } = team();

    const turn = await ask(QUESTION);

    expect(fake.calls).toHaveLength(3);
    for (const call of fake.calls) expect(systemOf(call)).not.toContain('Data room');
    expect(turn?.trace).not.toHaveProperty('dataRoom');
  });

  it('gives the primary and the secondary the documents, not the synthesiser, and does not add a call', async () => {
    const { fake, ask } = team();
    temp.store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });

    const turn = await ask(QUESTION);

    expect(fake.calls).toHaveLength(3);
    const byName = new Map(fake.calls.map((call) => [agentNameOf(call), systemOf(call)]));
    expect(byName.get('Rosa')).toContain('The licensor says the asset has orphan designation.');
    expect(byName.get('Carlos')).toContain('The licensor says the asset has orphan designation.');
    expect(byName.get('Carlos')).toContain(DATA_ROOM_INSTRUCTIONS[0]);
    expect(byName.get('Sofia')).not.toContain('orphan designation');
    expect(byName.get('Sofia')).not.toContain(DATA_ROOM_INSTRUCTIONS[0]);
    expect(turn?.trace?.dataRoom).toEqual({ asOf: AS_OF, shown: ['DR-01'], notShown: [] });
    // The teammate's answer still reaches the secondary, after the documents.
    expect(byName.get('Carlos')).toMatch(/Rosa, teammate, answered first in this turn/);
  });

  it('shows the documents to an orchestrator that answers alone too', async () => {
    const { fake, ask } = team();
    temp.store.createDataRoom('demo', { asOf: AS_OF, documents: [doc({ id: 'DR-01' })] });

    await ask('Something nobody is named for');

    expect(fake.calls).toHaveLength(1);
    expect(systemOf(fake.calls[0])).toContain('The licensor says the asset has orphan designation.');
  });
});
