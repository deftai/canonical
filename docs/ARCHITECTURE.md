# Architecture

Maintainer-facing map of this repository. Repo-only: `docs/` is not in the npm
`files` list and never ships in the distribution.

## What the product is

`@deftai/canonical` is two artifacts that share one contract:

1. **The pack** — markdown rule files in [`content/`](../content/) that an
   AI agent loads and obeys. [`content/canonical.md`](../content/canonical.md) is
   the always-loaded root; the others are demand-loaded per its load table
   (including `feedback.md` for opt-in collection).
2. **The `canon` CLI** — the pack verbs (the contract below, including
   collection/feedback) plus the two installer commands `init` and `update`.
   The dispatch table (`CLI_MODULE_VERBS` in `src/cli/dispatch.ts`) is also
   what `canon --help` prints. If those counts drift, the table, this file, and
   `content/canonical-tasks.md` disagree — fix whichever is wrong.

The contract between them is [`content/canonical-tasks.md`](../content/canonical-tasks.md):
intent → verb, exact args, exit codes. The pack is written to degrade — if a verb
is missing, agents follow the file rules by hand and report the gap — so the CLI
implements the contract; it does not define it. Source files cite the contract in
their doc comments ("Exit codes per content/canonical-tasks.md").

**Universal exit codes** (see `src/types/gate.ts`): `0` ok · `1` rejected/not
ready · `2` misconfig/error. Everything downstream (hooks, Taskfile, agents)
relies on this trichotomy.

## Repository layout

```text
content/          the pack: 7 rule files, deposited verbatim into consumers
src/              the canon CLI (TypeScript, ESM, strict)
  types/          shared contracts: scope schema, policy, exit-code gate
  cli/            bin.js entry + verb dispatch table
  fs/ git/ gh/    infrastructure: contained atomic writes, process wrappers
  <verb modules>  one directory per domain: orient, check, scope, triage,
                  work-next, render, policy, branch, encoding,
                  forward-coverage, hooks, init-deposit, issue-sync, pr,
                  review-monitor, swarm, xbrief, args, collection
  test-support/   test helpers (temp git repos); excluded from build + package
tasks/            go-task fragments + engine shims (see below)
.githooks/        pre-commit / pre-push gate scripts
Taskfile.yml      dual-role: this repo's Taskfile AND the file deposited
                  into consumers (they include it with flatten: true)
xbrief/           this repo dogfooding its own work-state model
docs/             maintainer docs (this file, DEPLOY.md, manual-test-plan.md)
```

Tests are colocated (`*.test.ts` next to sources) and excluded from the build.
Many spawn real `git` in temp directories — that is deliberate (the product is
git-gate behavior), and why the vitest timeout is 30s.

## The go-task surface

Consumers invoke verbs as `task <verb>`; every verb also works as `canon <verb>`
without go-task. The wiring in `tasks/`:

- `engine.yml` (internal) — resolves how to reach `canon` and runs it.
  `engine-invoke.cjs` / `engine-pm-run.cjs` are spawn shims (shell-safe
  arg passing, win32 cmd quoting, allowlisted commands).
  `ts-build-fresh.cjs` lets a source checkout skip rebuilds when `dist/` is warm.
- `solo.yml`, `ship.yml`, `swarm.yml` — the verb groups, included with
  `flatten: true` so verbs stay bare (`task check`, `task scope:new`).
- `task -x <verb>` propagates the verb's exact exit code; plain `task` wraps
  failures as go-task's generic 201.

## The deposit model (`canon init` / `canon update`)

`src/init-deposit/` implements the installer. `canon init` in a consumer repo:

1. Copies the payload — everything in `content/`, plus `Taskfile.yml`, `tasks/`,
   `.githooks/` — to `.canonical/core/`, and stamps `.canonical/core/VERSION`.
2. Writes a managed section into `AGENTS.md` (marker-delimited; user content
   outside the markers is preserved) pointing agents at
   `.canonical/core/canonical.md`.
3. Ensures the root `Taskfile.yml` includes the deposited one (`flatten: true`).
4. Scaffolds `xbrief/` — the five lifecycle folders plus a `PROJECT.xbrief.json`
   skeleton (see [`content/state.md`](../content/state.md) for the state model).
5. Deposits the git hooks to `.githooks/` and sets `core.hooksPath`.
6. Appends a `.gitignore` baseline (`.canonical/core/`, `.canonical/cache/`,
   `xbrief/*.lock`).

All writes go through `src/fs/` contained-write helpers (atomic, root-jailed).
`init` is idempotent — unchanged files report as skipped. `update` diffs against
the live deposit and refreshes it.

## Enforcement chain

Three layers repeat the same rules so no single layer is load-bearing:

1. **Pack rules** — what the agent is told (`content/*.md`).
2. **Verbs** — deterministic checks the agent (or a human) runs:
   `check` (format → lint → build → tests+coverage → `state:validate` →
   `verify:encoding`), `verify:branch`, `verify:forward-coverage`, etc.
3. **Git hooks** — pre-commit runs the `verify:*` gates and `state:validate`;
   pre-push refuses force-pushes to the default branch. Fail-closed, with named,
   audited env bypasses (`ALLOW_DEFAULT_BRANCH_COMMIT=1`, `ALLOW_DESTRUCTIVE_GIT=1`).

## Toolchain

- TypeScript strict, ESM (`type: module`), `NodeNext` resolution; `tsc` builds
  `src/` → `dist/` (single `tsconfig.json`).
- Vitest for tests; v8 coverage is reported, not yet threshold-enforced
  (raising to the pack's own 85% floor is a tracked follow-up).
- Biome for lint + format (`src/**/*.ts`, root `*.ts`, `tasks/**/*.cjs`).
- pnpm, Node ≥ 20 (`.nvmrc` pins 24 for CI).

## What ships vs what stays

The npm package (`files` in `package.json`) contains `dist/**/*.js`,
`dist/**/*.d.ts`, `content/`, `tasks/`, `.githooks/`, `Taskfile.yml`, and
`vendor/@deft/` (vendored collection SDK until published). Everything else —
`docs/`, `src/`, tests, `xbrief/`, workflows — is repo-only.

See [DEPLOY.md](./DEPLOY.md) for CI/CD and the release process, and
[manual-test-plan.md](./manual-test-plan.md) for the end-to-end acceptance
walkthrough (it builds a throwaway Wordle app as its test fixture).
