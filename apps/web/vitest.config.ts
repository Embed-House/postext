import { defineConfig } from "vitest/config";
import path from "node:path";

// `pnpm test:quick` (POSTEXT_QUICK_TESTS=1) leaves out the sweeps cut in
// parts, the whole books and the end-to-end runs: a check while working.
// CI runs every file (#1118).
const QUICK = process.env.POSTEXT_QUICK_TESTS ? ["**/*.part*.test.ts", "**/*.e2e.test.ts", "**/presets/**"] : [];

export default defineConfig({
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...QUICK],
    // The workspace packages' `dist` loads in plain Node (#1158): vitest
    // imports it as is instead of transforming its modules in each file.
    server: { deps: { external: [/\/packages\/postext[^/]*\/dist\//] } },
    // One test renders the Markdown of every docs and Cookbook page: about
    // a second on a workstation, close to 30 s on a small CI runner.
    testTimeout: process.env.CI ? 120_000 : 30_000,
  },
});
