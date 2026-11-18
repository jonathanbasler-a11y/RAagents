import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structure guard: the container image (outputs/Dockerfile) is built for a hosted copy, so it must never start open.
// It bakes the sign-in requirement into the runner stage and starts through the hosted start script, which also treats
// an empty requirement as set (scripts/hosted/start.test.ts).

const DOCKERFILE = readFileSync(fileURLToPath(new URL('../../../../Dockerfile', import.meta.url)), 'utf8');

/** The runner stage: from its FROM line to the end. */
const runner = DOCKERFILE.slice(DOCKERFILE.indexOf('AS runner'));

describe('the hosted image', () => {
  it('requires sign-in in the stage that runs', () => {
    expect(runner).toMatch(/^\s+RAAGENTS_REQUIRE_SIGN_IN=1\b/m);
  });

  it('trusts exactly one proxy in front, for the per-machine sign-in limits', () => {
    expect(runner).toMatch(/^\s+RAAGENTS_TRUSTED_PROXY_HOPS=1\b/m);
  });

  it('starts through the hosted start script, as a non-root user', () => {
    expect(runner).toMatch(/^USER node$/m);
    expect(runner).toMatch(/^CMD \["\/bin\/sh", "scripts\/hosted\/start\.sh"\]$/m);
  });
});
