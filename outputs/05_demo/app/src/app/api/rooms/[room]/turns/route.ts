import { apiDeps } from '@/app/api/_lib/deps';
import { postTurn } from '@/app/api/_lib/turns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Params are typed by hand: the generated RouteContext helper is not part of the type check.
interface RoomContext {
  params: Promise<{ room: string }>;
}

/** Starts a turn in a room and streams it as server-sent events (see src/app/api/_lib/turns.ts). */
export async function POST(request: Request, context: RoomContext): Promise<Response> {
  const { room } = await context.params;
  return postTurn(request, room, apiDeps());
}
