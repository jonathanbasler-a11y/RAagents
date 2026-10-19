import { loadPublicAgents } from '@/components/load-agents';
import { SetupMessage } from '@/components/SetupMessage';
import { WorkspaceHome } from '@/components/WorkspaceHome';

// The roster is read from the spec files on every request, never frozen at build time.
export const dynamic = 'force-dynamic';

/** "/": the DD workspace. The setup, the team chat entry, the app's status and every agent's card by group. */
export default function LandingPage() {
  const roster = loadPublicAgents();
  if (!roster.ok) return <SetupMessage title={roster.title} detail={roster.detail} issues={roster.issues} />;
  return <WorkspaceHome agents={roster.agents} />;
}
