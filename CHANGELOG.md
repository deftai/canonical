# Changelog

## [Unreleased]

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
