# Collection client refactor - IMPLEMENTATION

How the requirements in `REQUIREMENTS.md` are met. Deviations need the orchestrator's sign-off, recorded
in this file as a dated note under the section they change.

This document is also the pattern to lift into Deft Directive: sections 2 to 4 describe two small
services (opt-in, metrics) and one product binding.

## 1. Why the baseline is large

| Cause in the baseline | Replacement |
|---|---|
| One choice modeled as `decision`, `MetricsState`, `MetricsMode` (persisted and derived), `IdentityState`, `SubmissionsState` | One file shape, one `signal()` function |
| Scope union rebuilt at three call sites because the server replaces scopes | One `scopesFor()` used by one `apply()` |
| Six places build a collector inside their own try/catch, each copying a five-field options block | One `collector(root)` and one `guard()` |
| Contact stored locally, merged per field, re-synced | A boolean flag; contact passes through once |
| Machine-level correlator file | Removed |
| `status --live` reconciliation | Removed |
| 120-line legacy migration | A short `normalize()` step |
| Six CLI files repeating parse, json and stream selection | One table-driven module |

## 2. File layout

```
src/collection/
  types.ts              pure data and functions; no imports
  storage.ts            the state file and the SDK credential adapter
  client.ts             product binding and the single Collector factory
  consent.ts            opt-in service
  feedback.ts           submissions
  emit.ts               metrics service: emit, soft emit, drain
  session-state.ts      metrics service: session counters and inventory throttle
  metric-dimensions.ts  Canonical-specific dimension builders
  index.ts              barrel: only names used outside the module
src/cli/
  collection.ts         status, opt-in, decline, opt-out, identity, metric
  feedback.ts
```

Deleted: `src/collection/contact-identity.ts`, `identity.ts`, `soft-emit.ts`;
`src/cli/collection-decline.ts`, `collection-identity.ts`, `collection-metric.ts`,
`collection-opt-in.ts`, `collection-opt-out.ts`, `collection-status.ts`. Old and new MUST NOT coexist in
a commit (`content/engineering.md:35`).

Existing file names are reused on purpose: the forward-coverage gate only fires on added source files, so
the only added source file is `src/cli/collection.ts`, whose same-stem test `src/cli/collection.test.ts`
is written in WP1.

## 3. Opt-in service

### 3.1 `types.ts` (pure)

- `CONSENT_VERSION`, `METRICS_SCOPES = ["usage"]`, `SUBMISSION_SCOPES = ["feedback","bug","feature"]`,
  `COLLECTION_FILE_REL`.
- `CollectionFile` exactly as in STO-3.
- `normalize(raw: unknown): { file: CollectionFile; changed: boolean }` implements STO-4 and STO-5. It is
  the only code that knows older shapes.
- `signal(file, nowMs): ConsentSignal` implements SIG-2 and SIG-3 and returns
  `{metrics, metricsMode, submissions, identity}`. `formatSignal(signal)` renders SIG-1.
- `scopesFor(file, nowMs, want?: {usage?: boolean; submissions?: boolean}): string[]` returns the scope
  set the server should hold: `usage` when metrics are (or are about to be) active, the three submission
  scopes when granted (or about to be). Because of B1 this is the only place that composes scopes.
- `Contact = {firstName?, lastName?, email?, mobile?}`; `parseContact(fields)` trims, drops empties,
  validates per CON-7 and returns `{ok: true, sdk: {name?, email?, sms?}}` or `{ok: false, message}`.
  `sdk` is `{}` when every field is empty.

### 3.2 `storage.ts`

- `readState(root): CollectionFile` reads, runs `normalize`, and rewrites once when `changed`.
- `writeState(root, file)` uses `atomicWriteJson` (`src/fs/contained-write.ts`) then the single
  `chmodSync(0o600)`.
- `updateState(root, fn)` is read, apply, write. Every mutation in the module goes through it.
- `credentialStorage(root): CredentialStorage` maps the SDK's `load / save / clear` onto `installId` and
  `token` through `updateState`, so consent fields survive the SDK's pre-flight probe (STO-5).

