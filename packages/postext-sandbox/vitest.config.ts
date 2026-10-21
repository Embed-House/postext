import { defineConfig } from 'vitest/config';

// `pnpm test:quick` (POSTEXT_QUICK_TESTS=1) leaves out the sweeps cut in
// parts, the whole books and the end-to-end runs: a check while working.
// CI runs every file (#1118).
const QUICK = process.env.POSTEXT_QUICK_TESTS ? ['**/*.part*.test.ts', '**/*.e2e.test.ts', '**/presets/**'] : [];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', ...QUICK],
    // The workspace packages' `dist` loads in plain Node (#1158): vitest
    // imports it as is instead of transforming its modules in each file.
    server: { deps: { external: [/\/packages\/postext[^/]*\/dist\//] } },
    // Whole-book layouts take seconds on a workstation and ten to twenty times
    // as long on a small CI runner (a shard of the suite each since #1118).
    testTimeout: process.env.CI ? 120_000 : 30_000,
    // A hook that imports a module afresh pays its first transform, which
    // took more than the default ten seconds on a loaded runner (#757).
    hookTimeout: process.env.CI ? 120_000 : 30_000,
  },
});
