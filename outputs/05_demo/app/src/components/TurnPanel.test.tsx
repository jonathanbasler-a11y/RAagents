// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TurnTrace } from '@/shared/contracts';
import { makeTurn } from '@/client/test-fixtures';
import { TurnPanel } from './TurnPanel';

// jsdom has no layout, so no scrollIntoView. Opening a panel calls it: every test records the calls.
const jsdomScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
let scrollIntoView: Mock;
beforeEach(() => {
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
});
afterEach(() => {
  if (jsdomScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', jsdomScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const TRACE: TurnTrace = {
  route: {
    source: 'keyword',
    primary: 'reglead',
    secondaries: ['cmcreg'],
    notConsulted: [{ agentId: 'label', reason: 'over_cap' }],
    notes: ['Ines is not selected for this DD; switch her on to bring her in.'],
    synthesis: true,
    matchedTerms: { reglead: ['orphan', 'designation'], cmcreg: ['comparability'] },
  },
  agents: [
    { agentId: 'reglead', agentName: 'Rosa', role: 'primary', state: 'answered', model: 'model-a', durationMs: 8400 },
    { agentId: 'cmcreg', agentName: 'Carlos', role: 'secondary', state: 'no_addition', model: 'model-a', durationMs: 2100 },
    { agentId: 'label', agentName: 'Lena', role: 'secondary', state: 'not_consulted', reason: 'over_cap' },
    { agentId: 'syn', agentName: 'Sofia', role: 'synthesis', state: 'failed', errorCode: 'llm_timeout', model: 'model-b', durationMs: 120000 },
  ],
};

const TURN = makeTurn({
  id: 't1',
  status: 'partial',
  trace: TRACE,
  startedAt: '2026-10-07T09:00:00.000Z',
  finishedAt: '2026-10-07T09:00:12.400Z',
});

describe('TurnPanel', () => {
  it('is collapsed until opened', async () => {
    const user = userEvent.setup();
    render(<TurnPanel turn={TURN} />);
    const summary = screen.getByText('How this turn ran');
    const details = summary.closest('details');

    expect(details).not.toHaveAttribute('open');

    await user.click(summary);

    expect(details).toHaveAttribute('open');
  });

  it('when opened, scrolls just enough to show the whole panel; closing it does not scroll', async () => {
    const user = userEvent.setup();
    render(<TurnPanel turn={TURN} />);
    const summary = screen.getByText('How this turn ran');
    const details = summary.closest('details') as HTMLDetailsElement;
    // The toggle event is queued as a task after the click; the panel's handler runs before this one.
    const toggled = () => new Promise((resolve) => details.addEventListener('toggle', resolve, { once: true }));

    let event = toggled();
    await user.click(summary);
    await event;

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(details);

    event = toggled();
    await user.click(summary);
    await event;

    expect(details).not.toHaveAttribute('open');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('shows the status, route source, models and duration from the trace', () => {
    render(<TurnPanel turn={TURN} />);

    expect(screen.getByText('Partial: some text is missing')).toBeInTheDocument();
    expect(screen.getByText('Routing terms in the question chose the agents')).toBeInTheDocument();
    expect(screen.getByText('model-a, model-b')).toBeInTheDocument();
    expect(screen.getAllByText(/12\.4 s/).length).toBeGreaterThan(0);
  });

  it('lists every agent with its part and a distinct state', () => {
    render(<TurnPanel turn={TURN} />);

    const rosa = screen.getByRole('row', { name: /Rosa/ });
    expect(within(rosa).getByText('answers first')).toBeInTheDocument();
    expect(within(rosa).getByText('answered')).toBeInTheDocument();
    expect(within(rosa).getByText('8.4 s')).toBeInTheDocument();

    expect(within(screen.getByRole('row', { name: /Carlos/ })).getByText('nothing to add')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Lena/ })).getByText('matched, not consulted (over the cap)'),
    ).toBeInTheDocument();

    const sofia = screen.getByRole('row', { name: /Sofia/ });
    expect(within(sofia).getByText(/failed/)).toBeInTheDocument();
    expect(within(sofia).getByText(/took too long/)).toBeInTheDocument();
    expect(within(sofia).getByText('2 min 00 s')).toBeInTheDocument();
  });

  it('shows the matched routing terms and the route notes', () => {
    render(<TurnPanel turn={TURN} />);

    expect(screen.getByText(/Rosa: orphan, designation/)).toBeInTheDocument();
    expect(screen.getByText(/Carlos: comparability/)).toBeInTheDocument();
    expect(screen.getByText('Ines is not selected for this DD; switch her on to bring her in.')).toBeInTheDocument();
  });

  it('never says "no model call" when a call ran but reported no model: it failed', () => {
    const trace: TurnTrace = {
      route: { source: 'direct', primary: 'ops', secondaries: [], notConsulted: [], notes: [], synthesis: false },
      agents: [{ agentId: 'ops', agentName: 'Olu', role: 'solo', state: 'failed', errorCode: 'llm_outage', durationMs: 1800, messageId: 'm1' }],
    };
    render(<TurnPanel turn={makeTurn({ id: 't3', status: 'error', trace, errorCode: 'llm_outage', correlationId: 'corr-1' })} />);

    expect(screen.queryByText('no model call')).not.toBeInTheDocument();
    expect(screen.getByText('not reported (no call completed)')).toBeInTheDocument();
  });

  it('never says "no model call" for a turn the restart interrupted', () => {
    const trace: TurnTrace = {
      route: { source: 'direct', primary: 'ops', secondaries: [], notConsulted: [], notes: [], synthesis: false },
      agents: [],
    };
    render(<TurnPanel turn={makeTurn({ id: 't4', status: 'interrupted', trace })} />);

    expect(screen.queryByText('no model call')).not.toBeInTheDocument();
    expect(screen.getByText('not reported (no call completed)')).toBeInTheDocument();
  });

  it('says "no model call" when no agent was consulted (positive control)', () => {
    const trace: TurnTrace = {
      route: { source: 'explicit', secondaries: [], notConsulted: [{ agentId: 'label', reason: 'not_selected' }], notes: [], synthesis: false },
      agents: [{ agentId: 'label', agentName: 'Lena', role: 'secondary', state: 'not_consulted', reason: 'not_selected' }],
    };
    render(<TurnPanel turn={makeTurn({ id: 't5', status: 'error', trace })} />);

    expect(screen.getByText('no model call')).toBeInTheDocument();
  });

  it('gives an agent who was not consulted no part in the turn', () => {
    render(<TurnPanel turn={TURN} />);

    const lena = screen.getByRole('row', { name: /Lena/ });
    expect(within(lena).queryByText('adds to it')).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Carlos/ })).getByText('adds to it')).toBeInTheDocument();
  });

  it('shows the turn reference when the turn failed', () => {
    render(
      <TurnPanel
        turn={makeTurn({ id: 't2', status: 'error', trace: TRACE, errorCode: 'llm_auth', correlationId: 'corr-42' })}
      />,
    );

    expect(screen.getByText('Error: no usable answer')).toBeInTheDocument();
    expect(screen.getByText('corr-42')).toBeInTheDocument();
  });
});
