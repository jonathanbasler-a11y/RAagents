import Link from 'next/link';
import { AGENT_GROUPS, type AgentGroup, type PublicAgent } from '@/shared/contracts';
import type { ChatApi } from '@/client/chat-client';
import { GROUP_INFO } from './labels';
import { ProfileCard } from './ProfileCard';
import { SelectionSummary } from './SelectionSummary';
import { StatusPanel } from './StatusPanel';

function GroupSection({ group, members }: { group: AgentGroup; members: PublicAgent[] }) {
  const info = GROUP_INFO[group];
  const headingId = `group-${group}`;
  const cards = (
    <ul className="agents" aria-labelledby={headingId}>
      {members.map((agent) => (
        <li key={agent.id}>
          <ProfileCard agent={agent} />
        </li>
      ))}
    </ul>
  );
  if (info.collapsed) {
    return (
      <details className="group">
        <summary>
          <h2 id={headingId} className="panel-h">
            {info.label} <small>{members.length} agents</small>
          </h2>
          <span className="note">{info.note}</span>
        </summary>
        {cards}
      </details>
    );
  }
  return (
    <section className="group" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-h">
        {info.label} <small>{members.length} agents</small>
      </h2>
      <p className="note group-note">{info.note}</p>
      {cards}
    </section>
  );
}

/** The team page ("/"): the team chat entry, the app's status, and every agent's profile by group. */
export function TeamOverview({ agents, client }: { agents: PublicAgent[]; client?: Pick<ChatApi, 'getHealth'> }) {
  const roster = [...agents].sort((a, b) => a.order - b.order);
  const orchestrator = roster.find((agent) => agent.kind === 'orchestrator');
  return (
    <div className="team-page">
      <div className="screen-head">
        <h1>Your hybrid team</h1>
        <p className="lede">
          People own every decision and every agent. In this phase the agents have no documents and no tools: they
          explain how they would assess something and mark what needs checking. What they write is model output, not a
          source.
        </p>
      </div>

      <section className="sheet team-entry" aria-labelledby="team-entry-title">
        <div>
          <h2 id="team-entry-title">Team chat</h2>
          <p>
            Ask the whole team at once. @Name brings in specific agents; otherwise routing picks up to 3 selected
            specialists by topic{orchestrator ? `, or ${orchestrator.name} answers and names who fits` : ''}.
          </p>
        </div>
        <Link className="btn btn-primary" href="/team">
          Open the team chat
        </Link>
      </section>

      <StatusPanel client={client} />
      <SelectionSummary agents={roster} />

      {AGENT_GROUPS.map((group) => {
        const members = roster.filter((agent) => agent.group === group);
        return members.length > 0 ? <GroupSection key={group} group={group} members={members} /> : null;
      })}
    </div>
  );
}
