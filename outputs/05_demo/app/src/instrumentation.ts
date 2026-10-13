// Runs once when the Next.js server starts. It only warns: the Host and Origin checks
// themselves live in proxy.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { exposureWarning } = await import('@/server/request-gate');
  const warning = exposureWarning(process.env);
  if (warning !== null) console.warn(`[security] ${warning}`);
}
