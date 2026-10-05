# Feedback & Collection

Load when: the user asks to send feedback, report a bug, or request a feature; `orient` reports `metrics=not_prompted` (or not decided / expired); or they ask to opt in, opt out, or change Canonical collection contact.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

**Consent version:** `canonical-2026-09-b` (baked into opt-in / feedback; do not pass a version flag).

Credentials live in `.canonical/collection.json` (gitignored; mode 0600). Contact is server-only — local state keeps a boolean `attributed` flag, never name/email/mobile. Orient / status print `metricsMode=… metrics=… submissions=… identity=… channel=staging|production` (`metricsMode` ∈ `undecided|disallowed|anonymous|attributed`; `identity` ∈ `anonymous|identified` when attributed).

---

## User dialogue (say this to the human)

⊗ Never read task verb names, flags, or shell recipes aloud. Speak plain English. User-facing language for later changes is always “ask me to …”.

### First-session metrics (when `orient` shows not prompted / not decided)

1. ! Thank them for using Canonical. Say we'd like usage metrics to improve the product. State clearly: **by default we collect nothing, even anonymously.**
2. ! Offer three choices (numbered menu; **Discuss** and **Back** last where menus apply):
   1. **Disallow** — no usage metrics
   2. **Anonymous metrics** — coarse usage counters only; no name, email, or mobile
   3. **Attributed metrics** — same counters, plus optional Name, Email, and Mobile so we can follow up
3. ! Branch by choice — **do not** insert an extra approve/deny step before collecting attributed contact:

   **Disallow or Anonymous**
   - ! Get one durable affirmative (`yes` / `confirmed` / `approve`) for that choice. Prefer the Recommended option to be **Approve**.
   - ! Then save (agent actions below). ⊗ Register or opt in without that affirmative.

   **Attributed** (order is load-bearing)
   1. ! As soon as they pick Attributed, **collect contact next** — do **not** ask them to approve “Attributed” alone first.
   2. ! Ask for **Name**, **Email**, and **Mobile**, each optional (they may skip any field). Prefer free-text / “provide the value” as the primary path — ⊗ do not make them dig through a menu whose default is “skip” or “disapprove” before they can type.
   3. ! Read back the mode (**Attributed**) plus whatever fields they gave (note skips). Get **one** durable affirmative for the whole package (`yes` / `confirmed` / `approve`). Prefer Recommended = **Approve / save**.
   4. ! Only then save (single attributed opt-in verb with contact flags — see Agent actions). If they skipped **all** contact fields, save as **Anonymous metrics** instead and say so briefly.

4. ⊗ Re-prompt every session after decline; only re-offer when state is `expired` / `revoked`, or the user asks.
5. ! After the choice is saved, tell them (plain English, not another approve gate):
   - They can later ask you to file a bug, feature request, or general feedback.
   - **IFF attributed:** contact on file will be associated (via this install — **not** placed in the report body) with those filings.
   - They can opt out anytime by asking you to opt out of Canonical collection.
   - Opt-out stops **future** collection; past filings may still be associated until they ask to delete personal data.

### Per-submit feedback (even if metrics are disallowed)

Works whether metrics were disallowed, anonymous, or attributed. No separate durable “submissions disclosure” ceremony in user speech.

1. ! Classify with a numbered menu: (1) bug (2) feature request (3) general feedback, then Discuss, Back.
2. ! Gather the fields for that kind. Ask before attaching logs or stack dumps. ⊗ Put secrets, tokens, or full source dumps in without asking.
3. ! Confirm the contents back to the user. State clearly whether this filing is **anonymous** or **associated with the contact on file** (association is via install, never contact text inside the report).
4. ! Only after they confirm, file it. Report success with the submission id — or the real failure. ⊗ Claim it was sent when it was not.

### Opt-out / opt-in later

- Opt out: user asks you to opt out of Canonical collection → confirm, then run agent opt-out.
- Opt in / change mode later: user asks you to turn on Canonical metrics (anonymous or attributed) or to update contact → use the same plain-English choices and confirms as first-session.
- Clear or change contact only: user asks you to update or clear Canonical contact on file.

---

## Agent actions (silent — ⊗ never read task lines aloud)

Map user choices to verbs. Internal flags are fine; humans never hear them.

### Choice → verb map

