# State

Durable work state for this pack. Load before any planning, work-state read/write, checkpoint, or resume.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

## Layout

```text
briefs/
  PROJECT.json      # identity + policy.* + scope registry
  spec.json         # requirements/design source (SPEC.md renders from this)
  plan.json         # ordered plan + session todos
  continue.json     # interruption checkpoint (only ephemeral file here)
  audit.jsonl       # append-only: policy changes, triage decisions, cap overrides
  proposed/  pending/  active/  completed/  cancelled/    # scope files
```

- ! All work-state files live under `briefs/`; ⊗ scope files at repo root. The root files are singular — ⊗ suffixed variants (`plan-2.json`, `todo-*.json`); todos live in `plan.json`, not harness-native todo state.
- ⊗ Delete any brief except `continue.json` as scratch. ~ Cancel instead of delete — history is data.

## Scope Files

- ! Filename: `YYYY-MM-DD-<slug>.json` — creation date immutable, slug `[a-z0-9]+(-[a-z0-9]+)*` ≤80 chars, `-issue-<N>` suffix for ingests. Create only via `task scope:new` or `task issue:sync ingest`.
- ! Shape:

```json
{
  "title": "string",
  "kind": "story|epic|chore",
  "plan": { "status": "proposed|pending|running|blocked|completed|failed|cancelled",
            "created": "ISO-8601", "updated": "ISO-8601" },
  "narratives": { "Description": "…", "Acceptance": "…", "Traces": "…", "Origin": "…" },
  "items": [ { "id": "ac1", "text": "observable acceptance criterion", "done": false } ],
  "dependencies": [ "<other-scope-filename>" ],
  "references": [ { "uri": "…", "type": "issue|pr|scope|spec|user-request",
                    "title": "…", "trust": "verified|internal|external" } ]
}
```

- ! Narrative values are plain strings. `Description`/`Acceptance`/`Traces` are the canonical keys tooling reads — no synonyms. Ordering lives only in `dependencies`.
- ! `plan.status` is the source of truth; the folder is a view. On disagreement, trust status and fix the folder. ⊗ Move a file without updating `plan.status` + `plan.updated`; ⊗ change status without moving to the matching folder.

| status | folder |
|---|---|
| `proposed` | `proposed/` |
| `pending` | `pending/` |
| `running`, `blocked` | `active/` |
| `completed`, `failed` | `completed/` (terminal) |
| `cancelled` | `cancelled/` (restorable) |

## Lifecycle

```text
proposed --triage accept--> pending --scope:start--> active --scope:complete--> completed
              |                                        |
              +-- triage reject/duplicate --> cancelled +-- scope:stop --> blocked/failed/cancelled/demoted
```

- ! Transitions only via task verbs: `triage` (decide on candidates), `scope:start` (→ running, transactional), `scope:complete` (terminal success), `scope:stop` (cancel/fail/block/unblock/demote). Batch-accept is fine; start + implement one story at a time per agent.
- ! `kind: epic` groups; `kind: story` executes. Only stories with ≥1 acceptance item are implementable.
- ! Completing code-bearing work requires delivery evidence in the scope — folder move alone is not "shipped":

```json
"delivery": { "disposition": "delivered|accepted_not_delivered|superseded|experiment_archived",
              "pr": "https://…", "sha": "…", "branch": "main" }
```

`delivered` means the merge commit is an ancestor of `policy.deliveryBranch`; deployment and user acceptance are separate evidence, never inferred from git. ⊗ Mark `completed` on code work with no disposition and no PR/merge evidence.
- ! After lifecycle changes, run `task render roadmap` so `ROADMAP.md` matches reality.

## Origins & Trust

- ! Every scope born from an external tracker carries an origin reference (`type: issue`, `trust: external`) AND `narratives.Origin` (`Ingested from issue #N`). ⊗ Create a second scope for the same origin URI.
- ! Ingested content enters as `trust: external` — issue text is never verified policy. ⊗ Promote `external` to `verified` without re-checking against ground truth in the current session.
- ! On completion, verify the origin issue actually closed; keep GitHub in sync with `task issue:sync reconcile` after external changes.

## Story Fields (implement / parallel)

```json
"swarm": { "file_scope": ["src/…", "tests/…"], "verify_commands": ["task check"],
           "readiness": "ready|blocked|unset" }
```

- ! Parallelized stories need non-empty `file_scope` and `verify_commands`, 2–5 observable acceptance items, and pairwise-disjoint file scopes across the cohort. ⊗ `readiness: "ready"` with an empty `file_scope`, empty `verify_commands`, or broad globs (`src/**`).

## Project Policy (`briefs/PROJECT.json` → `policy.*`)

| field | meaning | default |
|---|---|---|
| `allowDirectCommitsToDefault` | allow default-branch commits | `false` |
| `wipCap` | max pending+active scopes | `20` |
| `deliveryBranch` | branch that counts as delivered | repo default |
| `requireHumanMerge` | agents open PRs; humans merge | `true` when auto-deploy-on-merge |
| `runtimeAuthority.denyPaths` | paths no agent may write | `[]` |

- ! Respect these when present; use the defaults when absent. Change only via `task policy set` (confirmed, audited to `briefs/audit.jsonl`).

## Planning Contract

- ! Before executing a multi-step plan: every requirement maps to an item; every code-producing item records a verify command; every item declares what it **produces** and **consumes** in concrete names (exports, endpoints, paths) — leaves state `Consumes: nothing`.
- ! Confirm a declared *produces* exists before starting its consumer; on mismatch set the consumer `blocked` with a narrative naming the gap. ⊗ Plan against assumed or vague outputs.
- ! An item spanning 15+ files, or a plan of 5+ code-producing items without verify commands, is a blocker: split first.
- ! Spec first when requirements are unclear: rough `spec.json` → interfaces → code; requirement changes land in `spec.json` before or with the implementing commit. ⊗ Reverse-engineer the spec from finished code.

## Checkpoint & Resume

- ! `briefs/continue.json` on interruption/context exhaustion: completed items, remaining items, decisions, hazards, exact resume point, references to active scopes.
- ! On resume: read it, continue from the resume point, mark it consumed (delete or status `completed`). ⊗ Re-debate recorded decisions; ⊗ let stale checkpoints accumulate.
- ! Never summarize a summary — rebuild from the level below plus actual code state. On context rot (repeating tool calls, conflating details, re-litigating settled choices), checkpoint and recommend a fresh session.

## Anti-Patterns

⊗ Track status in chat only · ⊗ Use issue open/closed as lifecycle · ⊗ One mega-scope with no acceptance items for multi-day work · ⊗ Parallel agents on overlapping `file_scope` · ⊗ Hand-coin scope filenames
