import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

// Run with `npm test` (scripts/vitest.mjs), which fixes Windows drive-letter casing.
export default defineConfig({
  // Provides WXT's aliases (@/…), auto-imports and an in-memory fake `browser` API.
  plugins: [WxtVitest()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});
