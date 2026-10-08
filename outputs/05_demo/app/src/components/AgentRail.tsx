'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AGENT_GROUPS, type PublicAgent } from '@/shared/contracts';
import { Avatar } from './Avatar';
import { GROUP_INFO, shortCapability } from './labels';
import { useSelection } from './SelectionProvider';

function currentAgentId(pathname: string): string | null {
  if (!pathname.startsWith('/chat/')) return null;
  const segment = pathname.slice('/chat/'.length).split('/')[0];
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function RailAgent({ agent, current, selected }: { agent: PublicAgent; current: boolean; selected: boolean | null }) {
  const stateClass = selected === false ? ' is-off' : '';
  return (
    <li>
      <Link
        href={`/chat/${encodeURIComponent(agent.id)}`}
        className={`rail-agent${stateClass}`}
        aria-current={current ? 'page' : undefined}
      >
        <Avatar src={agent.avatar} letter={agent.letter} size={28} />
        <span className="rail-text">
          <span className="rail-name">{agent.name}</span>
          <span className="rail-cap">{shortCapability(agent)}</span>
        </span>
        {selected !== null && (
          <>
            <span
              className={selected ? 'sel-mark sel-on' : 'sel-mark sel-off'}
              title={selected ? 'Selected for this DD' : 'Not selected for this DD'}
              aria-hidden="true"
            />
            <span className="visually-hidden">{selected ? ', selected for this DD' : ', not selected for this DD'}</span>
          </>
        )}
      </Link>
    </li>
  );
}

/** The left rail: the team pages, then every agent's 1:1 room by mockup v2 group. */
export function AgentRail({ agents }: { agents: PublicAgent[] }) {
  const pathname = usePathname() ?? '';
  const selection = useSelection();
  const activeId = currentAgentId(pathname);
  const isSelected = (agent: PublicAgent): boolean | null => {
    if (agent.locked) return true;
    return selection.selected ? selection.selected.has(agent.id) : null;
  };

  return (
    <nav className="rail" aria-label="Rooms">
      <ul className="rail-top">
        <li>
          <Link href="/" className="rail-link" aria-current={pathname === '/' ? 'page' : undefined}>
            Team overview
          </Link>
        </li>
        <li>
          <Link href="/team" className="rail-link rail-team" aria-current={pathname === '/team' ? 'page' : undefined}>
            Team chat
          </Link>
        </li>
      </ul>
      {AGENT_GROUPS.map((group) => {
        const members = agents.filter((agent) => agent.group === group);
        if (members.length === 0) return null;
        const info = GROUP_INFO[group];
        const list = (
          <ul className="rail-list">
            {members.map((agent) => (
              <RailAgent key={agent.id} agent={agent} current={agent.id === activeId} selected={isSelected(agent)} />
            ))}
          </ul>
        );
        if (info.collapsed) {
          const holdsCurrent = members.some((agent) => agent.id === activeId);
          return (
            <details key={group} className="rail-group" open={holdsCurrent || undefined}>
              <summary className="rail-heading">
                {info.label} <span className="rail-count">({members.length})</span>
              </summary>
              {list}
            </details>
          );
        }
        return (
          <section key={group} className="rail-group" aria-labelledby={`rail-${group}`}>
            <h2 id={`rail-${group}`} className="rail-heading">
              {info.label}
            </h2>
            {list}
          </section>
        );
      })}
    </nav>
  );
}
