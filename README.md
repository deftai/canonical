# canonical

A compact, deterministic agent-workflow framework: 7 rule files an AI agent reads,
20 CLI verbs that make the workflow checkable, and fail-closed git gates. The pack
lives in [content/](content/) (root: [content/canonical.md](content/canonical.md);
verb contracts: [content/canonical-tasks.md](content/canonical-tasks.md)).

## Install

```sh
npm i -g @deftai/canonical
```

Requirements: Node ≥ 20, git. For the `task <verb>` surface, install
[go-task](https://taskfile.dev) ≥ 3.33 separately (`brew install go-task` /
`scoop install task` / see taskfile.dev) — it is not an npm dependency. Every
verb also works directly as `canon <verb>` without go-task.

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
pnpm run build     # tsc
pnpm run lint      # biome
pnpm run test      # vitest + coverage report
```

Local install for testing: `npm pack` then `npm i -g ./deftai-canonical-*.tgz`.

## Release

Update `CHANGELOG.md`, merge, then tag: `git tag v<X.Y.Z> && git push origin v<X.Y.Z>` —
the publish workflow builds and publishes to npm with provenance.

## License

MIT
