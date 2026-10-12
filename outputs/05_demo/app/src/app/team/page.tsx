import type { Metadata } from 'next';
import { ChatRoom } from '@/components/ChatRoom';
import { loadPublicAgents } from '@/components/load-agents';
import { SetupMessage } from '@/components/SetupMessage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Team chat' };

/** "/team": the team chat. */
export default function TeamChatPage() {
  const roster = loadPublicAgents();
  if (!roster.ok) return <SetupMessage title={roster.title} detail={roster.detail} issues={roster.issues} />;
  return <ChatRoom key="team" roomId="team" agents={roster.agents} />;
}
