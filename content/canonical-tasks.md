# Canonical Tasks

Deterministic verbs this pack expects — the agent-facing contract: which verb serves which intent, exact args, and exit codes. The `canon` CLI implements every verb (`canon init` wires them as `task` targets); any alternative implementation must honor this same contract. Every verb is a pure function of disk + git + optional network — no LLM inside.

Agents: if a verb is missing, fail closed, follow the pack's file rules by hand where they permit it, and report the verb is not installed — never fake a gate.

Invocation: `task -x <verb> -- [args]` · Exit: `0` ok · `1` rejected/not ready · `2` misconfig/error · `--json` optional on every verb.
The `-x` flag makes go-task propagate the verb's exact exit code; without it every failure surfaces as go-task's generic 201. Direct `canon <verb>` invocations always carry the exact code.

## Solo Path

### `setup`
**Does:** One-time per clone. Set `core.hooksPath`; deposit pre-commit (runs `verify:branch`, `verify:encoding -- --staged`, `verify:forward-coverage -- --staged`, `state:validate` when `xbrief/` exists) and pre-push (refuses force-push/`+refspec` to default branch and repo-delete operations; env bypass `ALLOW_DESTRUCTIVE_GIT=1` prints an audit line). Probe toolchain presence; print found/missing.
**Exit:** `0` wired · `2` cannot write hooks.

### `orient`
**Does:** Mutation-session readiness snapshot: git status, `xbrief/` readable, core tools on PATH.
**Exit:** `0` ready · `1` missing `xbrief/` or dirty tree without `--allow-dirty` · `2` tools broken.
**Not:** package upgrades, network probes, multi-minute doctoring.

### `check`
**Does:** Project quality gate, in order: format check → lint → build → tests with coverage (fail under 85% lines/functions/branches/statements when coverage tooling exists) → `state:validate` → `verify:encoding`. Command list from `xbrief/PROJECT.json` `quality.commands[]`, else detect from `package.json`/`go.mod`/`pyproject.toml`.
**Exit:** `0` all pass · `1` failure (print failing stage) · `2` no commands configured or detected.

### `state:validate`
**Does:** Validate all `xbrief/**/*.json`: schema shape, status enum, filename pattern in lifecycle folders, folder↔status consistency, references carry `uri`+`type`+`trust`, ingested scopes carry origin reference + `Origin` narrative, no duplicate origin URIs, swarm block shape when present (non-empty `file_scope`/`verify_commands`, 2–5 acceptance items for `readiness: ready`).
**Exit:** `0` · `1` violations (print per-file findings) · `2` I/O error.

### `verify:branch`
**Does:** Exit 1 if HEAD is the default branch, unless `policy.allowDirectCommitsToDefault` is true or `ALLOW_DEFAULT_BRANCH_COMMIT=1`; print which override applied.

### `verify:encoding`
**Does:** Scan tracked text files (`-- --staged` limits to staged) for BOM, U+FFFD, mojibake byte sequences; scan machine-parsed sections (CHANGELOG entries, roadmap rows) for non-ASCII punctuation.
**Exit:** `0` · `1` with file:line list.

### `verify:forward-coverage`
**Does:** For each staged new source file (configurable roots: `src/`, `lib/`, `cmd/`, `scripts/`), require a staged new/modified test file per the project's test-naming convention.
**Exit:** `0` · `1` listing uncovered files.

### `work:next`
**Does:** Print the next work item, pure logic: (1) first incomplete entry of an ordered sequence in `xbrief/plan.json`, else (2) `xbrief/pending/*.json` ranked dependencies-satisfied-first then oldest `plan.created`, else (3) empty.
**Exit:** `0` printed · `1` empty · `2` corrupt JSON.
**Not:** live GitHub; no network.

### `triage`
**Does:** Record a decision on a candidate. `accept|reject|defer|duplicate -- <scope-or-origin> [--note=…]`. accept → `pending/` (WIP-cap check; `--force` logs a cap-override row); reject → `cancelled/`; defer → stays `proposed/`, note stamped; duplicate → cancel + reference the winning URI. Appends to `xbrief/audit.jsonl`.
**Exit:** `0` · `1` WIP cap hit on accept · `2` bad args/path.

### `scope:new`
**Does:** Create `xbrief/proposed/<today>-<normalized-slug>.json` (status `proposed`) from the schema skeleton. Slug: lowercase `[a-z0-9-]`, ≤80 chars.
**Exit:** `0` (prints path) · `1` slug collision (prints existing path) · `2` error.

### `scope:start`
**Does:** Make a scope implementable in one transaction: promote from `proposed/` if needed → `active/` + status `running`; fail if git dirty without `--allow-dirty`; fail if on default branch and policy forbids. `-- <path> [--check]` — `--check` verifies the gate (in `active/`, status `running`, clean tree) without transitioning.
**Exit:** `0` running · `1` gate fail (say which) · `2` error.

