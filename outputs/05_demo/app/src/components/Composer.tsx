'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatLimits } from '@/shared/contracts';
import type { SendOutcome } from '@/client/use-chat-room';

const MAX_CHARS: ChatLimits['turnTextMaxChars'] = 8000;
/** The counter appears this close to the limit. */
const COUNTER_FROM = MAX_CHARS - 1000;

const formatCount = (value: number) => value.toLocaleString('en');

export interface ComposerProps {
  /** Accessible name of the text box, e.g. "Message Rosa". */
  label: string;
  /** Receives the trimmed text. Any outcome but `sent` puts the text back in the box. */
  onSend: (text: string) => Promise<SendOutcome> | SendOutcome | void;
  /** While a turn runs, or when sending cannot work (setup missing). */
  disabled?: boolean;
  disabledReason?: string | null;
  placeholder?: string;
  /** Team chat: each chip inserts "@Name ". */
  mentionChips?: Array<{ id: string; name: string }>;
  /** Shown while the room is empty; a click fills the box. */
  starterPrompts?: string[];
  /**
   * The team chat: the live demo's prompts, listed under a "Demo prompts" toggle. A click puts
   * the prompt's exact text in the box (it does not send) and folds the list away.
   */
  demoPrompts?: ReadonlyArray<{ id: string; label: string; text: string }>;
  /** Whether that list is open (the team chat: while it is empty) until the person opens or closes it. */
  demoPromptsOpenByDefault?: boolean;
}

export function Composer({
  label,
  onSend,
  disabled = false,
  disabledReason,
  placeholder,
  mentionChips = [],
  starterPrompts = [],
  demoPrompts = [],
  demoPromptsOpenByDefault = false,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** null until the person opens or closes the demo prompts; then their choice stands. */
  const [demoOpenChoice, setDemoOpenChoice] = useState<boolean | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submittingNow = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const refocusWhenEnabled = useRef(false);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const hintId = `${baseId}-hint`;
  const statusId = `${baseId}-status`;
  const demoListId = `${baseId}-demo`;

  const length = text.trim().length;
  const over = length - MAX_CHARS;
  const canSend = !disabled && !submitting && length > 0 && over <= 0;

  // Put the caret after an inserted mention or starter prompt.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const element = textarea.current;
    if (caret === null || !element) return;
    pendingCaret.current = null;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [text]);

  // A disabled text box loses focus; give it back when the turn is over.
  useEffect(() => {
    if (!disabled && refocusWhenEnabled.current) {
      refocusWhenEnabled.current = false;
      textarea.current?.focus();
    }
  }, [disabled]);

  async function submit() {
    if (!canSend || submittingNow.current) return;
    submittingNow.current = true;
    // Enter (focus in the box) or the Send button (focus on the button): either way, come back here.
    refocusWhenEnabled.current = typeof document !== 'undefined' && !!form.current?.contains(document.activeElement);
    setSubmitting(true);
    const draft = text;
    setText('');
    try {
      const outcome = await onSend(draft.trim());
      // Nothing was sent (refused, or ignored because something else was under way): the text comes back.
      if (outcome && outcome.status !== 'sent') setText((current) => (current === '' ? draft : current));
    } finally {
      submittingNow.current = false;
      setSubmitting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function insert(piece: string) {
    const element = textarea.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const spaced = before !== '' && !/\s$/.test(before) ? ` ${piece}` : piece;
    pendingCaret.current = before.length + spaced.length;
    setText(before + spaced + text.slice(end));
  }

  function applyStarter(prompt: string) {
    pendingCaret.current = prompt.length;
    setText(prompt);
  }

  function applyDemoPrompt(prompt: string) {
    applyStarter(prompt);
    setDemoOpenChoice(false);
  }

  const showCounter = length >= COUNTER_FROM;
  // While the box is disabled, "Enter sends" is not true: the reason takes the hint's place.
  const busyReason = disabled && disabledReason ? disabledReason : null;
  const describedBy = busyReason ? statusId : hintId;
  const demoOpen = demoPrompts.length > 0 && (demoOpenChoice ?? demoPromptsOpenByDefault);

  return (
    <form
      ref={form}
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {starterPrompts.length > 0 && (
        <div className="starters" role="group" aria-label="Starter prompts">
          {starterPrompts.map((prompt) => (
            <button key={prompt} type="button" className="chip starter" disabled={disabled} onClick={() => applyStarter(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}
      {mentionChips.length > 0 && (
        <div className="chips mention-chips" role="group" aria-label="Mention an agent">
          {mentionChips.map((chip) => (
            <button key={chip.id} type="button" className="chip" disabled={disabled} onClick={() => insert(`@${chip.name} `)}>
              @{chip.name}
            </button>
          ))}
        </div>
      )}
      <label className="visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <div className="composer-row">
        <textarea
          id={inputId}
          ref={textarea}
          className="input composer-input"
          value={text}
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={over > 0}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn btn-primary" disabled={!canSend}>
          Send
        </button>
      </div>
      <div className="composer-foot">
        {busyReason ? (
          <span id={statusId} className="composer-status" role="status">
            {busyReason}
          </span>
        ) : (
          <span id={hintId} className="note">
            Enter sends · Shift+Enter adds a line
          </span>
        )}
        {showCounter && (
          <span className={over > 0 ? 'counter counter-over' : 'counter'} aria-live="polite">
            {formatCount(length)} / {formatCount(MAX_CHARS)}
            {over > 0 ? ` · ${formatCount(over)} ${over === 1 ? 'character' : 'characters'} too long` : ''}
          </span>
        )}
        {demoPrompts.length > 0 && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-expanded={demoOpen}
            aria-controls={demoOpen ? demoListId : undefined}
            onClick={() => setDemoOpenChoice(!demoOpen)}
          >
            Demo prompts <span aria-hidden="true">{demoOpen ? '▾' : '▸'}</span>
          </button>
        )}
      </div>
      {demoOpen && (
        <div id={demoListId} className="starters" role="group" aria-label="Demo prompts">
          {demoPrompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              className="chip starter"
              title={prompt.text}
              disabled={disabled}
              onClick={() => applyDemoPrompt(prompt.text)}
            >
              {prompt.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
