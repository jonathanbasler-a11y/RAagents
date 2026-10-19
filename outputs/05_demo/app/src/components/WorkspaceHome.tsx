import Link from 'next/link';
import { AGENT_GROUPS, type AgentGroup, type PublicAgent } from '@/shared/contracts';
import type { ChatApi } from '@/client/chat-client';
import { DataRoomSummary } from './DataRoomSummary';
import { FindingsSummary } from './FindingsSummary';
import { DdSetupPanel } from './DdSetupPanel';
import { HomeLede } from './DocumentsNotes';
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
          <h3 id={headingId} className="panel-h">
            {info.label} <small>{members.length} agents</small>
          </h3>
          <span className="note">{info.note}</span>
        </summary>
        {cards}
      </details>
    );
  }
  return (
    <section className="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel-h">
        {info.label} <small>{members.length} agents</small>
      </h3>
      <p className="note group-note">{info.note}</p>
      {cards}
    </section>
  );
}

/**
 * The landing page ("/"): the DD setup, the team chat entry, the app's status, and the team overview,
 * every agent's profile by group. The setup decides who is on the team; the cards show it.
 */
export function WorkspaceHome({ agents, client }: { agents: PublicAgent[]; client?: Pick<ChatApi, 'getHealth'> }) {
  const roster = [...agents].sort((a, b) => a.order - b.order);
  const orchestrator = roster.find((agent) => agent.kind === 'orchestrator');
  return (
    <div className="team-page">
      <div className="screen-head">
        <h1>DD workspace</h1>
        <HomeLede />
      </div>

      <DdSetupPanel agents={roster} />
      <DataRoomSummary />
      <FindingsSummary />

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

      <section className="team-overview" aria-labelledby="team-overview-title">
        <h2 id="team-overview-title" className="section-h">
          Team overview
        </h2>
        <SelectionSummary agents={roster} />
        {AGENT_GROUPS.map((group) => {
          const members = roster.filter((agent) => agent.group === group);
          return members.length > 0 ? <GroupSection key={group} group={group} members={members} /> : null;
        })}
      </section>
    </div>
  );
}
