# Changelog

## [Unreleased]

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
