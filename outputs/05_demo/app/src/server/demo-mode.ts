import 'server-only';
import type { DemoMode } from '@/shared/contracts';

/**
 * "practice" when the server runs with DEMO_MODE=practice: `npm run demo:practice` points every
 * LLM_* name at the stand-in model (scripts/fake-llm.mjs). Any other value, or none, is live.
 * Read on every call, so it always matches the environment this server process was started with.
 */
export function readDemoMode(env: Readonly<Record<string, string | undefined>> = process.env): DemoMode {
  return env.DEMO_MODE?.trim().toLowerCase() === 'practice' ? 'practice' : 'live';
}
