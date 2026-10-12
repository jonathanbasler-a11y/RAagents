import Link from 'next/link';
import type { AutonomyLevel, PublicAgent } from '@/shared/contracts';
import { Avatar } from './Avatar';
import { AUTONOMY_LABELS, GROUP_INFO, triggerText } from './labels';
import { Markdown } from './Markdown';
import { SelectionSwitch } from './SelectionSwitch';

function Meter({ level }: { level: AutonomyLevel }) {
  return (
    <span className="meter" aria-hidden="true">
      {[1, 2, 3].map((step) => (
        <i key={step} className={step <= level ? 'on' : 'off'} />
      ))}
    </span>
  );
}

const PROFILE_SECTIONS: Array<{ key: keyof PublicAgent['profile']; title: string }> = [
  { key: 'role', title: 'Role' },
  { key: 'plannedKnowledgeSources', title: 'Planned knowledge sources' },
  { key: 'tools', title: 'Tools' },
  { key: 'guardrails', title: 'Guardrails' },
  { key: 'escalationLines', title: 'Escalation lines' },
  { key: 'autonomyLevel', title: 'Autonomy level' },
];

/** One agent on the team page. Spec text is written by people (ink); the remit is marked planned. */
export function ProfileCard({ agent }: { agent: PublicAgent }) {
  const nameId = `agent-${agent.id}-name`;
  const trigger = triggerText(agent.trigger);
  return (
    <article className="agent-card" id={`agent-${agent.id}`} aria-labelledby={nameId}>
      <div className="agent-top">
        <span className="tag">{GROUP_INFO[agent.group].tag}</span>
        <span className="badge" title="Autonomy level">
          <Meter level={agent.autonomyLevel} />
          {AUTONOMY_LABELS[agent.autonomyLevel]}
        </span>
        <SelectionSwitch agent={agent} />
      </div>
      <div className="agent-id">
        <Avatar src={agent.avatar} letter={agent.letter} size={56} />
        <div>
          <h3 id={nameId} className="agent-name">
            {agent.name}
          </h3>
          <p className="agent-cap">{agent.capability}</p>
        </div>
      </div>
      <dl className="kv">
        <dt>Human owner</dt>
        <dd>{agent.humanOwner}</dd>
        <dt>
          Remit <span className="tag tag-planned">planned</span>
        </dt>
        <dd className="planned">{agent.plannedRemit}</dd>
      </dl>
      {trigger && <p className="trig">{trigger}</p>}
      <details className="spec">
        <summary>
          Profile<span className="visually-hidden"> of {agent.name}</span>
        </summary>
        <dl className="kv">
          {PROFILE_SECTIONS.map((section) => (
            <div key={section.key}>
              <dt>{section.title}</dt>
              <dd>
                <Markdown text={agent.profile[section.key]} />
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <Link className="btn btn-sm agent-chat" href={`/chat/${encodeURIComponent(agent.id)}`}>
        Chat with {agent.name}
      </Link>
    </article>
  );
}
