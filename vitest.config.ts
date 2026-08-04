import { defineConfig } from "vitest/config";

// Core subpaths, each aliased to TS source so tests run without a prior tsc -b.
// ORDER MATTERS: the dist regex alias must come FIRST, specific subpaths next,
// and any bare-package alias LAST (rollup alias takes the first prefix match).
const CORE_SUBPATHS = [
  "args",
  "briefs",
  "branch",
  "check",
  "encoding",
  "forward-coverage",
  "fs",
  "gh",
  "git",
  "hooks",
  "init-deposit",
  "issue-sync",
  "orient",
  "policy",
  "pr",
  "render",
  "review-monitor",
  "scope",
  "swarm",
  "test-support",
  "triage",
  "work-next",
];

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@canonpack\/core\/dist\/(.*)\.js$/,
        replacement: `${import.meta.dirname}/packages/core/src/$1.ts`,
      },
      ...CORE_SUBPATHS.map((sub) => ({
        find: `@canonpack/core/${sub}`,
        replacement: `${import.meta.dirname}/packages/core/src/${sub}/index.ts`,
      })),
      {
        find: "@canonpack/types",
        replacement: `${import.meta.dirname}/packages/types/src/index.ts`,
      },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    // Many tests spawn real git in temp repos; under full-suite parallelism they
    // routinely exceed the 5s default. Individually they run in <1s.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/**/*.test.ts",
        "packages/core/src/test-support/**",
        "packages/cli/src/bin.ts",
      ],
      // Coverage is REPORTED, not enforced, for this round (user decision).
      // The pack's engineering.md mandates >=85% when thresholds are configured;
      // raising to enforced 85 is a tracked follow-up after the experiment.
    },
  },
});
