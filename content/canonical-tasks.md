# Canonical Tasks

Deterministic verbs this pack expects — the agent-facing contract: which verb serves which intent, exact args, and exit codes. The `canon` CLI implements every verb (`canon init` wires them as `task` targets); any alternative implementation must honor this same contract. Every verb is a pure function of disk + git + optional network — no LLM inside.

Agents: if a verb is missing, fail closed, follow the pack's file rules by hand where they permit it, and report the verb is not installed — never fake a gate.

**Agent-internal:** these verb names, flags, and shell recipes are for the agent only. ⊗ Read them aloud to the human. For collection and feedback, user-facing language is plain English — “ask me to file a bug / feature / feedback”, “ask me to opt out of Canonical collection”, “ask me to turn on Canonical metrics” — per [feedback.md](./feedback.md) **User dialogue**.

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
**Does:** Project quality gate, in order: format check → lint → build → tests with coverage (fail under 85% lines/functions/branches/statements when coverage tooling exists) → `state:validate` → `verify:encoding`. Command list from `xbrief/PROJECT.xbrief.json` `plan["x-canonical/quality"].commands[]`, else detect from `package.json`/`go.mod`/`pyproject.toml`.
**Exit:** `0` all pass · `1` failure (print failing stage) · `2` no commands configured or detected.

### `state:validate`
**Does:** Validate all `xbrief/**` state files in three layers: (1) parse; (2) core xBRIEF v0.8 conformance — `xBRIEFInfo.version: "0.8"` envelope, `plan.title/status/items` required, core status enums, item ids (dot-notation, unique), string narratives, `references[].type` matches `x-<token>/…` with `x-xbrief/*` restricted to the spec registry, timestamps carry an explicit Z/offset; (3) canonical profile — filename pattern in lifecycle folders, folder↔status consistency, `x-canonical/kind`, references carry `x-canonical/trust`, ingested scopes carry origin reference + `Origin` narrative, no duplicate origin URIs, swarm block shape when present (non-empty `filesScope`/`verifyCommands`, 2–5 acceptance items for `readiness: ready`). Legacy pre-0.3 `.json` state files are flagged `legacy-file`.
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
**Does:** Print the next work item, pure logic: (1) first incomplete entry of `plan["x-canonical/sequence"]` in `xbrief/plan.xbrief.json`, else (2) `xbrief/pending/*.xbrief.json` ranked dependencies-satisfied-first then oldest `plan.created`, else (3) empty.
**Exit:** `0` printed · `1` empty · `2` corrupt JSON.
**Not:** live GitHub; no network.

### `triage`
**Does:** Record a decision on a candidate. `accept|reject|defer|duplicate -- <scope-or-origin> [--note=…]`. accept → `pending/` (WIP-cap check; `--force` logs a cap-override row); reject → `cancelled/`; defer → stays `proposed/`, note stamped; duplicate → cancel + reference the winning URI. Appends to `xbrief/audit.jsonl`.
**Exit:** `0` · `1` WIP cap hit on accept · `2` bad args/path.

### `scope:new`
**Does:** Create `xbrief/proposed/<today>-<normalized-slug>.xbrief.json` (status `proposed`) from the xBRIEF v0.8 skeleton. Slug: lowercase `[a-z0-9-]`, ≤80 chars.
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
**Does:** `roadmap|spec [--check]`. `roadmap`: generate `ROADMAP.md` from lifecycle folders (one section per folder; one row per scope: title, status, origin link, dependencies). `spec`: generate `SPEC.md` from `xbrief/spec.xbrief.json`. Output opens with a 4-line `AUTO-GENERATED` banner (generator, purpose, source of truth, regenerate command). `--check` exits 1 if the committed file differs from regenerated output.

### `policy`
**Does:** `show [--field=…]` prints policy fields (from `PROJECT.xbrief.json` `plan["x-canonical/policy"]`) with values and defaults. `set --field= --value= --confirm` writes one typed field; refuses unknown fields, type mismatches, and absence of `--confirm`; appends `{ts, field, old, new, actor}` to `xbrief/audit.jsonl`.
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
**Does:** Deterministic origin ↔ scope. `ingest -- <N | --all [--label L]>`: fetch via REST, write `proposed/` scope with origin reference (`type: x-xbrief/github-issue`, `x-canonical/trust: external`) + `Origin` narrative; skip (not error) when the origin URI already exists; `--dry-run` prints planned writes. `emit -- <scope-path>`: open/update the issue from scope title/narratives. `reconcile`: read-only drift report — externally-closed issues with non-terminal scopes, open issues with no scope, origin issues whose title/state changed.
**Exit:** `0` · `1` skip/dup (ingest, emit) or drift found (reconcile) · `2` API error.

## Multi-Agent (optional)

### `swarm:run`
**Does:** Cohort prep or finalize — never spawns. `--stories <paths…>`: readiness check (all `x-canonical/kind: story`, non-empty `filesScope`/`verifyCommands`, acceptance items, pairwise-disjoint file scopes) and emit `launch-manifest.json` + worktree map `{story_id, worktree_path, base_branch}[]`. `--finalize --manifest <path>`: post-merge `scope:complete` for the cohort.
**Exit:** `0` · `1` not ready (print which story/why) · `2` error.

### `review-monitor`
**Does:** Sticky PR review-ownership lease. `register --pr=N --owner=…` | `release --pr=N` | `check --pr=N`. Writes `.canonical/review-monitor.json`.
**Exit:** `check` → `0` active lease · `1` none · `2` error.

