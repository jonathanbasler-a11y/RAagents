import { accountDeps } from '@/app/api/_lib/account-deps';
import { postPersonAction } from '@/app/api/_lib/admin-people';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ username: string }>;
}

/** The admin resets, disables or enables a person. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { username } = await context.params;
  return postPersonAction(request, accountDeps(), username);
}
