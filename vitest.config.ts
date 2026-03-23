import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Actual coverage: statements ~33%, branches ~37%, functions ~49%, lines ~33%
      // Thresholds set below actual coverage rounded down to nearest 5%
      thresholds: {
        statements: 30,
        branches: 35,
        functions: 45,
        lines: 30,
      },
    },
  },
});
