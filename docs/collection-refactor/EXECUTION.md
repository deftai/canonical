# Collection client refactor - EXECUTION

Orchestration for the work specified in `REQUIREMENTS.md` and designed in `IMPLEMENTATION.md`, both in
this directory. You, the reader, are the **orchestrator**. You dispatch three subagents defined in
`.grok/agents/`: `qa-engineer`, `implementor`, `validator`. You do not write tests or production code
yourself.

## 1. Binding rules

From this repository's pack (`content/canonical.md`, `engineering.md`, `scm.md`, `state.md`):

1. Work on branch `refactor/collection-tighten`. Never commit to `main`.
2. Production code needs a running xbrief scope: create it with `task scope:new`, start it with
   `task scope:start`, complete it with `task scope:complete`. One scope item per work package.
3. `task check` MUST pass before every commit. Never commit a red suite; never skip or bypass a gate.
4. Conventional Commit messages: `refactor(collection): WP<n> <summary>`. Stage by explicit path.
5. A newly added source file needs a same-stem test staged in the same commit
   (`task verify:forward-coverage`). When an implementation is replaced, the old one is deleted in the
   same commit.
6. A defect found outside the active work package is filed as an issue, not fixed in place.
7. No backend or SDK change. Nothing under `vendor/` is edited.

For this work:

8. **Ownership.** `qa-engineer` writes only `src/**/*.test.ts` and `src/test-support/**`. `implementor`
   writes only non-test files: `src/**`, `tasks/**`, `Taskfile.yml`, `content/**`, `docs/**` (except this
   directory), `CHANGELOG.md`. `validator` writes nothing in the working tree.
9. **Tests cite requirements.** Every test name starts with the REQ ID it proves:
   `it("CON-5: anonymous opt-in sends an empty contact and clears the flag", ...)`. No `.skip`, no
   `.only`.
10. **The customer flow is frozen.** `content/feedback.md` lines 13-56 are not edited (FLOW-1).
11. **Escalate, do not guess.** A [P] requirement that the baseline code contradicts, a requirement that
    is ambiguous, or a test the implementor believes is wrong goes to the owner with the REQ ID and
    evidence. Loop cap: 3 per work package, then escalate.

## 2. Gate loop

```
G1 RED    qa-engineer writes tests for the WP's REQ IDs.
          Orchestrator runs `pnpm run test:fast`:
            - tests for [C] requirements MUST fail;
            - every other test MUST pass.
          Orchestrator records the test manifest (no commit, because rule 3 forbids a red commit):
            git ls-files -co --exclude-standard 'src/**/*.test.ts' 'src/test-support/**' \
              | xargs shasum -a 256 > "$SCRATCH/wp<n>-g1.sha256"
G2 GREEN  implementor writes code until `pnpm run test:fast`, `pnpm run lint` and `pnpm run build`
          pass. Test files MUST still match the manifest.
G3 VALID  validator returns the verdict JSON below.
          PASS -> orchestrator runs `task check`, then makes ONE commit for the WP containing the
                  tests and the code.
          RETURN_TO_IMPLEMENTOR / RETURN_TO_QA -> re-dispatch with the verdict attached.
          ESCALATE -> stop and ask the owner.
```

`$SCRATCH` is a directory outside the repository.

