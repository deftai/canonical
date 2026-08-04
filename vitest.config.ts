import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Many tests spawn real git in temp repos; under full-suite parallelism they
    // routinely exceed the 5s default. Individually they run in <1s.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test-support/**", "src/cli/bin.ts"],
      // Coverage is REPORTED, not enforced, for this round (user decision).
      // The pack's engineering.md mandates >=85% when thresholds are configured;
      // raising to enforced 85 is a tracked follow-up after the experiment.
    },
  },
});
