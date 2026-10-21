// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult, ChatApi, PostTurnOutcome } from '@/client/chat-client';
import { CARLOS, EMEKA, ROSA, ROSTER, THREAD, makeMessage, makeTurn, roomData } from '@/client/test-fixtures';
import type { HealthReport, HealthResponse, RoomMessagesResponse, SelectionResponse, TurnTrace } from '@/shared/contracts';
import { ChatRoom } from './ChatRoom';
import { DEMO_PROMPTS, type DemoPromptId } from './demo-prompts';
import { SelectionProvider } from './SelectionProvider';

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });

function demoText(id: DemoPromptId): string {
  const prompt = DEMO_PROMPTS.find((entry) => entry.id === id);
  if (!prompt) throw new Error(`there is no demo prompt "${id}"`);
  return prompt.text;
}

/** A team chat with one finished turn: the conversation has started. */
const STARTED = roomData(
  [
    makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Earlier question', seq: 1 }),
    makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Earlier answer.', seq: 2 }),
  ],
  [makeTurn({ id: 't1' })],
);

/** jsdom has no layout: give an element the sizes a browser would measure. */
function setBox(element: HTMLElement, box: { scrollHeight?: number; clientHeight?: number }) {
  for (const [name, value] of Object.entries(box)) Object.defineProperty(element, name, { configurable: true, value });
}

/**
 * A small layout model for the log: its content height grows with the content (40 px per
 * element) and scrollTop is clamped as a browser clamps it.
 */
function layoutByContent(element: HTMLElement, clientHeight: number) {
  const scrollHeight = () => Math.max(clientHeight, element.querySelectorAll('*').length * 40);
  let top = 0;
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: scrollHeight });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, scrollHeight() - clientHeight));
    },
  });
}

/** The worst timing for a browser's scroll event: right after every change to the log's content. */
function scrollEventAfterEveryChange(element: HTMLElement) {
  new MutationObserver(() => element.dispatchEvent(new Event('scroll'))).observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/** jsdom has no ResizeObserver. This one reports a size change only to observers of that element. */
function fakeResizeObserver() {
  const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
  class FakeResizeObserver {
    private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      observers.delete(this.entry);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    resized(target: Element) {
      for (const { callback, targets } of observers) {
        if (targets.has(target)) callback([{ target } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      }
    },
  };
}

const HEALTHY: HealthReport = {
  status: 'ok',
  checks: { database: 'ok', agents: 'ok', llm: 'ok' },
  agentCount: 25,
  llm: { configured: true, missing: [], message: null },
  startedAt: '2026-10-07T08:00:00.000Z',
};

function fakeApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(roomData([], []))),
    postTurn: vi.fn<ChatApi['postTurn']>().mockResolvedValue({ kind: 'stream', clientTurnId: 'c1', done: null, broken: false }),
    newConversation: vi.fn<ChatApi['newConversation']>().mockResolvedValue(ok({ thread: THREAD, archivedThreadId: null })),
    getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>(HEALTHY)),
    getSelection: vi
      .fn<ChatApi['getSelection']>()
      .mockResolvedValue(
        ok<SelectionResponse>({ workspaceId: 'demo', selected: ['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn'], source: 'saved' }),
      ),
    setSelection: vi.fn<ChatApi['setSelection']>(),
    getDdSetup: vi.fn<ChatApi['getDdSetup']>(),
    setDdSetup: vi.fn<ChatApi['setDdSetup']>(),
    getDataRoom: vi.fn<ChatApi['getDataRoom']>(),
    getDocument: vi.fn<ChatApi['getDocument']>(),
    startDataRoom: vi.fn<ChatApi['startDataRoom']>(),
    addDocument: vi.fn<ChatApi['addDocument']>(),
    withdrawDocument: vi.fn<ChatApi['withdrawDocument']>(),
    getFindings: vi.fn<ChatApi['getFindings']>(),
    submitFindingDecision: vi.fn<ChatApi['submitFindingDecision']>(),
    submitFindingTag: vi.fn<ChatApi['submitFindingTag']>(),
    getChecklist: vi.fn<ChatApi['getChecklist']>(),
    getBriefing: vi.fn<ChatApi['getBriefing']>(),
    submitChecklistState: vi.fn<ChatApi['submitChecklistState']>(),
    ...overrides,
  };
}

