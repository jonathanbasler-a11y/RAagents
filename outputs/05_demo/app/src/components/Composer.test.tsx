// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SendOutcome } from '@/client/use-chat-room';
import { Composer } from './Composer';

const sent = (): Promise<SendOutcome> => Promise.resolve({ status: 'sent' });

function box(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Message Rosa' }) as HTMLTextAreaElement;
}

const DEMO = [
  { id: 'two-mentions', label: 'Step 3 · Two mentions', text: '@Rosa @Carlos What should our DD check?' },
  { id: 'decision', label: 'Step 6 · A decision', text: 'Should we buy this asset?' },
];

const demoToggle = () => screen.getByRole('button', { name: 'Demo prompts' });
const demoList = () => screen.queryByRole('group', { name: 'Demo prompts' });

describe('Composer', () => {
  it('Enter sends the text and clears the box', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} />);

    await user.type(box(), 'What should I check first?{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('What should I check first?');
    expect(box()).toHaveValue('');
  });

  it('Shift+Enter adds a new line instead of sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} />);

    await user.type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(box()).toHaveValue('Line one\nLine two');
  });

  it('the Send button sends too, but not an empty box', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(box(), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.type(box(), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Hi');
  });

  it('is disabled while busy, and says why', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} disabled disabledReason="Waiting for the reply…" />);

    expect(box()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Waiting for the reply…')).toBeInTheDocument();

    await user.type(box(), 'Hello{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a character counter near the 8,000 limit', () => {
    render(<Composer label="Message Rosa" onSend={vi.fn(sent)} />);
    expect(screen.queryByText(/\/ 8,000/)).not.toBeInTheDocument();

    fireEvent.change(box(), { target: { value: 'x'.repeat(7500) } });

    expect(screen.getByText('7,500 / 8,000')).toBeInTheDocument();
  });

  it('blocks sending over 8,000 characters and says by how much', async () => {
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} />);

    fireEvent.change(box(), { target: { value: 'x'.repeat(8003) } });
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText(/3 characters too long/)).toBeInTheDocument();
  });

  it('sends exactly 8,000 characters', () => {
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} />);

    fireEvent.change(box(), { target: { value: 'x'.repeat(8000) } });
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('puts the text back when it was not sent', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn((): Promise<SendOutcome> => Promise.resolve({ status: 'not_sent', reason: 'offline' }));
    render(<Composer label="Message Rosa" onSend={onSend} />);

    await user.type(box(), 'Keep me{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue('Keep me');
  });

  it('puts the text back when the room ignored it because something else was under way', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn((): Promise<SendOutcome> => Promise.resolve({ status: 'ignored' }));
    render(<Composer label="Message Rosa" onSend={onSend} />);

    await user.type(box(), 'Do not lose me{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(box()).toHaveValue('Do not lose me');
  });

  it('mention chips insert "@Name " at the caret', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        label="Message Rosa"
        onSend={vi.fn(sent)}
        mentionChips={[
          { id: 'reglead', name: 'Rosa' },
          { id: 'cmcreg', name: 'Carlos' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '@Rosa' }));
    expect(box()).toHaveValue('@Rosa ');

    await user.type(box(), 'and');
    await user.click(screen.getByRole('button', { name: '@Carlos' }));
    expect(box()).toHaveValue('@Rosa and @Carlos ');
    expect(box()).toHaveFocus();
  });

  it('starter prompts fill the box without sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(
      <Composer label="Message Rosa" onSend={onSend} starterPrompts={['How would you scope the regulatory part of a DD?']} />,
    );

    await user.click(screen.getByRole('button', { name: 'How would you scope the regulatory part of a DD?' }));

    expect(box()).toHaveValue('How would you scope the regulatory part of a DD?');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('gives focus back to the box when the turn ends, also after clicking Send', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return (
        <>
          <Composer
            label="Message Rosa"
            disabled={busy}
            onSend={async () => {
              setBusy(true);
              return { status: 'sent' };
            }}
          />
          <button type="button" onClick={() => setBusy(false)}>
            Turn ends
          </button>
        </>
      );
    }
    render(<Harness />);

    await user.type(box(), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(box()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Turn ends' }));

    expect(box()).toHaveFocus();
  });

  it('a second Enter while the first send is pending does not send twice', async () => {
    let release: (outcome: SendOutcome) => void = () => undefined;
    const onSend = vi.fn(
      () =>
        new Promise<SendOutcome>((resolve) => {
          release = resolve;
        }),
    );
    render(<Composer label="Message Rosa" onSend={onSend} />);

    fireEvent.change(box(), { target: { value: 'Once' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.change(box(), { target: { value: 'Twice' } });
    fireEvent.keyDown(box(), { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => release({ status: 'sent' }));
  });

  it('while busy, says why in place of the key hint, which is not true then', () => {
    const { rerender } = render(<Composer label="Message Rosa" onSend={vi.fn(sent)} disabled disabledReason="Waiting for the reply…" />);

    expect(box()).toHaveAccessibleDescription('Waiting for the reply…');
    expect(screen.queryByText('Enter sends · Shift+Enter adds a line')).not.toBeInTheDocument();

    rerender(<Composer label="Message Rosa" onSend={vi.fn(sent)} />);

    expect(box()).toHaveAccessibleDescription('Enter sends · Shift+Enter adds a line');
    expect(screen.queryByText('Waiting for the reply…')).not.toBeInTheDocument();
  });
});

describe('Composer: demo prompts', () => {
  it('keeps them under a "Demo prompts" toggle that opens and closes the list', async () => {
    const user = userEvent.setup();
    render(<Composer label="Message Rosa" onSend={vi.fn(sent)} demoPrompts={DEMO} />);

    expect(demoToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(demoList()).not.toBeInTheDocument();

    await user.click(demoToggle());

    const list = screen.getByRole('group', { name: 'Demo prompts' });
    expect(demoToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(demoToggle()).toHaveAttribute('aria-controls', list.id);
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Step 3 · Two mentions', 'Step 6 · A decision']);
    expect(buttons[0]).toHaveAccessibleDescription('@Rosa @Carlos What should our DD check?');

    await user.click(demoToggle());

    expect(demoToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(demoList()).not.toBeInTheDocument();
  });

  it('a click puts the exact text in the box, replacing a draft, without sending; the list folds away', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(sent);
    render(<Composer label="Message Rosa" onSend={onSend} demoPrompts={DEMO} demoPromptsOpenByDefault />);
    await user.type(box(), 'a draft');

    await user.click(screen.getByRole('button', { name: 'Step 3 · Two mentions' }));

    expect(box()).toHaveValue('@Rosa @Carlos What should our DD check?');
    expect(box()).toHaveFocus();
    expect(onSend).not.toHaveBeenCalled();
    expect(demoList()).not.toBeInTheDocument();
    expect(demoToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('follows the room’s default (open while it is empty) until the person opens or closes the list', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Composer label="Message Rosa" onSend={vi.fn(sent)} demoPrompts={DEMO} demoPromptsOpenByDefault={false} />);
    expect(demoList()).not.toBeInTheDocument();

    rerender(<Composer label="Message Rosa" onSend={vi.fn(sent)} demoPrompts={DEMO} demoPromptsOpenByDefault />);
    expect(demoList()).toBeInTheDocument();

    await user.click(demoToggle());
    rerender(<Composer label="Message Rosa" onSend={vi.fn(sent)} demoPrompts={DEMO} demoPromptsOpenByDefault={false} />);
    rerender(<Composer label="Message Rosa" onSend={vi.fn(sent)} demoPrompts={DEMO} demoPromptsOpenByDefault />);

    expect(demoList()).not.toBeInTheDocument();
  });

  it('can be read but not used while the box is disabled', () => {
    render(
      <Composer
        label="Message Rosa"
        onSend={vi.fn(sent)}
        demoPrompts={DEMO}
        demoPromptsOpenByDefault
        disabled
        disabledReason="Waiting for the reply…"
      />,
    );

    const buttons = within(screen.getByRole('group', { name: 'Demo prompts' })).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
  });
});
