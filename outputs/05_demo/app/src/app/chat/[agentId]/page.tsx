import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChatRoom } from '@/components/ChatRoom';
import { loadPublicAgents } from '@/components/load-agents';
import { SetupMessage } from '@/components/SetupMessage';

export const dynamic = 'force-dynamic';

// Params are typed by hand: the generated PageProps helper is not part of the type check.
interface AgentRoomProps {
  params: Promise<{ agentId: string }>;
}

export async function generateMetadata({ params }: AgentRoomProps): Promise<Metadata> {
  const { agentId } = await params;
  const roster = loadPublicAgents();
  const agent = roster.ok ? roster.agents.find((member) => member.id === agentId) : undefined;
  return { title: agent ? `${agent.name} · ${agent.capability}` : 'Agent room' };
}

/** "/chat/<id>": one agent's 1:1 room. Unknown and inactive ids (and "team") are a 404. */
export default async function AgentRoomPage({ params }: AgentRoomProps) {
  const { agentId } = await params;
  const roster = loadPublicAgents();
  if (!roster.ok) return <SetupMessage title={roster.title} detail={roster.detail} issues={roster.issues} />;
  const agent = roster.agents.find((member) => member.id === agentId);
  if (!agent) notFound();
  return <ChatRoom key={agent.id} roomId={agent.id} agents={roster.agents} />;
}
