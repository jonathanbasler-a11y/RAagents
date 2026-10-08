import type { ChatErrorCode, PublicAgent } from '@/shared/contracts';
import type { TimelineItem } from '@/client/timeline';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { describeChatError, shortCapability } from './labels';

type AgentItem = Extract<TimelineItem, { kind: 'agent' }>;

/** Rendered by code on every agent bubble: model output is never a source. */
export const MODEL_OUTPUT_LABEL = 'Model output · not sourced';

export function PencilIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M11.2 2.4l2.4 2.4-8.1 8.1-3.2.8.8-3.2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.7 3.9l2.4 2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ErrorDetail({ code, correlationId, lead }: { code: ChatErrorCode | null; correlationId: string | null; lead: string }) {
  const info = describeChatError(code);
  return (
    <p className="bubble-error">
      <strong>{info.title}:</strong> {lead} {info.text}
      {correlationId && (
        <>
          {' '}
          <span className="mono ref">Reference {correlationId}</span>
        </>
      )}
    </p>
  );
}

/**
 * One agent reply. Text received is always shown: an error or a broken stream adds a
 * badge and an explanation, it never replaces the text.
 */
export function AgentBubble({ item, agent }: { item: AgentItem; agent?: PublicAgent }) {
  const name = item.agentName || agent?.name || 'Agent';
  const capability = agent ? shortCapability(agent) : null;
  const letter = (agent?.letter ?? name.charAt(0) ?? '?').toUpperCase();
  const avatarSrc = agent?.avatar ?? (item.agentId !== 'unknown' ? `/avatars/${item.agentId}.svg` : null);
  const waiting = item.state === 'waiting';
  const thinking = item.state === 'thinking';
  const failed = item.state === 'error';
  const brokeOff = item.state === 'partial';
  const hasErrorDetail = item.errorCode !== null || item.correlationId !== null;

  return (
    <article className={`bubble bubble-agent is-${item.state}`} aria-label={capability ? `${name}, ${capability}` : name}>
      <Avatar src={avatarSrc} letter={letter} />
      <div className="bubble-main">
        <header className="bubble-head">
          <span className="bubble-name">{name}</span>
          {capability && <span className="bubble-cap">{capability}</span>}
          <span className="label-model">
            <PencilIcon />
            {MODEL_OUTPUT_LABEL}
          </span>
          {item.truncated && (
            <span className="badge" title="The reply stopped at the output limit.">
              cut off
            </span>
          )}
          {brokeOff && (
            <span className="badge" title="The reply broke off before the end. The text so far is kept.">
              interrupted
            </span>
          )}
          {item.unsaved && (
            <span className="badge badge-warn" title="The server did not save this reply. It is shown as received.">
              not saved
            </span>
          )}
        </header>
        {/* Not a live region: the room's log is the one region, busy until the turn ends. */}
        <div className="bubble-body pencil">
          {waiting && <p className="thinking">waiting…</p>}
          {thinking && <p className="thinking">thinking…</p>}
          {item.text !== '' && <Markdown text={item.text} />}
        </div>
        {item.state === 'detached' && (
          <p className="bubble-note">Live updates stopped. The saved reply will replace this text.</p>
        )}
        {(failed || brokeOff) && hasErrorDetail && (
          <ErrorDetail
            code={item.errorCode}
            correlationId={item.correlationId}
            lead={brokeOff ? 'The reply broke off.' : 'The reply failed.'}
          />
        )}
        {failed && !hasErrorDetail && <p className="bubble-error">The reply failed.</p>}
      </div>
    </article>
  );
}

export function HumanBubble({ text, pending }: { text: string; pending: boolean }) {
  return (
    <article className="bubble bubble-human" aria-label="Your question">
      <div className="bubble-main">
        <header className="bubble-head">
          <span className="bubble-name">You</span>
          {pending && <span className="badge">sending…</span>}
        </header>
        <p className="bubble-body ink">{text}</p>
      </div>
    </article>
  );
}

/** A small line written by code: routing notes, "had nothing to add", turn failures. */
export function SystemLine({
  tone,
  text,
  errorCode,
  correlationId,
}: {
  tone: 'note' | 'error';
  text: string;
  errorCode: ChatErrorCode | null;
  correlationId: string | null;
}) {
  const info = errorCode ? describeChatError(errorCode) : null;
  return (
    <p className={tone === 'error' ? 'sysline sysline-error' : 'sysline'}>
      <span>{text}</span>
      {info && (
        <>
          {' '}
          <strong>{info.title}:</strong> {info.text}
        </>
      )}
      {correlationId && (
        <>
          {' '}
          <span className="mono ref">Reference {correlationId}</span>
        </>
      )}
    </p>
  );
}
