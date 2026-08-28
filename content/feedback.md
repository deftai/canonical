# Feedback & Collection

Load when: the user says `/feedback`, asks to send feedback, report a bug, or request a feature; `orient` reports `metrics=not_prompted`; or a feedback submit fails with disclosure required / expired.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

Anonymous collection via Deft's collector. Credentials live in `.canonical/collection.json` (gitignored). A separate anonymous correlator (`userKey` field) under `~/.config/canonical/identity.json` is sent as `CollectorConfig.correlator` (never as `deployment.customer`).

**Consent version:** `canonical-2026-09-a` (pass unchanged to `collection:opt-in` / disclosure grant).

Orient / status are machine-parseable: `metrics=… submissions=… identity=…` (`identity` ∈ `anonymous|identified`; identified requires email or mobile).

## Two consent tracks

| Track | How granted | Scopes | Default |
|---|---|---|---|
| **Metrics** | Explicit repo opt-in (`collection:opt-in --confirm`) | `usage` only | Off until opted in |
| **Submissions** | Disclosure on first `/feedback` ask | `feedback`, `bug`, `feature` | Off until disclosure accepted |

- ⊗ Flipping submissions grant MUST NOT enable metrics, and metrics opt-in MUST NOT silently grant submissions.
- ⊗ Contact (email/name/mobile) is never placed in event/submission payloads (PRIV-2). Optional contact lives in `.canonical/collection.json` `identity` and is synced only via `collection:identity --update` / opt-in reconfirm (`name` ← `"firstName lastName".trim()`, `email`, `sms` ← mobile).
- Consent expires after ~1 year; revoke anytime with `task collection:opt-out -- --confirm`.

## Scopes

| Scope | Track | What is sent |
|---|---|---|
| `usage` | Metrics | Coarse counters only (`orient_ok`, `kickoff_done`, `scope_complete`, `check_pass`/`check_fail`, `pr_watch_clean`, `pr_finish_merged`) — no source, no chat |
| `feedback` | Submissions | Free-text message + optional 1–5 rating |
| `bug` | Submissions | Summary, OS, optional stack/logs (ask before attaching logs) |
| `feature` | Submissions | Summary + optional details/context |

## First-session metrics consent (after `orient`)

- ! When `orient` prints `metrics=not_prompted` (or JSON `metrics: "not_prompted"`), offer this menu **once** before other mutation work. Explicit affirmative required (`yes` / `confirmed` / `approve`) — Canonical consent contract.
- ! Numbered menu; `Discuss` and `Back` last:

  1. **Opt in to usage metrics (recommended)** — anonymous counters only. Then: `task -x collection:opt-in -- --confirm`
  2. **Decline metrics** — no usage telemetry. Then: `task -x collection:decline`
  3. **Discuss**
  4. **Back**

- ⊗ Register or opt in without that affirmative. ⊗ Re-prompt every session after decline; only re-offer metrics when state is `expired`/`revoked`, or the user asks.
- ~ Optional contact: after metrics opt-in, ask once whether they want a reply channel; if yes, update identity (not event payloads):

  `task -x collection:identity -- --update --first-name=… --last-name=… --email=… --mobile=…`

  Show with `--show`; clear with `--clear` (or `task -x collection:opt-out -- --identity`). Event payloads never include contact (PRIV-2); `--as-anonymous` documents that intent on the submit path.

## `/feedback` flow (disclosure-gated submissions)

1. ! If `submissions=not_granted`, disclose what will be sent **before** any network submit:
   - Canonical version
   - `installId`
   - correlator (anonymous install cluster id)
   - kind-specific fields (summary/message/details/stack/logs/…)
   - Explicit: this does **not** enable usage metrics
2. ! Numbered menu after disclosure; `Discuss` and `Back` last:

   1. **Agree and submit** — then gather fields and call feedback with `--disclosure-accepted`
   2. **Disagree** — do not submit; leave metrics untouched
   3. **Discuss**
   4. **Back**

3. ! Classify with a numbered menu: (1) bug (2) feature request (3) general feedback, then `Discuss`, `Back`.
4. ! Gather fields, then call the verb — never invent success:

| Kind | Command |
|---|---|
| bug | `task -x feedback -- --kind=bug --summary="…" [--stack-file=…] [--logs-file=…] [--disclosure-accepted]` |
| feature | `task -x feedback -- --kind=feature --summary="…" [--details-file=…] [--context-file=…] [--disclosure-accepted]` |
| feedback | `task -x feedback -- --kind=feedback --message="…" [--rating=1..5] [--disclosure-accepted] [--as-anonymous]` |

`--disclosure-accepted` is required only on the first submissions grant (or when status shows `submissions=not_granted`). It registers if needed, opts in **submission scopes only** on the server, records `submissions=granted` locally, and submits — metrics stay as they were.

Short single-line values MAY use inline `--summary=` / `--message=`. For multiline or free-text that contains spaces/newlines/quotes (details, context, stack, logs, long summaries), ! write a temp file **outside the worktree** and pass the matching file flag — same rule as [scm.md](./scm.md) `--body-file`:

| Field | File flag |
|---|---|
| summary | `--summary-file PATH` |
| message | `--message-file PATH` |
| details | `--details-file PATH` |
| context | `--context-file PATH` |
| stack | `--stack-file PATH` |
| logs | `--logs-file PATH` |

Example (feature with multiline details):

```bash
DETAILS="$(mktemp)"
printf '%s\n' 'line1' 'line2 with spaces' > "$DETAILS"
task -x feedback -- --kind=feature --summary="Add dark mode" --details-file="$DETAILS" --disclosure-accepted
rm -f "$DETAILS"
```

- ⊗ Probe the live collector with short dummy submits while debugging flags. Use `task -x feedback -- --dry-run --json …` (or `canon feedback --help`) to validate without submitting.
- Inline + file for the same field → exit 2 conflict.
- `canon feedback` with a real argv list (no shell join) is also safe for multiline; prefer file flags when calling through `task`.

5. ! Report the verb's exit code and submission id on success. On exit 1 (`disclosure required` / rejected), explain and offer disclosure or retry — ⊗ claim the report was sent.
6. ⊗ Put secrets, tokens, or full source dumps into `--logs` / `--stack` without asking.

## Kickoff / session metrics

- ! After a kickoff finishes (PROJECT + scopes + roadmap rendered), if `metrics=active`: `task -x collection:metric -- --metric=kickoff_done --value=1` (optional `--dimensions={"scopes_created":N,"stack_family":"node"}` — `stack_family` enum only: `node|python|go|rust|other`). Soft-fail is fine. Metrics stay soft-skipped when declined even if submissions were granted.
- ~ On session end / continue-checkpoint when `metrics=active`, agents MAY emit `session_summary` with bucketed dims only (`agent_turns_bucket` ∈ `1-5|6-15|16-40|40+`, integer scope counts). ⊗ Do not scrape chat into dimensions.

## Status & revoke

- `task -x collection:status` — prints `metrics=… submissions=… identity=…`; add `--live` to refresh from the server when credentials exist.
- `task -x collection:identity -- --show|--clear|--update …` — manage reply-channel identity (0600 local block; server contact via opt-in reconfirm).
- `task -x collection:opt-out -- --confirm` — revoke server-side and clear local credentials (metrics + submissions + identity).
- `task -x collection:opt-out -- --identity` — clear local identity + server contact only (leave metrics/submissions).
