import { apiDeps } from '@/app/api/_lib/deps';
import { postNewThread } from '@/app/api/_lib/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RoomContext {
  params: Promise<{ room: string }>;
}

/** Archives the room's active thread and opens an empty one. */
export async function POST(request: Request, context: RoomContext): Promise<Response> {
  const { room } = await context.params;
  return postNewThread(request, room, apiDeps());
}