Verdict JSON (the validator's entire final message):

```json
{
  "wp": "WP2",
  "verdict": "PASS | RETURN_TO_IMPLEMENTOR | RETURN_TO_QA | ESCALATE",
  "suite": {"passed": 0, "failed": 0, "skipped": 0},
  "req_coverage": {"covered": ["CON-5"], "missing": []},
  "test_integrity": {"tests_modified_since_red": false, "skips_found": false},
  "diff_scope_ok": true,
  "architecture_notes": [],
  "reasons": ["one line per finding driving the verdict"]
}
```

Verdict rules: `missing` not empty -> RETURN_TO_QA. Red suite, ownership violation, manifest mismatch or
architecture violation -> RETURN_TO_IMPLEMENTOR. A test that contradicts REQUIREMENTS.md, or a
requirement that contradicts the baseline -> ESCALATE. Otherwise PASS.

## 3. Work packages

| WP | Scope | REQ IDs | Read for the brief | Test boundary |
|---|---|---|---|---|
| **WP0** | Setup. Confirm PR #20 is merged and rebase onto `main`; `task setup`; create and start the xbrief scope; `task check` green; record baseline `wc -l` for the ARC-5 file set. | none | this file | none (orchestrator only) |
| **WP1** | Test harness and characterization of the baseline. Fake collector, `canon()` runner, and a test for every [P] requirement. | FLOW-6; STO-1, STO-5; SIG-1, SIG-2, SIG-4; CON-1, CON-2, CON-3, CON-7 to CON-13; CNT-1, CNT-5; FB-1 to FB-5, FB-7, FB-8; PRIV-1; MET-1 to MET-6, MET-8 to MET-11; ARC-8 | REQ sections 0, 2-10; IMPL section 6 | CLI through `dispatch`; disk; fake server |
| **WP2** | Opt-in service, contact, feedback, CLI module, dispatch. Removes the correlator, local contact, `--live` and the D2 flags. | STO-2, STO-3, STO-4; SIG-3, SIG-5; CON-4, CON-5, CON-6; CNT-2, CNT-3, CNT-4; FB-6; PRIV-2; ARC-2, ARC-3, ARC-4 (opt-in service bullets), ARC-6, ARC-7 | REQ sections 1-9, 11; IMPL sections 2, 3, 5, 6 | same as WP1, plus `architecture.test.ts` |
| **WP3** | Metrics service: `soft-emit.ts` folded into `emit.ts`, table-driven session counters, call sites import from the barrel. | MET-7; ARC-1, ARC-4 (metrics service bullets), ARC-5; MET-10 re-proved | REQ sections 10, 11; IMPL sections 4, 5.4 | same |
| **WP4** | Guidance and docs. | FLOW-1 to FLOW-5, FLOW-7 | REQ section 3; `content/feedback.md`; `content/canonical-tasks.md:105-172` | docs-vs-CLI test; section diff |
| **WP5** | Final validation and delivery. | all | all | whole suite, `task check` |

### 3.1 WP1 is different: green first

WP1 has no implementor step, and its G1 is inverted: **every WP1 test MUST pass against the baseline
code.** These tests pin today's behavior before anything moves.

- The qa-engineer writes the harness (IMPL section 6) and the [P] tests through the CLI boundary only, so
  they survive the rewrite. Tests MUST NOT import from `src/collection/*.ts` files that IMPL section 2
  deletes, and SHOULD NOT import collection internals at all.
- Baseline code still reads `~/.config/canonical/identity.json`; the harness stubs `HOME` and
  `USERPROFILE` to a temp directory so the real home is never touched (ARC-8).
- A [P] test that cannot be made to pass on the baseline means the requirement and the code disagree:
  ESCALATE (rule 11). Do not bend the test.
- Legacy test files stay in place during WP1.
- G3 for WP1 adds a **mutation proof**. In a throwaway worktree (`git worktree add "$SCRATCH/mut" HEAD`)
  the validator applies each mutation below, runs the suite, and requires at least one WP1 test to fail:

  | Mutation in baseline code | Must break |
  |---|---|
  | `emit.ts`: skip the `hasUsageConsent` check | MET-1 |
  | `consent.ts` `collectionOptIn`: treat missing `usage` in the response as granted | CON-8 |
  | `consent.ts` `collectionOptOut`: keep `installId` and `token` after success | CON-11, CON-12 |
  | `consent.ts` `collectionDecline`: call the collector | CON-2 |
  | `feedback.ts`: do not require `disclosureAccepted` when a grant exists | FB-5 |
  | `consent.ts` `grantSubmissions`: always add `usage` | FB-7 |
  | `feedback.ts`: add `email` to a payload | PRIV-1 |
  | `session-state.ts` `mutateSession`: drop the consent check | MET-5 |
  | `cli/orient.ts`: mark inventory emitted before the emit | MET-8 |
  | `storage.ts` `metricsStateFromMirror`: ignore `expiresAt` | SIG-2, MET-1 |
  | `soft-emit.ts`: raise `SOFT_EMIT_TIMEOUT_MS` to 60 s | MET-10 |

- WP1 commit: tests and test-support only.

### 3.2 WP2 notes

- G1: the qa-engineer adds red tests for the WP2 [C] requirements and `architecture.test.ts`. A WP1
  assertion that a decision in REQ section 1 supersedes (for example a `HOME` stub that is no longer
  needed, or `live_state` in the status JSON) is updated and listed in the QA report with the decision
  ID. The qa-engineer deletes each legacy test file whose requirements are now covered and reports the
  mapping "legacy test -> REQ ID". Legacy files to retire in WP2: `consent.test.ts`,
  `consent-split.test.ts`, `contact-identity.test.ts`, `metrics-mode.test.ts`, `identity.test.ts`,
  `client.test.ts`, `storage.test.ts`, `feedback.test.ts` (collection and cli),
  `collection-opt-in.test.ts` (their replacements may reuse the file names).
- G2: the implementor follows IMPL sections 2, 3 and 5. `tasks/solo.yml` task names do not change.
- `architecture.test.ts` in WP2 asserts only the WP2 ARC requirements. The file list (ARC-1), the metrics
  import boundary and the line budget (ARC-5) cannot hold until `soft-emit.ts` is folded in, so the
  qa-engineer adds those assertions at WP3 G1, where they start red.
- ARC-7 has no test; the validator checks it by reading the changed functions and from `pnpm run lint`.

### 3.3 WP3 notes

- G1: MET-7 red test; ARC-1, ARC-5 and the metrics-service bullets of ARC-4 added to
  `architecture.test.ts`; legacy tests retired: `emit.test.ts`,
  `soft-emit.test.ts`, `session-state.test.ts`, `metrics-enrichment.test.ts`,
  `collection-metric.test.ts`, `orient-inventory.test.ts` and the spy-based case in
  `scope-defer.test.ts`, each replaced by a fake-server test of the same requirement.
- G2: IMPL section 4. Every MET-9 payload stays byte-identical apart from MET-7.

### 3.4 WP4 notes

- G1: the docs-vs-CLI test (FLOW-5) and a test that `content/feedback.md` has at most 118 lines and
  contains none of `--live`, `--scopes`, `--consent-version`, `correlator`, `userKey`.
- G2: the implementor edits `content/feedback.md` (header and "Agent actions" only),
  `content/canonical-tasks.md`, `docs/manual-test-plan.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`.
- G3: the validator runs
  `diff <(git show main:content/feedback.md | sed -n '13,56p') <(sed -n '/^## User dialogue/,/^## Agent actions/p' content/feedback.md | sed '$d')`
  adjusted so both sides cover the same section, and requires no difference (FLOW-1).

### 3.5 WP5 notes

- The validator audits the whole requirement list against the final tree and reports the ARC-5 line
  count next to the baseline from WP0.
- The orchestrator runs `task check` and `task verify:forward-coverage`, completes the xbrief scope, and
  opens the PR through the repo flow (`content/scm.md`).
- **Owner step before merge:** `docs/manual-test-plan.md` Phase 8 against staging: anonymous opt-in,
  attributed opt-in, feedback while metrics are disallowed, opt-out followed by a new opt-in. In
  `deft-collection-endpoint`, `pnpm dump:install` shows the first install as opted out and a different
  `install_id` for the second.
- File the follow-ups in REQ section 12.

## 4. Briefing template

```
WP: <id>            Gate: <G1 | G2 | G3>           Role: <qa-engineer | implementor | validator>
REQ IDs: <list from section 3>
Read: docs/collection-refactor/REQUIREMENTS.md sections <...>; IMPLEMENTATION.md sections <...>
Interface contract: CLI via dispatch(argv); state file .canonical/collection.json; fake collector
  (src/test-support/collector.ts) as the server.
Prior verdict: <verdict JSON, or "none">
Manifest: <path to $SCRATCH/wp<n>-g1.sha256, for G2 and G3>
Report back: <the role's report format>
```

## 5. Commands

| Purpose | Command |
|---|---|
| Suite | `pnpm run test:fast` |
| One file | `pnpm exec vitest run <path>` |
| Lint | `pnpm run lint` |
| Type check and build | `pnpm run build` (tests are excluded from `tsc`; keep them type-correct by hand) |
| Full gate | `task check` |
| Added-file gate | `task verify:forward-coverage` |
| Line budget | `ls src/collection/*.ts src/cli/collection.ts src/cli/feedback.ts \| grep -v '\.test\.ts$' \| xargs wc -l \| tail -1` |
