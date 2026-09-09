# canonical

A compact, deterministic agent-workflow framework: rule files an AI agent reads,
CLI verbs that make the workflow checkable, and fail-closed git gates. The pack
lives in [content/](content/) (root: [content/canonical.md](content/canonical.md);
verb contracts: [content/canonical-tasks.md](content/canonical-tasks.md)).
Optional anonymous opt-in feedback/usage collection uses the vendored
`@deft/collection-sdk` (`/feedback`, `collection:*` verbs).

## Install

```sh
npm i -g @deftai/canonical            # GA (latest / stable, when promoted)
# npm i -g @deftai/canonical@staging  # daily / unreleased (staging collector)
# npm i -g @deftai/canonical@prod     # production-baked candidate (before GA)
```

Requirements: Node ≥ 20, git. For the `task <verb>` surface, install
[go-task](https://taskfile.dev) ≥ 3.44 separately (`brew install go-task` /
`scoop install task` / see taskfile.dev) — it is not an npm dependency. Every
verb also works directly as `canon <verb>` without go-task.

Collector endpoints are **baked at build time** (staging vs production). A
staging install always talks to `api.deft-staging.co`; a production bake always
talks to `api.deft.co`. There is no customer runtime switch.

## Use in a project

```sh
cd my-project        # a git repo (run `git init` first if new)
canon init
```

This deposits `.canonical/core/` (the rule pack + Taskfile + hooks), writes an
`AGENTS.md` managed section pointing your AI agent at the rules, wires the root
`Taskfile.yml` include (verbs are bare: `task check`, `task scope:new -- "title"`),
scaffolds `xbrief/` (the durable work state), and installs git hooks.

Then open the project with your AI agent and say:

> I want to make an app that does X, help me set this up.

The pack's kickoff flow interviews you, generates the project brief + one scope
per feature with acceptance criteria, and renders the roadmap. `canon update`
refreshes the deposit after upgrades; `canon init` is idempotent.

Exit codes everywhere: `0` ok · `1` rejected/not ready · `2` misconfig/error.
When invoking through go-task, use `task -x <verb>` to propagate the verb's
exact exit code (plain `task` wraps failures as 201).

## Layout

- `content/` — the canonical pack (deposited into consumer projects)
- `src/` — the `canon` CLI: `src/types` (contracts), domain modules, `src/cli` (verbs)
- `tasks/` — go-task fragments + engine dispatch shims
- `.githooks/` — pre-commit / pre-push gates
- `docs/` — maintainer docs (repo-only, not in the npm package):
  [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [DEPLOY.md](docs/DEPLOY.md) ·
  [manual-test-plan.md](docs/manual-test-plan.md) (end-to-end walkthrough on a
  throwaway Wordle app)

## Develop

```sh
pnpm install
pnpm run build              # tsc (bakes staging collector by default)
pnpm run build:staging      # explicit staging bake
pnpm run build:production   # bake api.deft.co into this artifact
pnpm run lint               # biome
pnpm run test               # vitest + coverage report
```

Local install for testing: `npm pack` then `npm i -g ./deftai-canonical-*.tgz`.
Confirm channel with `canon --version` (prints `canon <ver> (staging|production)`).

## Release

See [docs/DEPLOY.md](docs/DEPLOY.md) for the full channel flow. Short version:

```sh
# Staging (unreleased) → npm @staging, staging collector
pnpm run next-staging-version          # e.g. 0.3.1-staging.1
git tag v0.3.1-staging.1 && git push origin v0.3.1-staging.1

# Production candidate → npm @prod, production collector
# (after CHANGELOG + package.json bump on main)
git tag v0.3.1 && git push origin v0.3.1

# After smoke: promote that prod build to latest + stable (no rebuild)
pnpm run promote -- 0.3.1
```

## License

MIT
