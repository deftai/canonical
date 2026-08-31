# Feedback & Collection

Load when: the user asks to send feedback, report a bug, or request a feature; `orient` reports `metrics=not_prompted` (or not decided / expired); or they ask to opt in, opt out, or change Canonical collection contact.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

**Consent version:** `canonical-2026-09-b` (pass unchanged to opt-in / identity / feedback verbs).

Credentials live in `.canonical/collection.json` (gitignored). Correlator (`userKey`) under `~/.config/canonical/identity.json` → SDK `correlator` (never `deployment.customer`). Orient / status are machine-parseable: `metricsMode=… metrics=… submissions=… identity=…` (`metricsMode` ∈ `undecided|disallowed|anonymous|attributed`; `identity` ∈ `anonymous|identified`; identified requires email or mobile).

---

## User dialogue (say this to the human)

⊗ Never read task verb names, flags, or shell recipes aloud. Speak plain English. User-facing language for later changes is always “ask me to …”.

### First-session metrics (when `orient` shows not prompted / not decided)

1. ! Thank them for using Canonical. Say we'd like usage metrics to improve the product. State clearly: **by default we collect nothing, even anonymously.**
2. ! Offer three choices (numbered menu; **Discuss** and **Back** last where menus apply):
   1. **Disallow** — no usage metrics
   2. **Anonymous metrics** — coarse usage counters only; no name, email, or mobile
   3. **Attributed metrics** — same counters, plus optional Name, Email, and Mobile so we can follow up
3. ! Durable grants need an explicit yes / confirm (`yes` / `confirmed` / `approve` — Canonical consent contract). ⊗ Register or opt in without that affirmative. ⊗ Re-prompt every session after decline; only re-offer when state is `expired` / `revoked`, or the user asks.
4. ! If they chose **Attributed**: collect Name, Email, and Mobile each as **optional**; read the values back; get an explicit reconfirm before saving.
5. ! After the choice is saved:
   - Explain they can later ask you to file a bug, feature request, or general feedback.
   - **IFF attributed:** confirm they are OK that the contact on file is associated (via this install — **not** placed in the report body) with those filings.
   - Tell them they can opt out anytime by asking you to opt out of Canonical collection.
   - Tell them opt-out stops **future** collection, but past filings may still be associated until they ask to delete personal data.

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
| Attributed metrics | same opt-in, then after field reconfirm: `task -x collection:identity -- --update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]` |
| Opt out | `task -x collection:opt-out -- --confirm` — server opt-out, then **rotate install** (clear local credentials / new install on next register). Stops future collection; past association may remain until they ask to delete personal data. |
| Clear contact only | `task -x collection:opt-out -- --identity` (or `collection:identity -- --clear`) |
| Show contact | `task -x collection:identity -- --show` |
| Status | `task -x collection:status` (`--live` when credentials exist) |

- ⊗ Contact (name/email/mobile) is never placed in event or submission payloads (PRIV-2). Identity syncs only via `collection:identity` / opt-in reconfirm (`name` ← `"firstName lastName".trim()`, `email`, `sms` ← mobile).
- Metrics opt-in does not silently mean every future filing is attributed; attributed association is “contact on file + install”, stated per submit when relevant.
- Consent expires after ~1 year; re-offer when `expired` / `revoked`, or when the user asks.

### Feedback submit (after user confirms contents)

| Kind | Command |
|---|---|
| bug | `task -x feedback -- --kind=bug --summary="…" [--stack-file=…] [--logs-file=…] [--disclosure-accepted]` |
| feature | `task -x feedback -- --kind=feature --summary="…" [--details-file=…] [--context-file=…] [--disclosure-accepted]` |
| feedback | `task -x feedback -- --kind=feedback --message="…" [--rating=1..5] [--disclosure-accepted] [--as-anonymous]` |

- `--disclosure-accepted` and `--as-anonymous` are **agent-internal**. Use them as the verb requires; do not narrate them. Prefer `--as-anonymous` when the user confirmed an anonymous filing (or no contact on file).
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
| `usage` | Metrics | Coarse counters only (`orient_ok`, `kickoff_done`, `scope_complete`, `check_pass`/`check_fail`, `pr_watch_clean`, `pr_finish_merged`) — no source, no chat |
| `feedback` | Submissions | Free-text message + optional 1–5 rating |
| `bug` | Submissions | Summary, OS, optional stack/logs |
| `feature` | Submissions | Summary + optional details/context |

### Kickoff / session metrics

- ! After kickoff finishes (PROJECT + scopes + roadmap rendered), if `metrics=active`: `task -x collection:metric -- --metric=kickoff_done --value=1` (optional `--dimensions={"scopes_created":N,"stack_family":"node"}` — `stack_family` ∈ `node|python|go|rust|other`). Soft-fail is fine. Metrics stay soft-skipped when declined.
- ~ On session end / continue-checkpoint when `metrics=active`, agents MAY emit `session_summary` with bucketed dims only (`agent_turns_bucket` ∈ `1-5|6-15|16-40|40+`, integer scope counts). ⊗ Do not scrape chat into dimensions.
