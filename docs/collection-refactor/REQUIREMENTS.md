# Collection client refactor - REQUIREMENTS

Authority order for this work: **REQUIREMENTS (what) > IMPLEMENTATION (how) > EXECUTION (who, when)**.
The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

Scope: Canonical's local client for consent, usage metrics and feedback (`src/collection/**`,
`src/cli/collection*.ts`, `src/cli/feedback.ts`, the telemetry call sites in other verbs, and the
guidance in `content/`). The backend (`deft-collection-endpoint`) and the vendored SDK
(`vendor/@deft/**`) MUST NOT change.

Baseline: `main` at `b392447` (v0.3.2), with PR #20 (soft-emit timer cleanup) merged first.

## 0. How to read a requirement

Each requirement has an ID and one tag:

- **[P] preserved.** Today's code already behaves this way. A test for it MUST pass against the baseline
  and MUST still pass after the refactor.
- **[C] changed.** An owner decision (section 1) changes behavior. A test for it MUST fail against the
  baseline and pass after the refactor.

"Baseline ref" points at the code or test that defines today's behavior. When a [P] requirement and the
baseline code disagree, the code wins and the disagreement is escalated to the owner; nobody adjusts
either side silently.

## 1. Owner decisions (binding)

| ID | Decision |
|---|---|
| D1 | The verb names and flags the agent uses stay the same. The six `collection:*` verbs are served by one table-driven CLI module. |
| D2 | Removed surface: `collection:status --live`; `collection:opt-in --scopes`, `--consent-version`, `--name`. |
| D3 | No machine-level identifier. `~/.config/canonical/identity.json` and the SDK `correlator` are removed. Each repository is identified only by its own `installId`. |
| D4 | Contact (name, email, mobile) is never stored locally. It is sent on opt-in and kept only on the server. The client keeps a boolean "contact on file" flag. |
| D5 | Contact verb: show prints the mode only; update replaces the whole contact and needs active consent; clear sends an empty contact. |
| D6 | A name alone counts as attributed. |
| D7 | Everything else about the customer flow is preserved exactly. |

## 2. Backend facts the client relies on

Verified in `deft-collection-endpoint` source. The test fake (IMPLEMENTATION section 6) MUST enforce them.

| ID | Fact | Backend ref |
|---|---|---|
| B1 | `POST /optin` replaces the installation's scope set with the request's `scopes`. | `packages/server/src/lib/attribution.ts:94-112` |
| B2 | Contact on opt-in: key omitted keeps what is stored; `contact: {}` clears it; an object replaces the whole contact (no per-field merge); `null` and empty strings are `schema_invalid`. | `attribution.ts:89-112`, `routes/registrations.ts:50-66` |
| B3 | `POST /optout` sets state `revoked` from any state. A revoked install is refused (`revoked`, 403) on opt-in, challenge and submit; `status` still answers. | `do/installation.ts:303,327-341,439,490` |
| B4 | Install ids are minted by the server; a second register on the same id is `already_registered`. A revoked id can never be reused. | `lib/crypto.ts:21-23`, `installation.ts:270-271` |
| B5 | The correlator is optional on every route, is not stored per install, and is never compared across requests. Header without body (or the reverse) is `correlator_mismatch`. | `routes/shared.ts:181-206` |
| B6 | A pending install (registered, never opted in) is refused `not_opted_in` on challenge. A scope outside the consented set is `scope_not_consented`. An expired opt-in is `optin_expired`. | `installation.ts:439-444` |
| B7 | Events join to the install row on `install_id`. Payload schemas are strict and have no contact fields. | `migrations/0001_init.sql`, `0004_attribution.sql`, `packages/schemas/src/schemas/*.ts` |
| B8 | Opt-in expiry is server-computed (`now + 365 days` by default) and returned as `expires_at` in epoch milliseconds. | `installation.ts:307-308`, `lib/config.ts:21` |

