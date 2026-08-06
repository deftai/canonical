# xBRIEF Canonical Profile

**Status:** Draft · **Extends:** [xBRIEF v0.8](https://github.com/deftai/xBRIEF) · **Consumer token:** `x-canonical`

How `@deftai/canonical` uses xBRIEF as its durable work-state format. This
profile is strictly additive: it defines no new required fields on any core
object, and every document it produces is a conformant xBRIEF v0.8 document
(verified in CI against the spec's own JSON Schema — see
`src/xbrief/conformance.test.ts` and the pinned spec clone in
[`third_party/`](../third_party/README.md)).

Maintainer doc, repo-only. The agent-facing operational contract is
[`content/state.md`](../content/state.md); on any disagreement about xBRIEF
semantics, the upstream spec wins, then this profile, then state.md.

## Consumer token

Canonical claims the extension token **`x-canonical`** (spec §7). All
canonical-specific properties are named `x-canonical/<name>` and may appear
anywhere §7.4 permits. Per §7.2, canonical preserves unknown `x-<token>/`
properties from other consumers verbatim across every read/modify/write; its
own extensions expect the same treatment in return.

## Storage conventions (not part of the document format)

The spec says nothing about files on disk; these are profile conventions:

- Documents are files named `*.xbrief.json`, serialized canonically
  (recursively alphabetized keys, 2-space indent, trailing newline).
- **Scope documents** — one plan per unit of work — live under lifecycle
  directories `xbrief/{proposed,pending,active,completed,cancelled}/` with
  filenames `YYYY-MM-DD-<slug>.xbrief.json` (slug `[a-z0-9]+(-[a-z0-9]+)*`,
  ≤80 chars, `-issue-<N>` suffix for tracker ingests).
- The directory is a **view of `plan.status`**, never the truth:
  `proposed→proposed/`, `pending→pending/`, `running|blocked→active/`,
  `completed|failed→completed/`, `cancelled→cancelled/`. On disagreement,
  trust `plan.status` and fix the folder.
- Root documents: `PROJECT.xbrief.json` (project identity — a perpetual plan
  carrying policy), `spec.xbrief.json` (requirements), `plan.xbrief.json`
  (delivery ordering), `continue.xbrief.json` (interruption checkpoint).
  `audit.jsonl` is an append-only event log, not an xBRIEF document.

## Core-field usage

- `plan.status`: canonical uses the seven core values
  `proposed|pending|running|blocked|completed|failed|cancelled` on scopes
  (`draft`/`approved` are legal xBRIEF but unused by the lifecycle).
- `plan.items`: acceptance criteria — `{id, title, status}` with ids `ac1…acN`
  and status restricted to `pending|completed`.
- `plan.narratives`: TitleCase string values; canonical's tooling reads
  `Description`, `Acceptance`, `Traces`, `Origin`, and `Note` by name.
- `plan.references`: core reference entries. Types used: `x-xbrief/github-issue`,
  `x-xbrief/github-pr`, `x-xbrief/plan` (spec registry) and
  `x-canonical/user-request`.
- `edges` are not emitted; cross-scope ordering uses
  `x-canonical/dependencies` (below), since core edges are intra-plan only.

## `x-canonical/*` properties

All on `plan` unless noted; on reference entries where marked.

| Property | Type | Meaning |
|---|---|---|
| `x-canonical/kind` | `"story"\|"epic"\|"chore"` | story executes, epic groups, chore is non-feature work |
| `x-canonical/dependencies` | `string[]` | scope filenames this scope waits on (cross-document ordering) |
| `x-canonical/swarm` | `{filesScope: string[], verifyCommands: string[], readiness: "ready"\|"blocked"\|"unset"}` | parallel-dispatch readiness: write fence + verification commands |
| `x-canonical/delivery` | `{disposition: "delivered"\|"accepted_not_delivered"\|"superseded"\|"experiment_archived", pr?, sha?, branch?}` | delivery evidence required to complete code-bearing work |
| `x-canonical/trust` (on `references[]` entries) | `"verified"\|"internal"\|"external"` | provenance trust level of the referenced source |
| `x-canonical/policy` (PROJECT doc) | object | typed project policy fields (see content/state.md "Project Policy") |
| `x-canonical/quality` (PROJECT doc) | `{commands?: string[], forwardCoverageRoots?: string[]}` | quality-gate command list + coverage roots |
| `x-canonical/sequence` (plan doc) | `string[]` | ordered scope rel-paths for `work:next` (core `plan.sequence` is an integer revision counter — distinct field) |

## Forward compatibility

xBRIEF issue #40 proposes core v0.9 fields overlapping `x-canonical/swarm`
(`filesScope`, `verifyCommands`, `difficulty`, acceptance-criteria typing).
The camelCase naming here is deliberate alignment. When equivalent core
fields land in a future spec version, this profile will deprecate the
overlapping `x-canonical` properties in favor of core; readers MUST prefer
core fields when both are present.