function renderRoom(roomId: string, api: ChatApi) {
  return render(
    <SelectionProvider client={api}>
      <ChatRoom roomId={roomId} agents={ROSTER} client={api} />
    </SelectionProvider>,
  );
}

describe('ChatRoom', () => {
  it('shows a loading state, then an empty state with the agent’s example prompts', async () => {
    let resolveMessages: (value: ApiResult<RoomMessagesResponse>) => void = () => undefined;
    const api = fakeApi({
      getMessages: vi.fn<ChatApi['getMessages']>(
        () =>
          new Promise((resolve) => {
            resolveMessages = resolve;
          }),
      ),
    });
    renderRoom('reglead', api);

    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message Rosa' })).toBeDisabled();

    resolveMessages(ok(roomData([], [], 'reglead')));

    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument();
    for (const prompt of ROSA.examplePrompts) {
      expect(screen.getByRole('button', { name: prompt })).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Message Rosa' })).toBeEnabled();
  });

  it('shows an error state with a retry when the messages cannot be loaded', async () => {
    const user = userEvent.setup();
    const getMessages = vi
      .fn<ChatApi['getMessages']>()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        error: { error: 'internal', message: 'Something went wrong.', correlationId: 'corr-load' },
        message: 'Something went wrong.',
      })
      .mockResolvedValueOnce(ok(roomData([], [], 'reglead')));
    renderRoom('reglead', fakeApi({ getMessages }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong.');
    expect(alert).toHaveTextContent('corr-load');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument();
  });

  it('shows Emeka’s fixed banner in his room', async () => {
    renderRoom(EMEKA.id, fakeApi());

    expect(
      await screen.findByText(
        'No documents are connected yet, so Emeka cannot verify anything. He can explain what evidence a claim would need.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the setup banner and disables the composer when the model route is missing', async () => {
    const notConfigured: HealthReport = {
      ...HEALTHY,
      status: 'degraded',
      checks: { ...HEALTHY.checks, llm: 'not_configured' },
      llm: { configured: false, missing: ['LLM_API_KEY'], message: 'The model connection is not set up. Set LLM_API_KEY.' },
    };
    renderRoom('reglead', fakeApi({ getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>(notConfigured)) }));

    expect(await screen.findByText('The model connection is not set up. Set LLM_API_KEY.')).toBeInTheDocument();
    expect(screen.getByText('LLM_API_KEY')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Rosa' })).toBeDisabled());
  });

  it('does not block the composer when health has no report yet (stub)', async () => {
    renderRoom('reglead', fakeApi({ getHealth: vi.fn<ChatApi['getHealth']>().mockResolvedValue(ok<HealthResponse>({ status: 'stub' })) }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message Rosa' })).toBeEnabled());
  });

  it('in the team chat, offers @mention chips for selected agents who can be mentioned', async () => {
    const user = userEvent.setup();
    renderRoom('team', fakeApi());

    const chips = await screen.findByRole('group', { name: 'Mention an agent' });
    const names = within(chips)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names).toEqual(['@Rosa', '@Carlos', '@Saskia', '@Emeka']);

    await user.click(within(chips).getByRole('button', { name: '@Carlos' }));

    expect(screen.getByRole('textbox', { name: 'Message the team' })).toHaveValue('@Carlos ');
  });

  it('disables the composer and marks the room busy while a turn runs', async () => {
    const user = userEvent.setup();
    const postTurn = vi.fn<ChatApi['postTurn']>(() => new Promise<PostTurnOutcome>(() => undefined));
    renderRoom('reglead', fakeApi({ postTurn }));
    const box = screen.getByRole('textbox', { name: 'Message Rosa' });
    await waitFor(() => expect(box).toBeEnabled());

    await user.type(box, 'Hello Rosa{Enter}');

    expect(postTurn).toHaveBeenCalledTimes(1);
    expect(box).toBeDisabled();
    expect(screen.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    const thinking = screen.getByRole('article', { name: /Rosa/ });
    expect(within(thinking).getByText('thinking…')).toBeInTheDocument();
  });

  it('renders saved replies with the model label, notes, and "How this turn ran"', async () => {
    const trace: TurnTrace = {
      route: { source: 'explicit', primary: 'reglead', secondaries: [], notConsulted: [], notes: [], synthesis: false },
      agents: [{ agentId: 'reglead', agentName: 'Rosa', role: 'primary', state: 'answered', messageId: 'a1', model: 'model-a', durationMs: 900 }],
    };
    const data = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: '@Rosa @Lena what first?', seq: 1 }),
        makeMessage({ id: 'n1', turnId: 't1', author: 'note', text: 'Lena is not selected for this DD; switch her on to bring her in.', seq: 2 }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Check the designation.', seq: 3 }),
      ],
      [makeTurn({ id: 't1', trace })],
    );
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(data)) }));

    const reply = await screen.findByRole('article', { name: /Rosa/ });
    expect(within(reply).getByText('Model output · not sourced')).toBeInTheDocument();
    expect(screen.getByText('Lena is not selected for this DD; switch her on to bring her in.')).toBeInTheDocument();
    expect(screen.getByText('How this turn ran')).toBeInTheDocument();
  });

  it('scrolls to your new question even after you scrolled up to read', async () => {
    const user = userEvent.setup();
    const saved = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Earlier question', seq: 1 }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Earlier answer.', seq: 2 }),
      ],
      [makeTurn({ id: 't1', roomId: 'reglead' })],
      'reglead',
    );
    const postTurn = vi.fn<ChatApi['postTurn']>(() => new Promise<PostTurnOutcome>(() => undefined));
    renderRoom('reglead', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(saved)), postTurn }));
    const box = screen.getByRole('textbox', { name: 'Message Rosa' });
    await waitFor(() => expect(box).toBeEnabled());
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 });
    log.scrollTop = 0;
    fireEvent.scroll(log); // the reader went up to the start

    await user.type(box, 'New question{Enter}');

    expect(screen.getByText('New question')).toBeInTheDocument();
    expect(log.scrollTop).toBe(900);
  });

  it('after a reload during a turn, shows who is answering, thinking, while it checks for the result', async () => {
    const running = roomData(
      [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Hello Rosa', seq: 1 })],
      [
        makeTurn({
          id: 't1',
          roomId: 'reglead',
          status: 'running',
          finishedAt: null,
          trace: { route: { source: 'direct', primary: 'reglead', secondaries: [], notConsulted: [], notes: [], synthesis: false }, agents: [] },
        }),
      ],
      'reglead',
    );
    renderRoom('reglead', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(running)) }));

    const bubble = await screen.findByRole('article', { name: /Rosa/ });
    expect(within(bubble).getByText('thinking…')).toBeInTheDocument();
    expect(within(bubble).getByText('Model output · not sourced')).toBeInTheDocument();
    expect(bubble.querySelector('img')).toHaveAttribute('src', '/avatars/reglead.svg');
    expect(screen.getByText(/In progress\. Checking for the result/)).toBeInTheDocument();
  });

  it('starts a new conversation', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderRoom('reglead', api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(api.newConversation).toHaveBeenCalledWith('reglead');
  });

  it('a scroll event that lands right after new messages render does not leave the log behind', async () => {
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(STARTED)) }));
    const log = screen.getByRole('log');
    layoutByContent(log, 400);
    scrollEventAfterEveryChange(log);

    await screen.findByText('Earlier answer.');

    expect(log.scrollHeight).toBeGreaterThan(400 + 80);
    expect(log.scrollTop).toBe(log.scrollHeight - 400);
  });

  it('keeps the newest message in view when the log gets shorter, as when the @mention chips appear after a reload', async () => {
    const layout = fakeResizeObserver();
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(STARTED)) }));
    await screen.findByText('Earlier answer.');
    const log = screen.getByRole('log');
    setBox(log, { scrollHeight: 900, clientHeight: 428 });
    log.scrollTop = 472;
    fireEvent.scroll(log); // the reader is at the bottom

    setBox(log, { clientHeight: 392 }); // the chip row arrived and took 36 px from the log
    act(() => layout.resized(log));

    expect(log.scrollTop).toBe(900);
  });

  it('leaves a reader who scrolled up where they are when the log changes size', async () => {
    const layout = fakeResizeObserver();
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(STARTED)) }));
    await screen.findByText('Earlier answer.');
    const log = screen.getByRole('log');
    setBox(log, { scrollHeight: 900, clientHeight: 428 });
    log.scrollTop = 100;
    fireEvent.scroll(log); // the reader went up to read

    setBox(log, { clientHeight: 392 });
    act(() => layout.resized(log));

    expect(log.scrollTop).toBe(100);
  });
});