## 3. Customer flow and guidance (FLOW)

- **FLOW-1 [P]** The "User dialogue" section of `content/feedback.md` (from the heading
  `## User dialogue (say this to the human)` up to the `---` before `## Agent actions`) MUST be
  byte-identical to the baseline. (D6 needs no edit there: the dialogue already offers name, email and
  mobile as optional and falls back to Anonymous only when all are skipped. The "identified requires
  email or mobile" sentence that D6 retires is in the header at line 9, outside this section.)
  Baseline ref: `content/feedback.md:13-56`.
- **FLOW-2 [P]** The trigger for the consent offer MUST stay as it is: on the first mutation of a session
  the agent runs `orient`; when its output shows `metrics=not_prompted` (or expired) the agent loads
  `feedback.md` and runs the dialogue before other mutation work. Baseline ref: `content/canonical.md:68`.
- **FLOW-3 [P]** The dialogue rules MUST stay: default collects nothing; three choices (Disallow,
  Anonymous metrics, Attributed metrics); Attributed collects contact first and takes one approval for
  the whole package; all contact fields skipped saves as Anonymous; no re-prompt after a decline; re-offer
  only when the state is expired or revoked or the user asks; every filing is confirmed and described as
  anonymous or associated with the contact on file; verb names and flags are never read to the human.
  Baseline ref: `content/feedback.md:15-56`, `content/canonical.md:31`.
- **FLOW-4 [C]** The "Agent actions" section of `content/feedback.md` and the "Collection & Feedback"
  section of `content/canonical-tasks.md` MUST describe the CLI exactly as built:
  - no `--live`, `--scopes`, `--consent-version`, `--name`;
  - no correlator, `userKey` or `~/.config/canonical` text;
  - `--disclosure-accepted` shown as required on every submit (not optional, not "first submit only");
  - `collection:opt-in` documented with `--first-name --last-name --email --mobile` and as the preferred
    path for Attributed;
  - contact show / update / clear described per D5;
  - the status line documented with its ` channel=` suffix.
- **FLOW-5 [C]** Every `collection:*` or `feedback` verb and every `--flag` that appears next to one in
  `content/*.md` MUST be accepted by the CLI's argument tables. This MUST be an executable test.
- **FLOW-6 [P]** `content/feedback.md` MUST NOT exceed 118 lines.
- **FLOW-7 [C]** `docs/manual-test-plan.md` Phase 8, `docs/ARCHITECTURE.md` and `CHANGELOG.md`
  `[Unreleased]` MUST be updated: Phase 8 shows real output and no `--live`; the CHANGELOG entry tells
  users that contact is no longer stored locally, that the machine-level id is gone (the old
  `~/.config/canonical/identity.json` can be deleted), and lists the removed flags.

## 4. Storage (STO)

- **STO-1 [P]** Project state lives in `.canonical/collection.json`, written atomically and set to mode
  0600 on every write. `init` and `update` keep `.canonical/collection.json`,
  `.canonical/collection-session.json` and `.canonical/collection-inventory.json` in `.gitignore`.
  Baseline ref: `src/collection/storage.ts:235-240`, `src/init-deposit/deposit.ts:134-141`.
- **STO-2 [C]** No collection code reads or writes anything outside the project root. No request carries
  an `x-deft-correlator` header or a body `correlator` field. (D3)
- **STO-3 [C]** The state file MUST NOT contain a name, email or mobile value at any time. Its shape is:

  ```ts
  interface CollectionFile {
    installId?: string;
    token?: string;
    metrics?: { decision: "active" | "declined" | "revoked"; consentVersion: string;
                decidedAt: string; expiresAt?: number };
    submissions?: { consentVersion: string; decidedAt: string; expiresAt?: number }; // present = granted
    attributed?: boolean; // contact is on file on the server for this install
  }
  ```

- **STO-4 [C]** Reading the file normalizes older shapes and rewrites the file once (best effort) when
  normalization changed anything:
  - an `identity` object becomes `attributed: true` when any of its fields is a non-empty string, and the
    object is deleted;
  - `metricsMode`, `metrics.scopes`, `submissions.granted` and `submissions.scopes` are dropped;
  - `submissions.granted === false` becomes "no `submissions` key";
  - a granted submissions record that lists fewer than all three submission scopes is treated as not
    granted;
  - a legacy top-level `consent` mirror maps as it does today: active with all four scopes gives metrics
    active plus submissions granted with no re-prompt; active with `usage` only gives metrics active;
    active without `usage` gives metrics declined; declined or revoked keeps that decision.
    Baseline ref: `src/collection/storage.ts:86-203`.

  After any verb that reads state (including `orient`), old contact values MUST be gone from disk.
- **STO-5 [P]** A missing, unreadable or unparseable file reads as empty (not prompted). The SDK
  credential adapter's `save` and `clear` MUST keep all consent fields. Baseline ref:
  `storage.ts:205-225,310-343`.

## 5. Signal and status (SIG)

- **SIG-1 [P]** There is one consent line, exactly
  `metricsMode=<m> metrics=<s> submissions=<g> identity=<i>` with
  `m` in `undecided|disallowed|anonymous|attributed`, `s` in
  `not_prompted|declined|active|revoked|expired`, `g` in `not_granted|granted`,
  `i` in `anonymous|identified`. The orient ready message ends with it. `orient --json` keeps the keys
  `consent`, `consent_line`, `identity`, `identity_mode`, `metrics`, `metrics_mode`, `submissions`.
  Baseline ref: `src/orient/index.ts:75-136`, `src/cli/orient.ts:26-40`, `src/cli/orient.test.ts`.
- **SIG-2 [P]** Derivation, in one function:
  - no metrics record: `not_prompted` / `undecided`;
  - decision `declined` or `revoked`: that state / `disallowed`;
  - decision `active` with `expiresAt > 0 && expiresAt <= now`: `expired` / `undecided`;
  - decision `active` otherwise: `active` / `attributed` when the flag is true, else `anonymous`;
  - submissions present and not expired: `granted`, else `not_granted`.
- **SIG-3 [C]** `identity` is `identified` iff `attributed === true`. (D4)
- **SIG-4 [P]** `collection:status` prints the consent line plus ` channel=<staging|production>`; exit 0
  iff metrics are active or submissions are granted, else exit 1; text goes to stdout on 0 and stderr
  otherwise. `--json` includes the keys `channel, code, consent_version, expires_at, identity, identity_mode,
  install_id, message, metrics, metrics_mode, prompt_state, scopes, submissions`, where `scopes` is
  `["usage"]` when metrics are active plus the three submission scopes when granted.
  Baseline ref: `src/cli/collection-status.ts`, `src/collection/consent.ts:161-181`.
- **SIG-5 [C]** `collection:status` never makes a network call. `--live` is an unknown flag (exit 2) and
  `live_state` is not in the JSON. (D2)

## 6. Consent (CON)

- **CON-1 [P]** Nothing is registered and nothing is sent before an explicit opt-in or a disclosed
  feedback submit. Every collector is built with `autoRegister: false`.
- **CON-2 [P]** `collection:decline` makes no network call and does not register. It records metrics
  `declined`, leaves `installId`, `token`, the submissions grant and the `attributed` flag as they are,
  prints `collection: declined metricsMode=disallowed`, exits 0 (2 on a write error). `--json` is
  `{code, message}`. Baseline ref: `src/collection/consent.ts:430-472`.
- **CON-3 [P]** `collection:opt-in` without `--confirm` exits 1 with
  `collection:opt-in requires --confirm`, makes no network call and changes nothing. Argument and
  validation errors (CON-7) are checked first and exit 2.
- **CON-4 [C]** Opt-in asks the server for `usage` plus the three submission scopes when submissions are
  currently granted, and nothing else. `--scopes`, `--consent-version` and `--name` are unknown flags
  (exit 2). The consent version sent is the constant `canonical-2026-09-b`. (D2)
- **CON-5 [C]** Opt-in with no non-empty contact flag is the Anonymous choice. It makes exactly one
  `optIn` request, with `contact: {}`, and stores `attributed: false`, even when contact was on file
  before. (D4)
- **CON-6 [C]** Opt-in with at least one non-empty value among `--first-name`, `--last-name`, `--email`,
  `--mobile` is the Attributed choice. It makes exactly one `optIn` request whose `contact` holds only
  the non-empty keys of `{name, email, sms}` (`name` is first and last name joined by one space, `sms`
  is the mobile), and stores `attributed: true`. A name alone is accepted. (D4, D6)
- **CON-7 [P]** A supplied email that is not `local@domain.tld`-shaped or a supplied mobile that is
  neither E.164 nor a 7-15 digit national number (spaces, dots, dashes and parentheses allowed) exits 2.
  On `collection:identity --update`, validation runs first and nothing is sent. On
  `collection:opt-in --confirm` with contact flags, the baseline may still `register` + `optIn` for
  usage before contact validation fails (exit 2); WP2 [C] paths that send contact (CON-5/CON-6, CNT-3)
  MUST validate before any network call. Baseline ref: `src/collection/contact-identity.ts:20-73`,
  `src/cli/collection-opt-in.ts` (`ensureAttributedOptIn` before identity update).
  Owner amendment 2026-10-05: code wins for the opt-in ordering.
- **CON-8 [P]** Failure handling: register failure exits 1 for `not_registered` and 2 otherwise; a server
  rejection exits 1 with `collection:opt-in rejected -- <code>`; a thrown error exits 2. When the
  response does not include `usage` the verb exits 1 with
  `collection:opt-in rejected -- server did not grant usage scope`, never records usage as granted, and
  rewrites metrics that were active to `revoked`. Baseline ref: `consent.ts:232-302`.
- **CON-9 [P]** Success records decision `active`, the consent version, `decidedAt` and the server's
  `expiresAt`, prints `collection: opted in scopes=[usage] metricsMode=<anonymous|attributed>` and exits
  0. `--json` is `{code, message, metricsMode, scopes}` where `metricsMode` MAY be `null` on the
  baseline (the human message still carries the mode). Owner amendment 2026-10-05: code wins for the
  JSON field.
- **CON-10 [P]** `collection:opt-out` without `--confirm` and without `--identity` exits 1 with
  `collection:opt-out requires --confirm`. With both flags the full opt-out runs.
- **CON-11 [P]** Full opt-out with credentials calls the server first. On rejection it exits 1 with
  `collection:opt-out rejected -- <code>` and changes nothing locally. On success it clears
  `installId` and `token`, records metrics as `revoked`, and prints
  `collection: opted out metricsMode=disallowed (install rotated)`. The lean post-opt-out file shape
  (only a `revoked` metrics record; no `submissions` or `attributed`) is [C] via STO-3 / WP2 — baseline
  may still write `submissions: { granted: false }` and `metricsMode: "disallowed"`.
  Baseline ref: `consent.ts:532-555`. Owner amendment 2026-10-05.
- **CON-12 [P]** After a full opt-out the next opt-in or disclosed feedback registers a new install with
  a different `installId`; the old install stays `revoked` on the server.
- **CON-13 [P]** Full opt-out without credentials produces the same local result with no network call
  and prints `collection: opted out (local only) metricsMode=disallowed`.

## 7. Contact (CNT)

- **CNT-1 [P]** `collection:identity` needs exactly one of `--show`, `--clear`, `--update`, else exit 2
  with `canon: collection-identity: exactly one of --show | --clear | --update is required`. `--help`
  and `-h` exit 0.
- **CNT-2 [C]** `--show` prints `identity=<identified|anonymous>` and nothing else; `--json` is
  `{code, message, mode}`. (D5)
- **CNT-3 [C]** `--update` (D5):
  - no non-empty field, or a value failing CON-7: exit 2, nothing sent;
  - no credentials, or neither metrics active nor submissions granted: exit 1 with a message containing
    `opt in first`, nothing sent, nothing changed;
  - otherwise exactly one `optIn` request with the current scopes and the supplied contact (whole
    replace); on success `attributed: true` and exit 0; on rejection exit 1 and no local change.
- **CNT-4 [C]** `--clear`, and `collection:opt-out --identity` without `--confirm`, are the same
  operation (D5):
  - with credentials and an active track: exactly one `optIn` request with the current scopes and
    `contact: {}`; on success `attributed: false` and exit 0; on rejection exit 1 and no local change;
  - otherwise: `attributed: false`, no network, exit 0;
  - `optOut` is never called; metrics, submissions and `installId` do not change.
- **CNT-5 [P]** Update and clear never print contact values; their `--json` is `{code, message, mode}`.

## 8. Feedback (FB)

- **FB-1 [P]** `feedback` requires `--kind=bug|feature|feedback` (else exit 2). `--help` and `-h` print
  the flag and multiline guidance and exit 0. Baseline ref: `src/cli/feedback.ts:18-48,98`.
- **FB-2 [P]** Each of `--summary-file`, `--message-file`, `--details-file`, `--context-file`,
  `--stack-file`, `--logs-file` reads its file verbatim. An inline flag together with its file flag exits
  2 with `conflict: --X and --X-file both set`. An unreadable file exits 2 with `cannot read --X-file`.
- **FB-3 [P]** Payloads: feedback `{message (trimmed, <=5000), rating?}` with rating an integer 1..5
  (else exit 2) and `--summary` as fallback; bug `{summary (trimmed, <=300), os (default
  "<platform> <release>", <=100), stack? (<=20000), logs? (<=99000)}`; feature `{summary (<=300),
  details? (<=20000), context? (<=200)}`; bug and feature fall back to `--message`. A missing required
  text exits 2. Baseline ref: `src/collection/feedback.ts:46-100`.
- **FB-4 [P]** `--dry-run` exits 0 and returns the payload and scope with no consent check, no disclosure
  check and no network call.
- **FB-5 [P]** Every real submit requires `--disclosure-accepted`, even when submissions are already
  granted. Without it: exit 1, `disclosure_required: true`, and a message that starts
  `feedback: user confirm required` and does not contain the word `ceremony`.
- **FB-6 [C]** That message lists what will be sent without mentioning a correlator. (D3)
- **FB-7 [P]** With `--disclosure-accepted` and no current grant, the client registers if needed and
  makes one `optIn` request for `feedback`, `bug`, `feature`, plus `usage` only when metrics are active,
  with the `contact` key omitted. It records the submissions grant with the server's `expiresAt`. This
  works when metrics are undecided, declined, revoked or expired, and never changes the metrics record.
  Baseline ref: `consent.ts:356-424`.
- **FB-8 [P]** A successful submit exits 0 with `feedback: submitted <kind> id=<id>` (plus
  ` (as-anonymous)` when that flag is set). A server rejection exits 1 with
  `feedback: submit rejected -- <code>`. A thrown error exits 2. `--json` is
  `{code, disclosure_required, dry_run, id, message, payload, scope}`. `--as-anonymous` changes nothing
  on the wire.

## 9. Privacy (PRIV)

- **PRIV-1 [P]** No usage, bug, feature or feedback payload contains any of the keys `email`, `mobile`,
  `sms`, `firstName`, `lastName`, `name`, `contact`, `identity`, or any contact value.
- **PRIV-2 [C]** Contact values appear on the wire only in `contact` of the `optIn` request made by an
  attributed opt-in (CON-6) or a contact update (CNT-3). They never appear on disk, in stdout or in
  stderr. (D4)

## 10. Metrics (MET)

- **MET-1 [P]** No usage event is sent unless metrics are `active`. This holds when submissions are
  granted. An emit without consent makes zero requests. Baseline ref: `src/collection/emit.ts:42-45`.
- **MET-2 [P]** The usage payload is `{metric, value, period?, dimensions?}` on scope `usage`. Dimensions
  whose JSON exceeds 2048 bytes are refused client-side and nothing is sent.
- **MET-3 [P]** `collection:metric`: missing or blank `--metric`, missing or non-numeric `--value`, and
  `--dimensions` that is not a JSON object of string, number or boolean values within 2 KiB all exit 2.
  Everything else exits 0 and prints `collection:metric emitted id=<id>` or
  `collection:metric skipped (<reason>)`. `--json` is `{code: 0, ...outcome}`. `--debug` or
  `CANONICAL_COLLECTION_DEBUG=1` writes the soft-failure detail to stderr.
  Baseline ref: `src/cli/collection-metric.ts`.
- **MET-4 [P]** `--metric=agent_turn` never touches the network; it increments the session counter only
  when metrics are active, exits 0, prints nothing (or `{code: 0, recorded: true}` with `--json`).
- **MET-5 [P]** No session counter is persisted while metrics are not active; no session file is created.
- **MET-6 [P]** `session_summary` without `--dimensions` fills `agent_turns_bucket`
  (`1-5|6-15|16-40|40+`), `scopes_created`, `scopes_completed`, `scopes_cancelled`, `checks_run` and
  `duration_bucket` (`<1|1-4|4-24|24+`, when computable) from the session file, and deletes that file
  only after a successful emit.
- **MET-7 [C]** `session_summary` no longer sends `consent_prompts` (it was always 0; its counter was
  never wired).
- **MET-8 [P]** `xbrief_inventory` is emitted by `orient` at most once per 24 hours. The throttle
  timestamp lives in `.canonical/collection-inventory.json`, survives a session clear, and advances only
  after a successful emit, including one that succeeds after the soft timeout. Its dimensions are integer
  counts for `proposed, pending, active, completed, cancelled, deferred, blocked`.
- **MET-9 [P]** Events and dimensions:

  | Verb (on success) | Metric | Dimensions |
  |---|---|---|
  | `orient` exit 0 | `orient_ok` | none |
  | `scope:new` | `xbrief_scope_created` | `kind, has_acceptance_count, dependency_count`; counts a scope created |
  | `triage` | `xbrief_triage` | `decision, from_status, to_status` |
  | `scope:start` | `xbrief_scope_start` | `kind, acceptance_pending_count` |
  | `scope:complete` | `scope_complete` | `kind, acceptance_total, acceptance_completed, dependency_count, disposition?, had_delivery_pr?, lifetime_hours?`; counts a scope completed |
  | `scope:stop` | `xbrief_scope_stop` | `action`; `cancel` counts a scope cancelled |
  | `scope:defer` | `xbrief_scope_stop` | `{action: "defer"}` |
  | `check` exit 0 / 1 | `check_pass` / `check_fail` | fresh coverage percentages when present; `failed_stage` on fail; counts a check run. Exit 2 emits nothing |
  | `pr:watch` clean | `pr_watch_clean` | none |
  | `pr:finish` merged | `pr_finish_merged` | none |

  Acceptance counts are capped at 5. Coverage dimensions appear only when the coverage file is at least
  as new as the start of the check. Baseline ref: `src/collection/metric-dimensions.ts`,
  `src/check/coverage-summary.ts`.
- **MET-10 [P]** Telemetry never changes a host verb's exit code and never throws or leaves an unhandled
  rejection. A soft emit waits at most 2.5 s. An emit still in flight is awaited before process exit for
  at most 0.5 s beyond its own 2.5 s. No timer is left running when an emit settles early.
  Baseline ref: `src/collection/soft-emit.ts`, `src/cli/bin.ts`, PR #20.
- **MET-11 [P]** Every request carries `x-deft-deployment: canonical:cli:<env>:<version>` and the same
  value as body `deployment_id` where there is a body. The collector host and environment are baked at
  build time and cannot be overridden by environment variables at runtime.
  Baseline ref: `src/collection/client.ts`, `src/build-info.test.ts`.

## 11. Architecture (ARC)

ARC-1 to ARC-6 and ARC-8 MUST be checked by an executable test (`src/collection/architecture.test.ts`);
ARC-7 is checked by the validator. ARC-1 to ARC-6 are [C]: they fail against the baseline.

- **ARC-1** The non-test files in `src/collection/` are exactly `types.ts`, `storage.ts`, `client.ts`,
  `consent.ts`, `feedback.ts`, `emit.ts`, `session-state.ts`, `metric-dimensions.ts`, `index.ts`.
- **ARC-2** The collection CLI is `src/cli/collection.ts` and `src/cli/feedback.ts`. No
  `src/cli/collection-*.ts` file exists. The task names in `tasks/solo.yml` are unchanged.
- **ARC-3** In the non-test files of `src/collection/`, `src/cli/collection.ts` and
  `src/cli/feedback.ts`, each of `createCollector(`, `.optIn(`, `.optOut(`, `.ensureRegistered(` and
  `chmodSync(` appears exactly once, and `.submit(` appears exactly twice (usage in `emit.ts`,
  submissions in `feedback.ts`). None of the first four appears anywhere else under `src/`.
- **ARC-4** Import boundaries inside `src/collection/` ("project file" means a file of this repo, as
  opposed to `node:*` or `@deft/*`):
  - `types.ts` imports nothing;
  - `storage.ts` imports `./types.js` and one project file outside the module,
    `../fs/contained-write.js`;
  - `client.ts` is the only file that imports `../build-info.js` and the only one that reads
    `package.json`;
  - `types.ts`, `storage.ts`, `client.ts` and `consent.ts` (the opt-in service) import nothing from
    `emit.ts`, `session-state.ts`, `metric-dimensions.ts` or `feedback.ts`;
  - `emit.ts` and `session-state.ts` (the metrics service) import from the opt-in service only
    `usageCollector` and `hasUsageConsent` (`session-state.ts` may also import
    `../fs/contained-write.js`);
  - `metric-dimensions.ts` is the only other file that imports a project file from outside
    `src/collection/`.
- **ARC-5** Line budget, counted with `wc -l` over the non-test files of `src/collection/` plus
  `src/cli/collection.ts` and `src/cli/feedback.ts`: at most 1,500 lines (baseline 3,114). The target is
  1,300.
- **ARC-6** No `@deprecated` tag in those files. Every name exported from `src/collection/index.ts` is
  imported by a non-test file outside `src/collection/`.
- **ARC-7** Repo limits from `content/engineering.md` hold: functions of at most 60 lines, cyclomatic
  complexity of at most 10, no `any`.
- **ARC-8** Tests are hermetic: the fake `fetch` throws on a host other than the baked collector URL, and
  no test reads or writes the real home directory.

## 12. Out of scope (file as follow-ups, do not fix here)

1. `deft-collection-endpoint`: erasure (REG-9a, PRIV-5a) is specified and not implemented.
2. `deft-collection-endpoint`: `COLLECTION-CLIENT-PATTERN.md` still tells clients to mint a correlator
   and is silent on local contact storage; it should follow D3 and D4.
3. `deft-collection-endpoint`: stale "erase-on-optout" wording in `docs/EXECUTION.md:31`; misleading
   comment at `packages/server/src/lib/attribution.ts:78`.
4. Canonical: whether D6 warrants a consent-version bump. This work leaves `canonical-2026-09-b` as is.
