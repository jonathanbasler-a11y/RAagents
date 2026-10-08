// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OLU, ROSA } from '@/client/test-fixtures';
import type { TimelineItem } from '@/client/timeline';
import { AgentBubble, HumanBubble, SystemLine } from './MessageBubble';

type AgentItem = Extract<TimelineItem, { kind: 'agent' }>;

function agentItem(overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    kind: 'agent',
    key: 'm1',
    messageId: 'm1',
    agentId: 'reglead',
    agentName: 'Rosa',
    text: 'Start with the designation status.',
    state: 'complete',
    truncated: false,
    errorCode: null,
    correlationId: null,
    unsaved: false,
    ...overrides,
  };
}

describe('AgentBubble', () => {
  it('shows the avatar, name, capability and the "Model output · not sourced" label', () => {
    render(<AgentBubble item={agentItem()} agent={ROSA} />);

    const bubble = screen.getByRole('article', { name: /Rosa/ });
    expect(within(bubble).getByText('Rosa')).toBeInTheDocument();
    expect(within(bubble).getByText('Regulatory lead')).toBeInTheDocument();
    expect(within(bubble).getByText('Model output · not sourced')).toBeInTheDocument();
    expect(bubble.querySelector('img')).toHaveAttribute('src', '/avatars/reglead.svg');
    expect(within(bubble).getByText('Start with the designation status.')).toBeInTheDocument();
  });

  it('uses the short capability when the agent has one', () => {
    render(<AgentBubble item={agentItem({ agentId: 'ops', agentName: 'Olu' })} agent={OLU} />);

    expect(screen.getByText('Regulatory operations')).toBeInTheDocument();
  });

  it('a "thinking…" placeholder still names its speaker', () => {
    render(<AgentBubble item={agentItem({ text: '', state: 'thinking' })} agent={ROSA} />);

    const bubble = screen.getByRole('article', { name: /Rosa/ });
    expect(within(bubble).getByText('thinking…')).toBeInTheDocument();
    expect(within(bubble).getByText('Regulatory lead')).toBeInTheDocument();
    expect(bubble.querySelector('img')).toHaveAttribute('src', '/avatars/reglead.svg');
  });

  it('is not a live region of its own: the room log announces a reply once, when the turn ends', () => {
    const { container } = render(<AgentBubble item={agentItem({ text: 'Partial', state: 'streaming' })} agent={ROSA} />);

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });

  it('shows a "cut off" badge for a truncated reply', () => {
    render(<AgentBubble item={agentItem({ truncated: true })} agent={ROSA} />);

    expect(screen.getByText('cut off')).toBeInTheDocument();
    expect(screen.queryByText('interrupted')).not.toBeInTheDocument();
  });

  it('shows an "interrupted" badge for a partial reply and keeps its text', () => {
    render(
      <AgentBubble
        item={agentItem({ state: 'partial', text: 'The first half', errorCode: 'llm_network', correlationId: 'corr-8' })}
        agent={ROSA}
      />,
    );

    expect(screen.getByText('interrupted')).toBeInTheDocument();
    expect(screen.getByText('The first half')).toBeInTheDocument();
    expect(screen.getByText(/corr-8/)).toBeInTheDocument();
  });

  it('an error bubble keeps the partial text and shows a short message with the correlation id', () => {
    render(
      <AgentBubble
        item={agentItem({ state: 'error', text: 'Half an answer', errorCode: 'llm_timeout', correlationId: 'corr-5' })}
        agent={ROSA}
      />,
    );

    expect(screen.getByText('Half an answer')).toBeInTheDocument();
    expect(screen.getByText(/took too long/i)).toBeInTheDocument();
    expect(screen.getByText(/corr-5/)).toBeInTheDocument();
  });

  it('tells a setup problem apart from a service problem', () => {
    const { unmount } = render(
      <AgentBubble item={agentItem({ state: 'error', text: '', errorCode: 'llm_config', correlationId: 'c1' })} agent={ROSA} />,
    );
    expect(screen.getByText(/setup problem/i)).toBeInTheDocument();
    unmount();

    render(<AgentBubble item={agentItem({ state: 'error', text: '', errorCode: 'llm_outage', correlationId: 'c2' })} agent={ROSA} />);
    expect(screen.getByText(/service problem/i)).toBeInTheDocument();
  });

  it('writes agent text in graphite (pencil)', () => {
    render(<AgentBubble item={agentItem()} agent={ROSA} />);

    expect(screen.getByText('Start with the designation status.').closest('.pencil')).not.toBeNull();
  });

  it('marks a reply the server did not save', () => {
    render(<AgentBubble item={agentItem({ unsaved: true, state: 'partial' })} agent={ROSA} />);

    expect(screen.getByText('not saved')).toBeInTheDocument();
  });
});

describe('HumanBubble', () => {
  it('shows your text in ink, as written', () => {
    render(<HumanBubble text={'Line one\nLine two'} pending={false} />);

    const body = screen.getByText(/Line one/);
    expect(body.closest('.ink')).not.toBeNull();
    expect(body.textContent).toBe('Line one\nLine two');
    expect(screen.queryByText('Model output · not sourced')).not.toBeInTheDocument();
  });

  it('says "sending…" until the server has the question', () => {
    render(<HumanBubble text="Hello" pending />);

    expect(screen.getByText('sending…')).toBeInTheDocument();
  });
});

describe('SystemLine', () => {
  it('renders a note as a small line, not as a bubble', () => {
    render(<SystemLine tone="note" text="Carlos had nothing to add." errorCode={null} correlationId={null} />);

    expect(screen.getByText('Carlos had nothing to add.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders a turn failure with its short message and reference', () => {
    render(<SystemLine tone="error" text="This turn failed." errorCode="llm_auth" correlationId="corr-11" />);

    expect(screen.getByText(/This turn failed\./)).toBeInTheDocument();
    expect(screen.getByText(/setup problem/i)).toBeInTheDocument();
    expect(screen.getByText(/corr-11/)).toBeInTheDocument();
  });
});
