// Runs once when the Next.js server starts, and finishes before the server answers its first request. It warns about how
// the server is exposed (the Host and Origin checks themselves live in proxy.ts), and on a hosted copy it prepares the
// accounts (migration and the admin from the server settings) and starts the backup heartbeat. A local copy opens nothing.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { exposureWarning } = await import('@/server/request-gate');
  const { readAccessSetting } = await import('@/server/access-gate');
  const warning = exposureWarning(process.env);
  if (warning !== null) console.warn(`[security] ${warning}`);
  const access = readAccessSetting(process.env);
  // The exposure warning names a misconfigured gate only beyond loopback; say it on any bind.
  if (warning === null && access.state === 'misconfigured') console.warn(`[security] Nobody can sign in: ${access.reason}`);
  if (access.state === 'on' || (process.env.LITESTREAM_REPLICA_URL ?? '').trim() !== '') {
    const { prepareHostedServer } = await import('@/server/accounts/runtime');
    await prepareHostedServer(process.env);
  }
}
