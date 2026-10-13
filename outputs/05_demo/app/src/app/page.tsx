import { loadPublicAgents } from '@/components/load-agents';
import { SetupMessage } from '@/components/SetupMessage';
import { TeamOverview } from '@/components/TeamOverview';

// The roster is read from the spec files on every request, never frozen at build time.
export const dynamic = 'force-dynamic';

/** "/": every agent's profile card by group, the team chat entry and the app's status. */
export default function TeamPage() {
  const roster = loadPublicAgents();
  if (!roster.ok) return <SetupMessage title={roster.title} detail={roster.detail} issues={roster.issues} />;
  return <TeamOverview agents={roster.agents} />;
}