describe('ChatRoom: a turn that keeps running past the polling limit', () => {
  /** Moves the fake clock in steps, each in its own act, so the poll and bound timers are re-set between steps. */
  async function advanceBy(ms: number, step = 10_000) {
    for (let done = 0; done < ms; done += step) {
      await act(() => vi.advanceTimersByTimeAsync(Math.min(step, ms - done)));
    }
  }

  it('says "Still running? Check again." without a "could not load" prefix, and keeps the question on screen', async () => {
    vi.useFakeTimers();
    try {
      const running = roomData(
        [makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Hello Rosa', seq: 1 })],
        [makeTurn({ id: 't1', roomId: 'reglead', status: 'running', finishedAt: null })],
        'reglead',
      );
      const api = fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(running)) });
      renderRoom('reglead', api);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await advanceBy(5 * 60_000 + 10_000);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Still running? Check again.');
      expect(alert).not.toHaveTextContent('Could not load');
      expect(within(alert).getByRole('button', { name: 'Check again' })).toBeInTheDocument();
      expect(screen.getByText('Hello Rosa')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatRoom: the live demo’s prompts', () => {
  it('the empty team chat lists the walkthrough’s prompts, steps 3 to 8 with 4b, instead of general starters', async () => {
    renderRoom('team', fakeApi());

    const list = await screen.findByRole('group', { name: 'Demo prompts' });
    const labels = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(
      ['3', '4', '4b', '5', '6', '7', '8'].map((step) => expect.stringMatching(new RegExp(`^Step ${step} · `))),
    );
    expect(screen.getByRole('button', { name: 'Demo prompts' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('group', { name: 'Starter prompts' })).not.toBeInTheDocument();
  });

  it('a demo prompt puts its exact text in the box and does not send it', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderRoom('team', api);
    const list = await screen.findByRole('group', { name: 'Demo prompts' });
    const box = screen.getByRole('textbox', { name: 'Message the team' });
    await waitFor(() => expect(box).toBeEnabled());

    await user.click(within(list).getByRole('button', { name: /^Step 4b · / }));

    expect(box).toHaveValue(demoText('step4b'));
    expect(api.postTurn).not.toHaveBeenCalled();
  });

  it('once the conversation has started, the demo prompts stay listed and each can be clicked again', async () => {
    const user = userEvent.setup();
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(STARTED)) }));
    await screen.findByText('Earlier answer.');
    const box = screen.getByRole('textbox', { name: 'Message the team' });
    await waitFor(() => expect(box).toBeEnabled());

    expect(screen.getByRole('button', { name: 'Demo prompts' })).toHaveAttribute('aria-expanded', 'true');
    const list = () => within(screen.getByRole('group', { name: 'Demo prompts' }));
    expect(list().getAllByRole('button')).toHaveLength(7);

    await user.click(list().getByRole('button', { name: /^Step 6 · / }));
    expect(box).toHaveValue(demoText('step6'));
    await user.click(list().getByRole('button', { name: /^Step 6 · / }));
    expect(box).toHaveValue(demoText('step6'));
    await user.click(list().getByRole('button', { name: /^Step 7 · / }));

    expect(box).toHaveValue(demoText('step7'));
    expect(list().getAllByRole('button')).toHaveLength(7);
  });

  it('a question sent from the team chat leaves the demo prompts in place for the next one', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      postTurn: vi.fn<ChatApi['postTurn']>().mockResolvedValue({
        kind: 'stream',
        clientTurnId: 'c1',
        done: { type: 'done', turnId: 't1', status: 'done' },
        broken: false,
      }),
    });
    renderRoom('team', api);
    const box = screen.getByRole('textbox', { name: 'Message the team' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(within(await screen.findByRole('group', { name: 'Demo prompts' })).getByRole('button', { name: /^Step 4b · / }));
    await user.type(box, '{Enter}');

    await waitFor(() => expect(api.postTurn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box).toBeEnabled());
    expect(screen.getByRole('group', { name: 'Demo prompts' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Demo prompts' })).getByRole('button', { name: /^Step 4b · / }));
    expect(box).toHaveValue(demoText('step4b'));
  });

  it('Rosa’s room keeps the walkthrough’s prompt and her examples after a conversation has started, and each can be clicked again', async () => {
    const user = userEvent.setup();
    const started = roomData(
      [
        makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Earlier question', seq: 1, }),
        makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Earlier answer.', seq: 2 }),
      ],
      [makeTurn({ id: 't1', roomId: 'reglead' })],
      'reglead',
    );
    renderRoom('reglead', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(started)) }));
    await screen.findByText('Earlier answer.');
    const box = screen.getByRole('textbox', { name: 'Message Rosa' });
    await waitFor(() => expect(box).toBeEnabled());

    const starters = () => within(screen.getByRole('group', { name: 'Starter prompts' }));
    expect(starters().getAllByRole('button').map((button) => button.textContent)).toEqual([demoText('step2'), ...ROSA.examplePrompts]);

    await user.click(starters().getByRole('button', { name: demoText('step2') }));
    await user.click(starters().getByRole('button', { name: demoText('step2') }));
    expect(box).toHaveValue(demoText('step2'));
    await user.click(starters().getByRole('button', { name: ROSA.examplePrompts[1] }));

    expect(box).toHaveValue(ROSA.examplePrompts[1]);
    expect(starters().getAllByRole('button')).toHaveLength(3);
  });

  it('Rosa’s empty room offers the walkthrough’s step 2 prompt first among her starters', async () => {
    const user = userEvent.setup();
    renderRoom('reglead', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(roomData([], [], 'reglead'))) }));

    const starters = await screen.findByRole('group', { name: 'Starter prompts' });
    const prompts = within(starters)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(prompts).toEqual([demoText('step2'), ...ROSA.examplePrompts]);
    expect(screen.queryByRole('button', { name: 'Demo prompts' })).not.toBeInTheDocument();

    const box = screen.getByRole('textbox', { name: 'Message Rosa' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.click(within(starters).getByRole('button', { name: demoText('step2') }));

    expect(box).toHaveValue(demoText('step2'));
  });

  it('other 1:1 rooms keep just their own starter prompts', async () => {
    renderRoom(CARLOS.id, fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(roomData([], [], CARLOS.id))) }));

    const starters = await screen.findByRole('group', { name: 'Starter prompts' });
    expect(
      within(starters)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(CARLOS.examplePrompts);
  });
});

