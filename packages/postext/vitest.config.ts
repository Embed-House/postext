import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `pnpm test:quick` (POSTEXT_QUICK_TESTS=1) leaves out the sweeps cut in
// parts, the whole books and the end-to-end runs: a check while working.
// CI runs every file (#1118).
const QUICK = process.env.POSTEXT_QUICK_TESTS ? ["**/*.part*.test.ts", "**/*.e2e.test.ts", "**/presets/**"] : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", ...QUICK],
    // Whole-book layouts take seconds on a workstation and ten to twenty times
    // as long on a small CI runner (a shard of the suite each since #1118).
    testTimeout: process.env.CI ? 120_000 : 30_000,
  },
});
