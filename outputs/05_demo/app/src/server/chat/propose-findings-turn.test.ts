import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureSpecs } from '@/server/agents/test-fixtures';
import { createLlmClient } from '@/server/llm';
import { DONE_EVENT, chunkEvent, createFakeFetch, jsonResponse, sseResponse, testConfig, type FakeStep, type RecordedCall } from '@/server/llm/test-support/fake-gateway';
import { oneToOneExecutor, type OneToOneDeps } from '@/server/chat/one-to-one';
import { startTurn } from '@/server/chat/turn-runner';
import { FROZEN_NOW, sequentialIds, tempStore, type TempStore } from '@/server/chat/test-support';
import { DATA_ROOM_INSTRUCTIONS } from '@/server/prompts/data-room';
import { FINDINGS_REQUEST_TEXT, PROPOSE_FINDINGS_INSTRUCTIONS } from '@/server/prompts/findings';
import { PROPOSAL_MAX_TOKENS } from '@/shared/findings';
import type { ChatEvent, LlmMessage, NewDocument, TurnIntent } from '@/shared/contracts';

// A findings proposal: the person asks an agent, in its own room, to propose findings from the data room. Code reads
// the agent's reply, checks every claim and puts the good ones in the register as drafts and the rest in the open
// questions. Nothing the agent writes can make a claim a finding without a quote that is really in a document.

let temp: TempStore;
let counter = 0;

beforeEach(() => {
  temp = tempStore();
  counter = 0;
});

afterEach(() => {
  temp.cleanup();
});

const AS_OF = '2026-10-12';
const SENTENCE_01 = 'The licensor states that the agency agreed one adequate and well-controlled pivotal study is sufficient for approval.';
const SENTENCE_02 = 'The agency did not agree that STUDY-301 alone would suffice, and a second study could be requested during review.';

const doc = (overrides: Partial<NewDocument> = {}): NewDocument => ({
  title: 'Licensor overview',
  sourceType: 'company-disclosure',
  publishedAt: '2026-07-14',
  provided: true,
  text: SENTENCE_01,
  ...overrides,
});

function room(documents: NewDocument[] = [doc({ id: 'DR-01' }), doc({ id: 'DR-02', title: 'Agency minutes', sourceType: 'agency-record', publishedAt: '2026-03-20', text: SENTENCE_02 })]) {
  temp.store.createDataRoom('demo', { asOf: AS_OF, documents });
}

const finding = (overrides: Record<string, unknown> = {}) => ({
  claim: 'The licensor says the agency agreed a single pivotal study is enough.',
  documentId: 'DR-01',
  quote: 'agreed one adequate and well-controlled pivotal study is sufficient for approval',
  confidence: 'medium',
  confidenceReason: 'Explicit, but it is the seller’s own account.',
  assumptions: ['The overview is current.'],
  ...overrides,
});

const reply = (findings: unknown[], unsupported: unknown[] = []) =>
  `I propose ${findings.length} finding${findings.length === 1 ? '' : 's'}.\n\n\`\`\`json\n${JSON.stringify({ findings, unsupported })}\n\`\`\``;

const stream = (text: string, finishReason: string = 'stop') => sseResponse([chunkEvent(text, { role: true }), chunkEvent(null, { finishReason }), DONE_EVENT]);
const systemOf = (call: RecordedCall) => (call.body.messages as LlmMessage[])[0].content;

function setup(steps: FakeStep[], overrides: Partial<OneToOneDeps> = {}) {
  const specs = fixtureSpecs();
  const fake = createFakeFetch(steps);
  const deps: OneToOneDeps = {
    store: temp.store,
    getAgent: (id) => specs.find((spec) => spec.id === id),
    llm: createLlmClient({ config: testConfig(), fetch: fake.fetch, sleep: async () => {} }),
    now: () => FROZEN_NOW,
    newId: sequentialIds('msg'),
    log: { error: () => {}, warn: () => {} } as unknown as Console,
    ...overrides,
  };
  const owner = specs.find((spec) => spec.id === 'lead')?.humanOwner ?? '';
  const ask = async (intent?: TurnIntent) => {
    counter += 1;
    const events: ChatEvent[] = [];
    const outcome = startTurn(
      { roomId: 'lead', clientTurnId: `client-${counter}`, text: intent ? FINDINGS_REQUEST_TEXT : 'A normal question.', timeZone: 'Europe/Paris' },
      oneToOneExecutor('lead', deps, intent ? { intent } : {}),
      { store: temp.store, bootId: 'boot-1', workspaceId: 'demo', now: () => FROZEN_NOW, newId: sequentialIds(`runner${counter}`), log: { error: () => {}, warn: () => {} } as unknown as Console },
    );
    if (outcome.kind !== 'started') throw new Error(`expected a started turn, got ${outcome.kind}`);
    outcome.channel.subscribe((event) => events.push(event));
    const turn = await outcome.finished;
    return { turn, events, threadId: outcome.thread.id };
  };
  return { fake, ask, owner };
}

