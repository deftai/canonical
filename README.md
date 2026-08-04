# directive-canonical-merged

A standalone, installable implementation of the **canonical pack** — the merged
distillation of the Directive framework into 6 rule files and 20 deterministic
task verbs. The pack itself lives in [content/](content/) (root:
[content/canonical.md](content/canonical.md); verb contracts:
[content/canonical-tasks.md](content/canonical-tasks.md)).

## Layout

- `packages/types` — shared types (`@canonpack/types`)
- `packages/core` — pure verb logic (`@canonpack/core`)
- `packages/cli` — the `canon` binary (`@canonpack/cli`)
- `packages/content` — payload package, assembled at pack time (`@canonpack/content`)
- `tasks/` — go-task fragments + engine dispatch shims
- `content/` — the canonical pack (deposited into consumers)
- `.githooks/` — pre-commit / pre-push gates

## Requirements

- Node ≥ 20, pnpm (or corepack), [go-task](https://taskfile.dev) ≥ 3.33 (flattened includes)

## Develop

```sh
pnpm install
pnpm run build     # tsc -b
pnpm run lint      # biome
pnpm run test      # vitest + coverage report
```

## Install into a test project

```sh
# from this repo: pack + install globally
# pnpm pack rewrites workspace:* deps to real versions (npm pack does NOT).
# content has no deps and its postpack cleanup races pnpm's verifier -- use npm pack for it.
for p in types core cli; do (cd packages/$p && pnpm pack --pack-destination /tmp/canonpack); done
(cd packages/content && npm pack --pack-destination /tmp/canonpack)
npm i -g /tmp/canonpack/canonpack-types-*.tgz /tmp/canonpack/canonpack-core-*.tgz /tmp/canonpack/canonpack-content-*.tgz /tmp/canonpack/canonpack-cli-*.tgz

# in the target project
cd ~/some-project
canon init
```

`canon init` deposits `.canonical/core/` (the pack + Taskfile + hooks), writes an
`AGENTS.md` managed section pointing at `.canonical/core/canonical.md`, wires the
root `Taskfile.yml` include (flattened, so verbs are bare: `task check`,
`task scope:new -- "title"`), scaffolds `briefs/`, and installs git hooks.
`canon update` refreshes the deposit.

Exit codes everywhere: `0` ok · `1` rejected/not ready · `2` misconfig/error.
When invoking through go-task, use `task -x <verb>` to propagate the verb's exact exit code (plain `task` wraps failures as 201).
