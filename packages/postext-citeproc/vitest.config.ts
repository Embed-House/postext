import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // The workspace packages' `dist` loads in plain Node (#1158): vitest
    // imports it as is instead of transforming its modules in each file.
    server: { deps: { external: [/\/packages\/postext[^/]*\/dist\//] } },
    // citeproc-js parses a whole CSL style per processor (Chicago's is
    // 240 KB): a few seconds each on a slow CI runner.
    testTimeout: process.env.CI ? 120_000 : 30_000,
  },
});
