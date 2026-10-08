import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromHere = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // `server-only` throws unless the react-server condition is active. Tests import
      // server modules directly, so it resolves to an empty module here.
      { find: /^server-only$/, replacement: fromHere('./tests/stubs/server-only.ts') },
      { find: /^@\//, replacement: `${fromHere('./src')}/` },
    ],
  },
  test: {
    // Node by default. A component test opts into the DOM with this first line:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mts}'],
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
