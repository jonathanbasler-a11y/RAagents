import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Build output: .next plus every parallel builder's .next-<label>.
    '.next*/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    // Generated avatars and the candidate sheets they are picked from.
    'public/avatars/**',
    '.avatar-candidates/**',
    // Local data and eval runs (git-ignored).
    '.data/**',
    '.eval-runs/**',
  ]),
]);

export default eslintConfig;