describe('a findings proposal turn', () => {
  it('puts the checked claims in the register as drafts and the rest in the open questions, with a note written by code', async () => {
    room();
    const { ask, owner } = setup([
      () =>
        stream(
          reply(
            [finding(), finding({ claim: 'The agency did not agree a single study.', documentId: 'DR-02', quote: 'did not agree that STUDY-301 alone would suffice', confidence: 'high' }), finding({ claim: 'The study was positive.', quote: 'the study met its primary endpoint in every subgroup' })],
            [{ claim: 'A paediatric plan is agreed.', reason: 'No document says so.' }],
          ),
        ),
    ]);

    const { turn, events } = await ask('propose-findings');

    expect(turn?.status).toBe('done');
    const findings = temp.store.listFindings('demo');
    expect(findings.map((entry) => [entry.id, entry.status, entry.documentId, entry.basis, entry.confidence])).toEqual([
      ['F-001', 'draft', 'DR-01', 'attributed', 'medium'],
      ['F-002', 'draft', 'DR-02', 'primary-record', 'high'],
    ]);
    expect(findings[0]).toMatchObject({ owner, draftedBy: { agentId: 'lead', turnId: turn?.id }, asOf: AS_OF });
    expect(temp.store.listOpenQuestions('demo').map((entry) => [entry.id, entry.reasonCode, entry.claim])).toEqual([
      ['Q-001', 'quote_not_in_document', 'The study was positive.'],
      ['Q-002', 'declared_unsupported', 'A paediatric plan is agreed.'],
    ]);
    const note = events.find((event): event is Extract<ChatEvent, { type: 'note' }> => event.type === 'note');
    expect(note?.text).toBe(
      '2 findings drafted (F-001, F-002) and 2 claims kept as open questions (Q-001, Q-002). Nothing is a finding until a person accepts it.',
    );
    expect(turn?.trace).toMatchObject({ intent: 'propose-findings', proposal: { findingIds: ['F-001', 'F-002'], questionIds: ['Q-001', 'Q-002'], problem: null } });
    const messages = temp.store.listMessages(turn!.threadId);
    expect(messages.find((message) => message.author === 'human')?.text).toBe(FINDINGS_REQUEST_TEXT);
    expect(messages.some((message) => message.text === note?.text)).toBe(true);
  });

  it('says when a claim repeats a finding already in the register, and adds nothing for it', async () => {
    room();
    const second = [finding({ claim: 'Said differently.' }), finding({ claim: 'A new one.', documentId: 'DR-02', quote: 'did not agree that STUDY-301 alone would suffice' })];
    const { ask } = setup([() => stream(reply([finding()])), () => stream(reply(second))]);
    await ask('propose-findings');

    const { turn, events } = await ask('propose-findings');

    expect(temp.store.listFindings('demo').map((entry) => entry.id)).toEqual(['F-001', 'F-002']);
    const note = events.find((event): event is Extract<ChatEvent, { type: 'note' }> => event.type === 'note');
    expect(note?.text).toBe(
      '1 finding drafted (F-002). 1 claim repeated a finding already in the register (F-001) and was not added again. Nothing is a finding until a person accepts it.',
    );
    expect(turn?.trace?.proposal).toMatchObject({ findingIds: ['F-002'], duplicateIds: ['F-001'], problem: null });
  });

  it('says so plainly when every claim repeats one, and the register does not change', async () => {
    room();
    const { ask } = setup([() => stream(reply([finding()])), () => stream(reply([finding({ claim: 'Same quote again.' })]))]);
    await ask('propose-findings');

    const { turn, events } = await ask('propose-findings');

    expect(temp.store.listFindings('demo')).toHaveLength(1);
    const note = events.find((event): event is Extract<ChatEvent, { type: 'note' }> => event.type === 'note');
    expect(note?.text).toBe('No new findings were drafted: 1 claim repeated a finding already in the register (F-001) and was not added again.');
    expect(turn?.trace?.proposal).toMatchObject({ findingIds: [], duplicateIds: ['F-001'] });
  });

  it('leaves duplicateIds out of the trace when nothing repeated', async () => {
    room();
    const { ask } = setup([() => stream(reply([finding()]))]);

    const { turn } = await ask('propose-findings');

    expect(turn?.trace?.proposal).not.toHaveProperty('duplicateIds');
  });

  it('lets the proposal reply be longer than an ordinary answer, and only that reply: the default cap cut real proposals off', async () => {
    room();
    const { fake, ask } = setup([() => stream(reply([])), () => stream('A normal answer.')]);

    await ask('propose-findings');
    await ask();

    expect(PROPOSAL_MAX_TOKENS).toBeGreaterThan(1500);
    expect(fake.calls[0].body.max_tokens).toBe(PROPOSAL_MAX_TOKENS);
    expect(fake.calls[1].body.max_tokens).toBe(1500);
  });

  it('gives the agent the data room and the findings instructions on this turn only', async () => {
    room();
    const { fake, ask } = setup([() => stream(reply([])), () => stream('A normal answer.')]);

    await ask('propose-findings');
    await ask();

    const proposal = systemOf(fake.calls[0]);
    for (const line of [...DATA_ROOM_INSTRUCTIONS, ...PROPOSE_FINDINGS_INSTRUCTIONS]) expect(proposal).toContain(line);
    expect(proposal).toContain(SENTENCE_02);
    const normal = systemOf(fake.calls[1]);
    expect(normal).toContain(DATA_ROOM_INSTRUCTIONS[0]);
    expect(normal).not.toContain(PROPOSE_FINDINGS_INSTRUCTIONS[0]);
  });

  it('says in one line when it proposes nothing', async () => {
    room();
    const { ask } = setup([() => stream(reply([]))]);

    const { turn, events } = await ask('propose-findings');

    expect(turn?.status).toBe('done');
    expect(temp.store.listFindings('demo')).toEqual([]);
    expect(events.find((event) => event.type === 'note')).toMatchObject({ text: 'No findings were drafted and no claims were kept as open questions.' });
  });

  it('adds nothing when the reply holds no proposal, and says so', async () => {
    room();
    const { ask } = setup([() => stream('I could not find anything worth proposing.')]);

    const { turn, events } = await ask('propose-findings');

    expect(temp.store.listFindings('demo')).toEqual([]);
    expect(temp.store.listOpenQuestions('demo')).toEqual([]);
    const note = events.find((event): event is Extract<ChatEvent, { type: 'note' }> => event.type === 'note');
    expect(note?.text).toMatch(/^Nothing was added to the register: the reply held no findings I could read/);
    expect(turn?.trace?.proposal).toMatchObject({ findingIds: [], questionIds: [], problem: expect.stringMatching(/findings/) });
  });

  it('adds nothing from a reply that was cut off, even if the json looks complete', async () => {
    room();
    const { ask } = setup([() => stream(reply([finding()]), 'length')]);

    const { events } = await ask('propose-findings');

    expect(temp.store.listFindings('demo')).toEqual([]);
    expect(events.find((event) => event.type === 'note')).toMatchObject({ text: 'Nothing was added to the register: the reply was cut off.' });
  });

  it('adds nothing when the model fails, and ends the turn as the failure it is', async () => {
    room();
    const { ask } = setup([() => jsonResponse({ error: { message: 'bad request' } }, 400)]);

    const { turn, events } = await ask('propose-findings');

    expect(turn?.status).toBe('error');
    expect(temp.store.listFindings('demo')).toEqual([]);
    expect(temp.store.listOpenQuestions('demo')).toEqual([]);
    // The failure has its own error bubble: no register note about a reply that never arrived, and no proposal in the trace.
    expect(events.some((event) => event.type === 'note')).toBe(false);
    expect(turn?.trace?.proposal).toBeUndefined();
  });

  it('refuses a claim that cites a document the agent was not shown in this turn', async () => {
    // Five documents of 12,000 characters: only four fit in the 48,000 an agent reads.
    const filler = 'x'.repeat(12_000 - SENTENCE_01.length - 1);
    room(Array.from({ length: 5 }, (_value, index) => doc({ id: `DR-0${index + 1}`, title: `Document ${index + 1}`, text: `${SENTENCE_01} ${filler}` })));
    const { ask } = setup([() => stream(reply([finding({ documentId: 'DR-05' }), finding({ documentId: 'DR-04', claim: 'Shown one.' })]))]);

    const { turn } = await ask('propose-findings');

    expect(turn?.trace?.dataRoom?.notShown).toEqual([{ id: 'DR-05', reason: 'too_large' }]);
    expect(temp.store.listFindings('demo').map((entry) => entry.documentId)).toEqual(['DR-04']);
    expect(temp.store.listOpenQuestions('demo').map((entry) => entry.reasonCode)).toEqual(['document_not_shown']);
  });

  it('does not read a normal turn for findings, even when the reply looks like a proposal', async () => {
    room();
    const { ask } = setup([() => stream(reply([finding()]))]);

    const { turn } = await ask();

    expect(temp.store.listFindings('demo')).toEqual([]);
    expect(turn?.trace).not.toHaveProperty('intent');
    expect(turn?.trace).not.toHaveProperty('proposal');
  });

  it('keeps the reply and ends the turn partial, with a reference, when the register cannot be written', async () => {
    room();
    const broken = { ...temp.store, proposeFindings: () => { throw new Error('disk is full: /secret/path'); } };
    const { ask } = setup([() => stream(reply([finding()]))], { store: broken as never });

    const { turn, events } = await ask('propose-findings');

    expect(turn?.status).toBe('partial');
    expect(turn?.errorCode).toBe('internal');
    expect(turn?.correlationId).toBeTruthy();
    const note = events.find((event): event is Extract<ChatEvent, { type: 'note' }> => event.type === 'note');
    expect(note?.text).toContain(turn!.correlationId!);
    expect(note?.text).not.toContain('/secret/path');
    expect(temp.store.listMessages(turn!.threadId).some((message) => message.author === 'agent' && message.text.includes('"findings"'))).toBe(true);
  });
});
