# Engineering

Load before implementing, debugging, or claiming any work complete.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

## Quality Gate

- ! `task check` before every commit and before opening a PR — if not installed, run the repo's documented format/lint/build/test commands and say the gate is not installed.
- ! Coverage floor when coverage tooling exists: ≥85% on lines, functions, branches, and statements, overall and per module, with thresholds in tool config (`fail_under`, vitest `thresholds`) — never as convention. Exclude only entry points, generated code, and tests; thin display/event-loop shims may be excluded but must stay thin.
- ! New or modified behavior gets tests in the same commit that would fail if it regressed (`task verify:forward-coverage` enforces new-source→new-test at the diff level when installed).
- ! Prove new tests can fail: run them against the pre-change code — write the test first, or stash/revert the change — and see red before the implementation turns them green. A test never seen failing proves nothing about regressions.
- ! Before implementing, confirm the toolchain exists (task runner, runtime, required SDKs). Missing → stop and report. ⊗ Implement partially while skipping gates because tooling is absent.
- ! A build that exits 0 but emits stale or incomplete artifacts is a FAILED build — verify non-compiled outputs (manifests, configs, bundled assets) exist and parse.

## Completion Discipline

- ! Before marking anything done, stub-scan your own diff: `TODO`/`FIXME`/`HACK`, hardcoded returns, empty handlers. Existence is not integration — verify new exports are *imported and used*, new routes have a real consumer, protected paths actually check auth.
- ! Verify at the strongest reachable tier, in order: (1) static — files/exports exist, no stubs (always required); (2) command — tests/build pass; (3) behavioral — exercise via CLI/HTTP/browser; (4) human. ⊗ Ask a human to verify what a command can verify.
- ~ On feature completion, write a user-acceptance script in `docs/uat/`: copy-pasteable steps, exact observable outcomes, no implementation detail.
- ! "Production-ready" / "feature-complete" claims name what remains open, or state explicitly that nothing does.
- ~ Prefer small reversible diffs scoped to the active scope's `file_scope` when set.

## Debugging — Iron Law

- ! No fix without a root cause. Reproduce the failure consistently before proposing any change.
- ! After 3 failed distinct fix attempts, STOP and escalate for design review. ⊗ Attempt a fourth.
- ! Prove runtime values from the runtime (env dump, log line, debugger) — never infer them from source. ⊗ Present a timing, ordering, or exit status as a root cause; name the mechanism.
- ~ When the root cause was reached by inference rather than observation, record the observability gap: what log or metric would have shown it directly.

## Code Evolution

- ! When two existing patterns conflict, pick ONE (prefer the newer or better-tested), state the choice where you make it, and mark the loser deprecated with a tracked issue. ⊗ Write compromise code satisfying both.
- ~ Prefer boring, recognized solutions — standard library, well-known patterns and algorithms — over novel abstractions. A new pattern enters a module only via the conflict rule above: pick one, deprecate the loser. ≉ Invent a bespoke pattern where an established one fits.
- ! When replacing an implementation, delete the old one in the same commit. ⊗ Leave parallel old/new paths, permanently-on/off flags, or compatibility shims past their stated removal point.
- ⊗ Suppress or bypass a failing gate to make progress (`|| true`, skipping hooks, deleting a failing test). Fix or escalate.

## Security Floor

External canon, linked not restated: OWASP ASVS is the reference standard; the [OWASP Cheatsheet Series](https://cheatsheetseries.owasp.org/) is the per-topic how-to.

- ⊗ Hand-roll security primitives — session management, password hashing, token generation, crypto, CSRF defense. Use the framework or platform primitive; if none exists, stop and escalate rather than improvise.
- ! Code touching authentication, authorization, session handling, or money is checked against the relevant OWASP cheatsheet before scope completion. Auth checks cover EVERY path to a protected resource, not the happy path — build it in; the completion stub-scan is a backstop, not the plan.
- ! Treat all external input as hostile until validated at the trust boundary: parameterized queries only, output encoding matched to the sink, allowlists over denylists.
- ~ Wire security scanners the project has (SAST, dependency audit, secret scan) into `xbrief/PROJECT.xbrief.json` `plan["x-canonical/quality"].commands[]` — they then gate `task check` like any other stage. Security findings are P0 in review.

## Cross-Language Floor

Per-language idiom is assumed; only this floor is stated.

- ! Strictest practical typing mode (`mypy --strict`, TS `strict: true`, equivalents). Every escape hatch (`# type: ignore`, `@ts-ignore`, `as any`, bare `interface{}`) carries an inline justification or does not merge.
- ! Warnings are errors under the strictest static analysis the toolchain offers.
- ~ Functions ≤60 lines, cyclomatic complexity ≤10; prefer iteration with explicit bounds over recursion.
- ~ Comments state constraints and why — invariants, tradeoffs, footguns — never restate what the code does; public APIs get doc comments per language convention. ≉ Narrate implementation line-by-line.
- ~ Fresh-start stacks: Python 3.11+ / pytest / mypy-strict; TypeScript strict / Vitest; Go / testify. Data-validating models are frozen/strict wherever concurrency is involved.
- ~ CLIs: individual mutually-exclusive output flags (`--json`, `--tree`) over `--format=`; provide `--ai-help` with machine-oriented detail alongside `--help`.
- ! Detect OS and shell before composing commands; ⊗ assume bash from the OS name.