### `scope:complete`
**Does:** Terminal success. `-- <path> [--disposition=…] [--pr=url] [--sha=…]`. For code-bearing scopes: disposition required; if `delivered` and git/gh available, verify the merge commit is an ancestor of `policy.deliveryBranch`. Writes status `completed`, folder `completed/`, delivery block; if an origin issue exists and is open, close it with a PR-linking comment (warn if no PR evidence).
**Exit:** `0` · `1` missing delivery evidence · `2` error.

### `scope:stop`
**Does:** Non-happy terminal or pause. `-- <path> --cancel|--fail|--block|--unblock|--demote [--note=…]`. cancel → `cancelled/`; fail → `completed/` + `failed`; block/unblock toggle within `active/`; demote → `pending/`. Note recorded in narratives; every transition appends to `xbrief/audit.jsonl`.
**Exit:** `0` · `1` illegal transition · `2` error.

### `render`
**Does:** `roadmap|spec [--check]`. `roadmap`: generate `ROADMAP.md` from lifecycle folders (one section per folder; one row per scope: title, status, origin link, dependencies). `spec`: generate `SPEC.md` from `xbrief/spec.json`. Output opens with a 4-line `AUTO-GENERATED` banner (generator, purpose, source of truth, regenerate command). `--check` exits 1 if the committed file differs from regenerated output.

### `policy`
**Does:** `show [--field=…]` prints `policy.*` fields with values and defaults. `set --field= --value= --confirm` writes one typed field; refuses unknown fields, type mismatches, and absence of `--confirm`; appends `{ts, field, old, new, actor}` to `xbrief/audit.jsonl`.
**Exit:** `0` · `1` unknown field/refused · `2` error.

## Ship Path

### `pr:watch`
**Does:** Poll one PR until terminal state for the **current head SHA**. `-- <pr-number> [--one-shot] [--timeout=…]`.
**Exit:** `0` CLEAN (required checks pass on this SHA, review present for this SHA or reviewer surface disabled, zero open P0/P1) · `1` NEW_P0_P1 · `2` timeout/misconfig/API error.
**Not:** confidence-only signals; GraphQL steady-state polling when REST works.

### `pr:finish`
**Does:** Fail-closed merge. `-- <pr-number>`. Verifies CLEAN (as `pr:watch`), branch up to date, closing keyword present, branch policy; if `policy.requireHumanMerge` → exit 1 with a handoff message, do not merge. Else squash-merge + delete branch, then verify the linked issue closed (close manually with a PR-linking comment if not).
**Exit:** `0` merged + issue closed · `1` not mergeable / human-merge handoff · `2` error.

## Integration

### `issue:sync`
**Does:** Deterministic origin ↔ scope. `ingest -- <N | --all [--label L]>`: fetch via REST, write `proposed/` scope with origin reference (`trust: external`) + `Origin` narrative; skip (not error) when the origin URI already exists; `--dry-run` prints planned writes. `emit -- <scope-path>`: open/update the issue from scope title/narratives. `reconcile`: read-only drift report — externally-closed issues with non-terminal scopes, open issues with no scope, origin issues whose title/state changed.
**Exit:** `0` · `1` skip/dup (ingest, emit) or drift found (reconcile) · `2` API error.

## Multi-Agent (optional)

### `swarm:run`
**Does:** Cohort prep or finalize — never spawns. `--stories <paths…>`: readiness check (all `kind: story`, non-empty `file_scope`/`verify_commands`, acceptance items, pairwise-disjoint file scopes) and emit `launch-manifest.json` + worktree map `{story_id, worktree_path, base_branch}[]`. `--finalize --manifest <path>`: post-merge `scope:complete` for the cohort.
**Exit:** `0` · `1` not ready (print which story/why) · `2` error.

### `review-monitor`
**Does:** Sticky PR review-ownership lease. `register --pr=N --owner=…` | `release --pr=N` | `check --pr=N`. Writes `.canonical/review-monitor.json`.
**Exit:** `check` → `0` active lease · `1` none · `2` error.

## Out of Scope (do not build as agent-facing verbs)

| Skip | Why |
|---|---|
| Per-linter micro-gates beyond the three `verify:*` above | fold into `check` |
| Session ritual stacks, self-upgraders, network doctors | not lifecycle gates |
| LLM triage auto-classification | not deterministic |
| Deploy provider playbooks | not pack core |
| Body-encoding helpers as top-level verbs | library inside `issue:sync` / PR tooling |
| Undo verbs | `xbrief/` is committed; git history is the undo |

## Agent Call Map

| Intent | Task |
|---|---|
| First mutation of a session | `orient` |
| What's next | `work:next` |
| Accept/reject a candidate | `triage …` |
| New local scope | `scope:new` |
| Begin implement | `scope:start` |
| Quality gate | `check` |
| Wait on review | `pr:watch` |
| Merge / handoff | `pr:finish` |
| Finish a work unit | `scope:complete` |
| Abort / pause / demote | `scope:stop` |
| GitHub ↔ scopes | `issue:sync …` |
| Regenerate views | `render …` |
| Read/change policy | `policy …` |
| Cohort prep / finalize | `swarm:run …` |
| Validate state tree | `state:validate` |