| User choice | Agent action |
|---|---|
| Disallow | `task -x collection:decline` |
| Anonymous metrics | `task -x collection:opt-in -- --confirm` (usage only; consent version `canonical-2026-09-b`) |
| Attributed metrics | **Preferred one shot after package approve:** `task -x collection:opt-in -- --confirm [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]` (sends contact to server; sets local `attributed`). Fallback: `collection:identity -- --update …` only if opt-in already succeeded without contact. |
| Opt out | `task -x collection:opt-out -- --confirm` — server opt-out, then **rotate install** (clear local credentials / new install on next register). Stops future collection; past association may remain until they ask to delete personal data. |
| Clear contact only | `task -x collection:identity -- --clear` (or `collection:opt-out -- --identity`) — empty contact to server; metrics/submissions unchanged |
| Show contact | `task -x collection:identity -- --show` — prints `identity=anonymous|identified` only (no fields) |
| Update contact | `task -x collection:identity -- --update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]` — whole replace; needs active consent |
| Status | `task -x collection:status` — ends with ` channel=staging|production` |

- ⊗ Contact (name/email/mobile) is never stored locally and never placed in event or submission payloads (PRIV-2). Sent only via attributed `collection:opt-in` / `collection:identity --update` (`name` ← `"firstName lastName".trim()`, `email`, `sms` ← mobile).
- Metrics opt-in does not silently mean every future filing is attributed; attributed association is “contact on file + install”, stated per submit when relevant.
- Consent expires after ~1 year; re-offer when `expired` / `revoked`, or when the user asks.

### Feedback submit (after user confirms contents)

| Kind | Command |
|---|---|
| bug | `task -x feedback -- --kind=bug --summary="…" --disclosure-accepted [--stack-file=…] [--logs-file=…]` |
| feature | `task -x feedback -- --kind=feature --summary="…" --disclosure-accepted [--details-file=…] [--context-file=…]` |
| feedback | `task -x feedback -- --kind=feedback --message="…" --disclosure-accepted [--rating=1..5] [--as-anonymous]` |

- `--disclosure-accepted` is **required** on every real submit (agent-internal; do not narrate). Prefer `--as-anonymous` when the user confirmed an anonymous filing (or no contact on file).
- Short single-line values MAY use inline `--summary=` / `--message=`. Multiline / spaces / quotes → temp file **outside the worktree** + matching `--*-file` (same rule as [scm.md](./scm.md) `--body-file`):

| Field | File flag |
|---|---|
| summary | `--summary-file PATH` |
| message | `--message-file PATH` |
| details | `--details-file PATH` |
| context | `--context-file PATH` |
| stack | `--stack-file PATH` |
| logs | `--logs-file PATH` |

- ⊗ Probe the live collector with dummy submits while debugging. Use `task -x feedback -- --dry-run --json …` (or `canon feedback --help`) to validate without submitting.
- Inline + file for the same field → exit 2 conflict.
- Feedback remains available when metrics were disallowed.

### Scopes (reference)

| Scope | Track | What is sent |
|---|---|---|
| `usage` | Metrics | Structured counters + optional `--dimensions` JSON (≤2KiB): lifecycle verbs, quality gate, session shape, agent-emitted `kickoff_done` — no source, no chat |
| `feedback` | Submissions | Free-text message + optional 1–5 rating |
| `bug` | Submissions | Summary, OS, optional stack/logs |
| `feature` | Submissions | Summary + optional details/context |

### Kickoff / session metrics

- ! After kickoff finishes (PROJECT + scopes + roadmap rendered), if `metrics=active`: `task -x collection:metric -- --metric=kickoff_done --value=1` (optional `--dimensions={"scopes_created":N,"stack_family":"node"}` — `stack_family` ∈ `node|python|go|rust|other`). Soft-fail is fine. Metrics stay soft-skipped when declined.
- ! **Agent turn bump rule:** once per user turn that performs mutation after orient, if `metrics=active`: `task -x collection:metric -- --metric=agent_turn --value=1` (increments durable counter in `.canonical/collection-session.json`; no network payload). ⊗ Do not count read-only turns (orient/status/help).
- ~ On session end / continue-checkpoint when `metrics=active`, emit `session_summary` via `collection:metric` (auto-fills bucketed dims from session file when `--dimensions` omitted): `agent_turns_bucket` ∈ `1-5|6-15|16-40|40+`, integer scope/check/consent counts, optional `duration_bucket`. Clears session file on successful emit. ⊗ Do not scrape chat into dimensions.
