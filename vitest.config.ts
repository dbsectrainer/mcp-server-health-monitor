import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Actual coverage as of initial setup: statements 33.28%, branches 76.11%, functions 66.66%, lines 33.28%
      // Thresholds set to actual coverage rounded down to nearest 5%
      thresholds: {
        statements: 30,
        branches: 75,
        functions: 65,
        lines: 30,
      },
    },
  },
});