## Collection & Feedback

Anonymous collection via `@deft/collection-sdk`. Credentials: `.canonical/collection.json` (gitignored). Correlator: `~/.config/canonical/identity.json` `userKey` → SDK `correlator` (never `deployment.customer`). Default endpoint: staging (`CANONICAL_COLLECTION_URL` / `CANONICAL_COLLECTION_ENV` override). Metrics soft-fail — host verb exit codes unchanged.

Two tracks: **metrics** (usage; plain-English Disallow / Anonymous / Attributed → `collection:decline` / `collection:opt-in` / opt-in + `collection:identity`) and **submissions** (feedback/bug/feature; per-submit user confirm in dialogue — agent may still pass internal disclosure flags). Orient/status print `metricsMode=… metrics=… submissions=… identity=…` (`metricsMode` ∈ `undecided|disallowed|anonymous|attributed`; `identity` ∈ `anonymous|identified`). Consent version: `canonical-2026-09-b`. Contact identity is local + opt-in reconfirm only — ⊗ never in event payloads (PRIV-2). Opt-out rotates install credentials after server opt-out.

### `collection:status`
**Does:** Print machine-parseable `metricsMode=… metrics=… submissions=… identity=…` (metricsMode ∈ `undecided|disallowed|anonymous|attributed`; metrics ∈ `not_prompted|declined|active|revoked|expired`; submissions ∈ `not_granted|granted`; identity ∈ `anonymous|identified`). `--live` refreshes from the server when credentials exist.
**Exit:** `0` when metrics active or submissions granted · `1` otherwise · `2` error.

### `collection:identity`
**Does:** `--show` | `--clear` | `--update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]`. Stores identity in `.canonical/collection.json` (0600). `identified` requires email or mobile; otherwise `anonymous`. When credentials exist, `--update` / `--clear` reconfirm via SDK opt-in contact `{ name, email, sms }` (`name` ← `"firstName lastName".trim()`, `sms` ← mobile). `--show` prints fields; other modes avoid logging PII.
**Exit:** `0` · `1` server sync rejected · `2` bad args / validation.

### `collection:opt-in`
**Does:** Register (once) + activate **metrics** scopes. Default scopes = `usage` only. `-- --confirm [--scopes=usage] [--consent-version=canonical-2026-09-b] [--email=…] [--name=…]`. Requires `--confirm`. Does not grant submissions. Prefer `collection:identity --update` for attributed / reply-channel contact.
**Exit:** `0` · `1` refused/rejected · `2` error.

### `collection:decline`
**Does:** Record local **metrics** decline without registering. Does not revoke an existing submissions grant. Preserves local identity. No network.
**Exit:** `0` · `2` error.

### `collection:opt-out`
**Does:** `-- --confirm` revoke server consent (when credentials exist), clear local token / rotate install credentials; marks metrics revoked, submissions not granted, identity cleared. Past filings may remain associated until the user asks to delete personal data. `-- --identity` clears local identity + server contact only (metrics/submissions unchanged).
**Exit:** `0` · `1` refused/rejected · `2` error.

### `collection:metric`
**Does:** Soft usage submit `{ metric, value, period?, dimensions? }`. `--dimensions` is a JSON object of `string|number|boolean` values (≤2KiB). Skips when metrics not active. Always exit 0 on soft skip/failure.
**Exit:** `0` · `2` bad args only (including invalid/oversized `--dimensions`).

### `feedback`
**Does:** Submit `--kind=bug|feature|feedback` with kind-specific fields (`--summary`/`--message`, optional `--details`, `--context`, `--rating`, `--stack`, `--logs`, `--os`). File flags `--summary-file`, `--message-file`, `--details-file`, `--context-file`, `--stack-file`, `--logs-file` read the corresponding field (inline+file conflict → exit 2). `--dry-run` validates without submitting. `--disclosure-accepted` is agent-internal (grants submission scopes after the user confirmed the filing in plain English; does not enable metrics). `--as-anonymous` skips contact sync for that submit (PRIV-2: payloads never carry identity). `--help` prints flags + multiline guidance. Exit 1 with disclosure required when `submissions=not_granted` and flag omitted. Allowed even when metrics were declined.
**Exit:** `0` submitted (or dry-run ok) · `1` disclosure required / rejected · `2` bad args.
**Multiline:** free-text with newlines/spaces/quotes MUST use `--*-file` (temp file outside the worktree; same pattern as scm.md `--body-file`), not inline strings through `task`.

Automatic usage metrics (when `metrics=active`): `orient` → `orient_ok`; `check` → `check_pass`/`check_fail` (fail may include `failed_stage`); `scope:complete` → `scope_complete` (may include `disposition`, `had_delivery_pr`); `pr:watch` CLEAN → `pr_watch_clean`; `pr:finish` merged → `pr_finish_merged`. Agents emit `kickoff_done` via `collection:metric` after kickoff (optional `--dimensions` e.g. `scopes_created`, `stack_family` enum). Soft-skip continues when metrics declined even if submissions were granted. ⊗ Never put titles, paths, chat, or secrets in dimensions.

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
| Collection consent / status | `collection:opt-in` / `collection:decline` / `collection:status` |
| Reply-channel identity | `collection:identity -- --show\|--clear\|--update …` |
| Send feedback / bug / feature | `feedback` (multiline → `--*-file`; optional `--as-anonymous`) |
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