### 3.3 `client.ts` (the product binding)

- `collector(root): Collector` is the only `createCollector(` call: `baseUrl` and `environment` from
  `src/build-info.ts`, `product: "canonical"`, `platform: "cli"`, `version` from `package.json`,
  `storage: credentialStorage(root)`, `autoRegister: false`, no `correlator`, default `fetch`.
- No options parameter. Tests replace the global `fetch` (section 6), so production code has no test
  seams.

### 3.4 `consent.ts`

- `Result = { code: 0 | 1 | 2; message: string }`, declared once in `types.ts` (not imported from
  `src/types/gate.ts`, so the service stays free of project imports per ARC-4).
- `guard(label, fn)` runs `fn`, maps a thrown error to `{code: 2, message: "<label> error -- <msg>"}`.
- `apply(root, change)` is the single sync primitive:

  ```ts
  type Change = { usage?: true; submissions?: true; contact?: SdkContact /* {} clears */ };
  ```

  1. `ensureRegistered()` (the only call site); map failure per CON-8.
  2. `scopes = scopesFor(state, now, change)`.
  3. One `optIn({scopes, consentVersion, ...(contact !== undefined ? {contact} : {})})`.
  4. On success, one `updateState`: metrics record when `usage` was asked (fail closed per CON-8 when the
     response lacks `usage`), submissions record when `submissions` was asked, `attributed` set from
     `contact` when it was supplied (`Object.keys(contact).length > 0`).

  Callers, each a few lines:

  | Operation | Change passed |
  |---|---|
  | `optIn(root, contact)` | `{usage: true, contact}` (always supplied: `{}` for Anonymous) |
  | `grantSubmissions(root)` | `{submissions: true}` (contact omitted, so the server keeps it) |
  | `contactUpdate(root, contact)` | `{contact}` after the active-track check (CNT-3) |
  | `contactClear(root)` | `{contact: {}}`, or a local flag reset when nothing is on the server (CNT-4) |

- `decline(root)`: one `updateState`, no network (CON-2).
- `optOut(root)`: server `optOut()` (the only call site) when credentials exist, then `writeState` of the
  bare revoked record (CON-11, CON-13).
- `status(root)`: `signal` plus the derived `scopes`, `consentVersion`, `expiresAt`, `installId` (SIG-4).
- `usageCollector(root): Collector | undefined`: returns a collector only when metrics are active. This
  and `hasUsageConsent(root)` are the whole interface the metrics service sees.

## 4. Metrics service

### 4.1 `emit.ts`

- `emitUsage(root, metric, value, {period?, dimensions?, debug?})`: `usageCollector(root)` or
  `no_consent`; the 2 KiB check; one `submit("usage", payload)`; never throws (MET-1, MET-2).
- `softEmitUsage(root, metric, value?, dimensions?, {onLateEmit?})` and `drainSoftEmits()` keep today's
  timing contract (MET-10) and clear their timers on early settlement.
- `UsageDimensions` type lives here.

### 4.2 `session-state.ts`

- One `bump(root, key)` over a counter table replaces the five `record*` functions; the exported names
  used by other verbs (`recordScopeCreated`, `recordScopeCompleted`, `recordScopeCancelled`,
  `recordCheckRun`, `bumpAgentTurn`) become one-line bindings or the call sites switch to
  `bump(root, "scopesCreated")`. Implementor's choice; fewer lines wins.
- Counters are written only when `hasUsageConsent(root)` (MET-5).
- `buildSessionSummaryDimensions`, `clearSession`, `shouldEmitInventory`, `markInventoryEmitted` keep
  their behavior (MET-6, MET-8), without `consent_prompts` (MET-7).

### 4.3 `metric-dimensions.ts`

Product-specific: it reads xbrief scope documents. Keep the functions and their outputs (MET-9). It is
not part of the extractable pattern.

## 5. Feedback and CLI

### 5.1 `feedback.ts`

- A per-kind payload table (required text, fallbacks, optional fields and limits) replaces the three
  hand-written branches (FB-3).
