# third_party

External repositories consumed read-only as conformance oracles. Nothing here
ships in the npm package (`files` allowlist excludes it) and nothing here is
imported by runtime code — dev/test only.

## xBRIEF

Pinned clone of [deftai/xBRIEF](https://github.com/deftai/xBRIEF), the open
xBRIEF specification. Canonical's durable state (`xbrief/`) consists of
xBRIEF v0.8 documents; this submodule supplies the authority we test against:

- `schemas/xbrief-core-0.8.schema.json` — the normative JSON Schema. The
  conformance test suite validates every document shape canonical emits
  against it (ajv, devDependency).
- `examples/*.xbrief.json` — differential corpus: canonical's shipped
  core-conformance validator must agree with the spec's own valid and
  known-invalid fixtures.
- `libxbrief-ts/src/` — reference implementation, deep-imported by tests
  only for serialization-parity checks (zod-free modules only).

**Pin policy:** the submodule targets the v0.8 spec (currently commit
`56824ed`, 2026-06-30). Bumping it is a deliberate, reviewed change — update
only when adopting a new spec version, and expect the conformance suite to
be the thing that tells you what changed.

Fresh checkouts need `git submodule update --init`.
