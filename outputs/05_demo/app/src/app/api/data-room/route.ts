import { apiDeps } from '@/app/api/_lib/deps';
import { getDataRoom, postDataRoom } from '@/app/api/_lib/data-room';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The data room of the workspace: its as-of date and its documents without their text. */
export function GET(): Response {
  return getDataRoom(apiDeps());
}

/** Starts the data room, empty with an as-of date or with the fictional practice case. */
export async function POST(request: Request): Promise<Response> {
  return postDataRoom(request, apiDeps());
}