- `submitFeedback(root, opts)`: build payload, dry-run return, disclosure check, `grantSubmissions` when
  not granted, one `submit(kind, payload)` (FB-4 to FB-8).

### 5.2 `src/cli/collection.ts`

- One table: action name to `{valueFlags, boolFlags, run(parsed, root)}` for `status`, `opt-in`,
  `decline`, `opt-out`, `identity`, `metric`.
- One `out(json, code, payload, text)` helper: `renderJson` to stdout with `--json`; otherwise text to
  stdout on 0 and stderr on anything else. `identity --show` and `metric` keep their existing stream
  rules (always stdout).
- Parse errors keep the `canon: collection-<action>: <error>` prefix.

### 5.3 `src/cli/dispatch.ts`

`collection:<action>` and `collection <action>` both resolve to the `collection` module with the action
as the first argument. `VERB_ALIASES` and `CLI_MODULE_VERBS` shrink accordingly; `--help` output still
lists the six verbs. `src/cli/dispatch.test.ts` is updated by QA.

### 5.4 Call sites in other verbs

`orient`, `check`, `scope-*`, `triage`, `pr-watch`, `pr-finish` and `bin.ts` import only from
`src/collection/index.ts`. `src/orient/index.ts` uses `readState` + `signal` + `formatSignal`.
`src/check/coverage-summary.ts` imports the `UsageDimensions` type from the barrel.

## 6. Test design

Tests are integration-level by default: a CLI call in, three observations out (process result, file on
disk, what the server saw).

- **`src/test-support/collector.ts`** (QA-owned, with `collector.test.ts`): `fakeCollector()` returns
  `{ fetch, installs, requests, advance(ms), failNext(route, code) }`.
  - Routes: register, optin, optout, status, challenge, submissions.
  - Enforces B1 to B8: scope replace; contact keep / clear / replace; `revoked` terminal;
    `not_opted_in`, `scope_not_consented`, `optin_expired`; bearer token check; `correlator_mismatch`;
    payload validation with the real schemas from `@deft/schemas`.
  - Throws on any URL outside the baked collector base URL (ARC-8).
  - `requests` records method, path, headers and parsed body for wire assertions.
- **`canon(argv, {cwd})`** in `src/test-support/`: calls `dispatch(argv)`, then `drainSoftEmits()`,
  captures stdout and stderr, returns `{code, out, err}`.
- **Setup helper**: temp project (`tempGitRepo`), `vi.stubGlobal("fetch", fake.fetch)`, and for WP1 only
  `vi.stubEnv("HOME", tmp)` / `USERPROFILE` so the baseline correlator code cannot touch the real home.
- **Fake time** for expiry and the soft-emit timers; no sleeps.
- **Unit tests** only where a table is the clearest spec: `types.test.ts` (normalize and signal tables),
  `metric-dimensions.test.ts` (buckets).
- **`src/collection/architecture.test.ts`** reads the source tree and asserts ARC-1 to ARC-6 and ARC-8.
- **`src/cli/collection.test.ts`** also holds the docs-vs-CLI test (FLOW-5): it extracts every
  `collection:*` / `feedback` invocation from `content/*.md` and checks each flag against the CLI tables.

Suggested test files after the refactor (same-stem where a source file exists):
`types.test.ts`, `storage.test.ts`, `consent.test.ts` (opt-in, decline, opt-out, contact flows),
`feedback.test.ts`, `emit.test.ts` (emit, soft emit, drain), `session-state.test.ts`,
`metric-dimensions.test.ts`, `architecture.test.ts`, `src/cli/collection.test.ts`,
`src/cli/feedback.test.ts`, plus the existing verb tests that assert MET-9 payloads through the fake.

## 7. Extraction notes for Deft Directive

- Copy unchanged: `types.ts`, `storage.ts`, `consent.ts`, `emit.ts`, `session-state.ts`, and the fake
  collector.
- Rewrite per product: `client.ts` (product name, platform, baked URL, state-file path, consent version)
  and the dimension builders.
- The only outside dependency of the copied files is an atomic JSON write.
