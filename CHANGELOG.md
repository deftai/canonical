# Changelog

## [Unreleased]

- Opt-in feedback and usage collection via vendored `@deft/collection-sdk`:
  per-project credentials in `.canonical/collection.json` (gitignored), anonymous
  correlator (`userKey` in `~/.config/canonical/identity.json`) sent as SDK
  `correlator` (4-segment deployment id; never `deployment.customer`). Consent
  split: **metrics** = explicit `collection:opt-in` (default `usage` only);
  **submissions** = disclosure-gated via `feedback --disclosure-accepted`.
  Orient/status print `metrics=… submissions=… identity=…`. Consent version
  `canonical-2026-09-a`. Legacy all-scopes active files migrate without
  re-prompt. New verbs: `collection:status|opt-in|decline|opt-out|metric`,
  `feedback`. Soft usage metrics from `orient` / `check` / `scope:complete` /
  `pr:watch` / `pr:finish` (never change host exit codes). Default collector
  URL is staging; override with `CANONICAL_COLLECTION_URL`.

## [0.3.0] - 2026-08-07

- Pack content: the engineering security floor gains TOCTOU/pin-by-hash rules
  for mutable external resources and constraint-tier rules for agent tool
  registries; scm deployment now requires verifying the target environment
  from a trusted non-prompt signal and treats backups as first-class
  destructive state; kickoff gains plain-English interview rules and a
  third-party IP check (monetization intent plus three protection scope
  items). Ported from the Directive high-value audit. (#3)

- BREAKING: every durable state file under `xbrief/` is now a conformant
  [xBRIEF v0.8](https://github.com/deftai/xBRIEF) document. Scope files gain the
  `{"xBRIEFInfo":{"version":"0.8"},"plan":{...}}` envelope, move `title`/`items`/
  `narratives`/`references` under `plan`, and carry canonical-specific fields as
  `x-canonical/*` extension properties (`kind`, `dependencies`, `swarm` -- now
  camelCase `filesScope`/`verifyCommands` -- `delivery`, and per-reference
  `trust`). Reference types use the spec registry (`x-xbrief/github-issue`,
  `x-xbrief/github-pr`, `x-xbrief/plan`) plus `x-canonical/user-request`.
  Acceptance items are spec PlanItems (`{id, title, status}`, `done` is gone).
  Filenames end `.xbrief.json`; the root docs are `PROJECT.xbrief.json`
  (policy at `plan["x-canonical/policy"]`), `spec.xbrief.json`,
  `plan.xbrief.json` (ordering at `plan["x-canonical/sequence"]` -- core
  `plan.sequence` is an integer and was silently colliding), and
  `continue.xbrief.json`. `audit.jsonl` is unchanged (event log, not a
  document). No migration is provided -- pre-0.3 projects should re-run
  `canon init` and recreate their scopes; `state:validate` flags leftover
  legacy files as `legacy-file`.
- `state:validate` is now layered: parse -> core xBRIEF v0.8 conformance
  (envelope, enums, item ids, string narratives, reference-type registry,
  offset-bearing timestamps) -> canonical profile (folders, filenames,
  x-canonical blocks). New finding codes: `bad-envelope`, `bad-version`,
  `bad-item`, `bad-narrative`, `bad-plan-id`, `bad-dependency`, `bad-root-doc`,
  `legacy-file`. Root docs are scanned too.
- Scope writes use canonical serialization (recursively sorted keys, trailing
  newline) byte-identical to the reference `libxbrief-ts` encoder, and unknown
  `x-<token>/` extension properties round-trip untouched (spec section 7.2).
- Conformance is CI-enforced against the spec's own artifacts: the
  `deftai/xBRIEF` repo is pinned as the `third_party/xBRIEF` submodule and a
  new test suite validates every emitted document shape against the real 0.8
  JSON Schema (ajv, dev-only) and differentially against the spec's examples
  corpus. Runtime stays zero-dependency -- the shipped validator is
  canonical-owned code.
- New maintainer doc `docs/xbrief-canonical-profile.md`: the `x-canonical`
  consumer-token claim, storage conventions (lifecycle folders as views of
  `plan.status`), extension property shapes, and the v0.9 forward-compatibility
  stance (core fields win when the spec standardizes equivalents).

## [0.2.2] - 2026-08-05

- canonical-tasks.md intro now states the `canon` CLI implements every verb and
  the file is the binding contract (intent -> verb, args, exit codes) for agents
  and any alternative implementation; vestigial "Minimal Install Order" section
  removed (`canon init` deposits everything at once).
- CI: actions/checkout and actions/setup-node bumped v4 -> v5 (GitHub deprecated
  the Node 20 action runtime) and pinned to full commit SHAs instead of floating
  tags (supply-chain hardening, from PR review).

## [0.2.1] - 2026-08-05

- engineering.md gains a Security Floor: OWASP ASVS / Cheatsheet Series named as
  the external canon, no hand-rolled security primitives, trust-boundary input
  validation, and security scanners wired into `quality.commands[]` gate
  `task check` like any other stage.
- engineering.md Quality Gate: new tests must be seen failing against pre-change
  code (red before green) -- a test never seen red proves nothing.
- engineering.md: prefer recognized patterns/algorithms over novel abstractions;
  comments state constraints and why, never what.
- Leaner npm package: test-support helpers and dangling sourcemap references no
  longer ship; vestigial tsconfig.base.json merged into tsconfig.json.

## [0.2.0] - 2026-08-05

- BREAKING: the durable work-state folder is `xbrief/` (was `briefs/`), renamed
  throughout the pack, the CLI, hooks, and docs. No migration is provided --
  pre-0.2 projects should re-run `canon init` and recreate their scopes.
- `canon --version` reports the real installed version (was hardcoded 0.1.0).

## [0.1.1] - 2026-08-05

- First release published via npm Trusted Publishing (OIDC) from CI, with automatic
  provenance attestation. No functional changes.

## [0.1.0] - 2026-08-04

- Initial release: the canonical pack (7 rule files) + the `canon` CLI with 20
  deterministic verbs, `canon init`/`canon update` project installer, go-task
  surface, and fail-closed git hooks.
