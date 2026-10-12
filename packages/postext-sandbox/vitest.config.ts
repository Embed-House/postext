import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Whole-book layouts take seconds on a workstation and ten to twenty times
    // as long on CI, which runs every package's suite at once on a small runner.
    testTimeout: process.env.CI ? 120_000 : 30_000,
    // A hook that imports a module afresh pays its first transform, which
    // took more than the default ten seconds on a loaded runner (#757).
    hookTimeout: process.env.CI ? 120_000 : 30_000,
  },
});
