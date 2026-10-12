import { apiDeps } from '@/app/api/_lib/deps';
import { getRoomMessages } from '@/app/api/_lib/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RoomContext {
  params: Promise<{ room: string }>;
}

/** The room's active thread: messages, turns, and the turn running now. */
export async function GET(_request: Request, context: RoomContext): Promise<Response> {
  const { room } = await context.params;
  return getRoomMessages(room, apiDeps());
}