describe('ChatRoom: bringing agents onto the team from the chat', () => {
  const ON = ['reglead', 'cmcreg', 'orc', 'san', 'ev', 'syn'];
  const NOTE = 'Oona matches this question but is not selected for this DD; add them to the team to bring them in (the Add button, the team list or the team overview).';

  /** A selection that saves like the API does: the reply is the new saved state. */
  function savingApi(overrides: Partial<ChatApi> = {}) {
    return fakeApi({
      setSelection: vi.fn<ChatApi['setSelection']>(async (agentId, selected) =>
        ok<SelectionResponse>({
          workspaceId: 'demo',
          selected: selected ? [...ON, agentId] : ON.filter((id) => id !== agentId),
          source: 'saved',
        }),
      ),
      ...overrides,
    });
  }

  const LEFT_OUT = roomData(
    [
      makeMessage({ id: 'u1', turnId: 't1', author: 'human', text: 'Is orphan designation likely?', seq: 1 }),
      makeMessage({ id: 'n1', turnId: 't1', author: 'note', text: NOTE, seq: 2 }),
      makeMessage({ id: 'a1', turnId: 't1', author: 'agent', agentId: 'reglead', agentName: 'Rosa', text: 'Here is how I would look at it.', seq: 3 }),
    ],
    [
      makeTurn({
        id: 't1',
        trace: {
          route: {
            source: 'keyword',
            primary: 'reglead',
            secondaries: [],
            notConsulted: [{ agentId: 'sp-orphan', reason: 'not_selected' }],
            notes: [NOTE],
            synthesis: false,
          },
          agents: [{ agentId: 'reglead', agentName: 'Rosa', role: 'primary', state: 'answered', messageId: 'a1' }],
        },
      }),
    ],
  );

  it('offers the team list in the team chat and not in an agent’s 1:1 room', async () => {
    const { unmount } = renderRoom('team', savingApi());
    expect(await screen.findByRole('button', { name: /Team for this DD/ })).toBeInTheDocument();
    unmount();

    renderRoom('reglead', savingApi());
    await screen.findByRole('textbox', { name: 'Message Rosa' });
    expect(screen.queryByRole('button', { name: /Team for this DD/ })).not.toBeInTheDocument();
  });

  it('adds an agent the router left out from the button under the note, and the @mention chip appears at once', async () => {
    const user = userEvent.setup();
    const api = savingApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(LEFT_OUT)) });
    renderRoom('team', api);
    const chips = await screen.findByRole('group', { name: 'Mention an agent' });
    expect(within(chips).queryByRole('button', { name: '@Oona' })).not.toBeInTheDocument();

    const log = screen.getByRole('log');
    await user.click(await within(log).findByRole('button', { name: /Add Oona/ }));

    expect(api.setSelection).toHaveBeenCalledWith('sp-orphan', true);
    expect(await within(log).findByText(/Added: Oona can join from your next question/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Mention an agent' })).getByRole('button', { name: '@Oona' })).toBeInTheDocument();
  });

  it('shows the offer straight after the note and before the answer', async () => {
    renderRoom('team', savingApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(LEFT_OUT)) }));

    const add = await within(screen.getByRole('log')).findByRole('button', { name: /Add Oona/ });
    // "How this turn ran" lists the route's notes too, further down; the first match is the one in the thread.
    const note = within(screen.getByRole('log')).getAllByText(NOTE)[0];
    const answer = within(screen.getByRole('log')).getByText('Here is how I would look at it.');

    expect(note.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('switching an agent on in the list adds the @mention chip, and switching off takes it away', async () => {
    const user = userEvent.setup();
    renderRoom('team', savingApi());
    await user.click(await screen.findByRole('button', { name: /Team for this DD/ }));

    await user.click(screen.getByRole('switch', { name: /Cyrus/ }));
    expect(within(screen.getByRole('group', { name: 'Mention an agent' })).getByRole('button', { name: '@Cyrus' })).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /Carlos/ }));
    expect(within(screen.getByRole('group', { name: 'Mention an agent' })).queryByRole('button', { name: '@Carlos' })).not.toBeInTheDocument();
  });

  it('leaves the chips alone when a save fails', async () => {
    const user = userEvent.setup();
    const api = savingApi({
      getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(LEFT_OUT)),
      setSelection: vi.fn<ChatApi['setSelection']>().mockResolvedValue({
        ok: false,
        status: 500,
        error: { error: 'internal', message: 'Could not save the selection.', correlationId: 'corr-r1' },
        message: 'Could not save the selection.',
      }),
    });
    renderRoom('team', api);

    await user.click(await within(screen.getByRole('log')).findByRole('button', { name: /Add Oona/ }));

    expect(within(screen.getByRole('log')).getByRole('alert')).toHaveTextContent('corr-r1');
    expect(within(screen.getByRole('group', { name: 'Mention an agent' })).queryByRole('button', { name: '@Oona' })).not.toBeInTheDocument();
  });
});
