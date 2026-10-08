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

  it('once the conversation has started, the demo prompts wait under the "Demo prompts" toggle', async () => {
    const user = userEvent.setup();
    renderRoom('team', fakeApi({ getMessages: vi.fn<ChatApi['getMessages']>().mockResolvedValue(ok(STARTED)) }));
    await screen.findByText('Earlier answer.');
    const box = screen.getByRole('textbox', { name: 'Message the team' });
    await waitFor(() => expect(box).toBeEnabled());
    const toggle = screen.getByRole('button', { name: 'Demo prompts' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Demo prompts' })).not.toBeInTheDocument();

    await user.click(toggle);
    await user.click(within(screen.getByRole('group', { name: 'Demo prompts' })).getByRole('button', { name: /^Step 6 · / }));

    expect(box).toHaveValue(demoText('step6'));
    expect(screen.queryByRole('group', { name: 'Demo prompts' })).not.toBeInTheDocument();
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
