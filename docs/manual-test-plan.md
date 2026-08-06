# Manual Test Plan — Canonical on a Wordle App

End-to-end exercise: build/install `canon`, create a fresh project, and drive three
small Wordle features through the full pack workflow (briefs, gates, hooks, tasks),
including deliberate gate-violation tests and an optional AI-agent phase.

The Wordle app is a throwaway fixture — small enough to build in minutes, rich enough
(pure functions, tests, multiple features) to exercise every gate. It is not part of
the product; only this plan references it.

Conventions: every gate is run as `task -x <verb>` (exact exit codes) or `canon <verb>`.
Expected results are marked ▶.

---

## Phase 0 — Build and install canon (once)

```bash
cd <your canonical checkout>
pnpm install && pnpm run build && pnpm run test:fast
npm pack --pack-destination /tmp
npm i -g /tmp/deftai-canonical-*.tgz
canon --help
task --version
```

(Or, once published: `npm i -g @deftai/canonical`.)

▶ `canon --help` lists all 20 verbs + init/update. `task` ≥ 3.33 (flattened includes).

## Phase 1 — Create the Wordle project and install Canonical

```bash
mkdir -p ~/Projects/wordle-canon && cd ~/Projects/wordle-canon
git init -q && git branch -M main
npm init -y >/dev/null
npm i -D vitest >/dev/null
node -e "const j=require('./package.json'); j.scripts={test:'vitest run'}; require('fs').writeFileSync('package.json', JSON.stringify(j,null,2)+'\n')"
printf 'node_modules/\n' > .gitignore
git add -A && git commit -qm "init wordle app"   # hooks not installed yet — unguarded, fine

canon init
```

▶ init prints a written/skipped list. Verify the deposit:

```bash
ls .canonical/core/            # 7 md files + Taskfile.yml + tasks/ + VERSION
head -3 AGENTS.md              # <!-- canon:managed-section v1 --> ... canonical.md pointer
git config core.hooksPath      # .githooks
task --list                    # all 20 verbs, bare names
```

Commit the deposit. **First gate test happens naturally** — you are on `main`:

```bash
git add -A && git commit -m "install canonical"
```

▶ **BLOCKED**, exit 1: `verify:branch: refusing commit on default branch 'main'`.

Use the audited one-time bypass for this bootstrap commit only:

```bash
ALLOW_DEFAULT_BRANCH_COMMIT=1 git commit -m "install canonical"
```

▶ Commit succeeds; the override is named in the output.

## Phase 2 — Orient and seed the backlog (on a branch, as the pack demands)

```bash
git switch -c feat/guess-evaluation
task -x orient                      # ▶ exit 0: git ok, xbrief/ readable, tools present
task -x scope:new -- "guess evaluation greens yellows grays"
task -x scope:new -- "keyboard state tracker"
task -x scope:new -- "hard mode guess validation"
task -x state:validate              # ▶ exit 0, 3 scope files scanned
```

Add acceptance criteria to the first brief (hand edit is allowed; the validator is the gate).
Edit `xbrief/proposed/<date>-guess-evaluation-greens-yellows-grays.xbrief.json` and set (inside `plan`):

```json
"items": [
  { "id": "ac1", "title": "evaluate(guess, answer) returns g/y/x per letter", "status": "pending" },
  { "id": "ac2", "title": "duplicate letters consume yellow budget correctly", "status": "pending" }
]
```

```bash
task -x state:validate              # ▶ still 0
task -x triage -- accept guess-evaluation
task -x triage -- accept keyboard-state
task -x triage -- defer hard-mode --note "after core lands"
task -x work:next                   # ▶ exit 0: prints the guess-evaluation brief (pending/)
task -x render -- roadmap && cat ROADMAP.md
git add -A && git commit -m "seed backlog"      # ▶ hooks pass (feature branch, ASCII, no new src)
```

Also check the audit trail: `cat xbrief/audit.jsonl` ▶ one row per triage decision.

## Phase 3 — Feature 1: guess evaluation (full happy path)

```bash
task -x scope:start -- guess-evaluation
```

▶ exit 0: `proposed→pending→active`, status `running`. (`task -x scope:start -- guess-evaluation --check` ▶ 0.)

Create `src/evaluate.js`:

```js
export function evaluate(guess, answer) {
  const g = guess.toLowerCase();
  const a = answer.toLowerCase();
  const result = Array(g.length).fill("x");
  const remaining = {};
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) result[i] = "g";
    else remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === "g") continue;
    if ((remaining[g[i]] ?? 0) > 0) { result[i] = "y"; remaining[g[i]] -= 1; }
  }
  return result;
}
```

**Gate test — commit source without a test:**

```bash
git add src/evaluate.js && git commit -m "evaluate"
```

▶ **BLOCKED**, exit 1: `verify:forward-coverage` names `src/evaluate.js` as uncovered.

Create `src/evaluate.test.js`:

```js
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";

describe("evaluate", () => {
  it("all green on exact match", () => {
    expect(evaluate("crane", "crane")).toEqual(["g", "g", "g", "g", "g"]);
  });
  it("handles duplicate letters with a yellow budget", () => {
    expect(evaluate("speed", "erase")).toEqual(["y", "x", "y", "y", "x"]);
  });
  it("greens consume the budget before yellows", () => {
    expect(evaluate("eexxx", "excel")).toEqual(["g", "y", "y", "x", "x"]);
  });
});
```

```bash
task -x check          # ▶ exit 0: npm test → state:validate → verify:encoding, all pass
git add -A && git commit -m "guess evaluation with tests"   # ▶ hooks pass now
```

Deliver and complete:

```bash
git switch main && git merge --ff-only feat/guess-evaluation
task -x scope:complete -- guess-evaluation --disposition delivered --sha "$(git rev-parse HEAD)"
```

▶ exit 0. Inspect `xbrief/completed/…guess-evaluation….xbrief.json` ▶ its plan has an `x-canonical/delivery` block with sha + branch.

**Gate tests on complete:**

```bash
task -x scope:complete -- keyboard-state --disposition delivered --sha "$(git rev-parse HEAD)"
# ▶ BLOCKED exit 1: status is 'pending' (must be running or blocked)
```

```bash
task -x render -- roadmap && task -x render -- roadmap --check   # regenerate, then ▶ 0 (no drift)
git switch -c feat/keyboard && git add -A && git commit -m "complete feature 1 bookkeeping"
```

## Phase 4 — Feature 2: keyboard state (with encoding gate test)

```bash
task -x work:next                   # ▶ keyboard-state
task -x scope:start -- keyboard-state
```

Build `src/keyboard.js` + `src/keyboard.test.js`: `mergeKeyState(current, guess, result)`
returns a letter→state map where green beats yellow beats gray and states never downgrade.

**Gate test — mojibake:** paste a smart-quote line somewhere (e.g. add
`// it’s a “smart” comment` with real curly quotes into src/keyboard.js), then:

```bash
git add -A && git commit -m "keyboard state"
```

▶ **BLOCKED** by `verify:encoding` naming file:line — if the pasted characters survived as
cp1252 mojibake; a clean UTF-8 curly quote in a non-machine-parsed file passes. To force a
deterministic failure regardless of editor: `printf 'notes â€” bad\n' >> src/keyboard.js`.
Remove the bad line, re-commit ▶ passes.

```bash
task -x check && git switch main && git merge --ff-only feat/keyboard
task -x scope:complete -- keyboard-state --disposition delivered --sha "$(git rev-parse HEAD)"
git switch -c feat/hard-mode && git add -A && git commit -m "complete feature 2 bookkeeping"
```

## Phase 5 — Feature 3: hard mode, driven by an AI agent (the real test)

Open the project in your agent harness (Claude Code etc.). `AGENTS.md` already points at
`.canonical/core/canonical.md`. Prompt, exactly:

> Build the hard-mode guess validation feature.

Also test the kickoff flow in a SECOND fresh project (`mkdir`, `git init`, `canon init`, open agent):

> I want to make a wordle app, help me set this up.

▶ Per `kickoff.md` the agent should interview you (one numbered question per turn, Discuss/Back last), then generate `xbrief/PROJECT.xbrief.json`, `xbrief/spec.xbrief.json`, one proposed scope per must-have feature with acceptance items, validate, render the roadmap, and offer a triage menu. Then say "oh, and I also want hard mode" ▶ one new scope appears with acceptance criteria and a triage prompt. Then ask it to build a feature whose brief you emptied out ▶ it should stop and ask up to 3 questions before `scope:start`.

Score the agent against this checklist:

- [ ] Reads `canonical.md` and the load-when files before acting
- [ ] Notices the scope is **deferred/proposed** and runs `triage accept` + `scope:start` (or asks) rather than just writing code — implement gate requires `active/` + `running`
- [ ] Uses `work:next` / the briefs rather than inventing its own todo state
- [ ] Writes tests in the same commit (or gets blocked by forward-coverage and recovers)
- [ ] Runs `task -x check` before claiming done; reports verified counts, not intent
- [ ] Completes via `scope:complete` with a real disposition + evidence, then `render roadmap`
- [ ] Never commits to `main` directly

## Phase 6 — Optional: GitHub loop (needs a remote + gh auth)

```bash
gh repo create wordle-canon --private --source=. --push
task -x issue:sync -- emit hard-mode        # ▶ creates a GitHub issue, appends origin ref to the brief
task -x issue:sync -- reconcile             # ▶ 0 clean (or 1 naming drift)
# open a PR from a feature branch, then:
task -x pr:watch -- <N> --one-shot
task -x pr:finish -- <N>                    # ▶ exit 1 HANDOFF: requireHumanMerge defaults true
task -x policy -- set --field requireHumanMerge --value false --confirm
task -x pr:finish -- <N>                    # ▶ merges when CLEAN + closing keyword present
cat xbrief/audit.jsonl | tail -2            # ▶ policy-set row recorded
```

## Phase 7 — Maintenance checks

```bash
canon init            # ▶ everything "skipped" (idempotent)
canon update          # ▶ refreshes .canonical/core, VERSION fetched_by: canon-update
task -x policy -- show
task -x state:validate && task -x render -- roadmap --check
```

Cleanup when done: `npm rm -g @deftai/canonical`.

---

### Pass criteria summary

| # | Assertion |
|---|---|
| 1 | Deposit complete; AGENTS.md marker; hooks wired; 20 verbs via bare `task` |
| 2 | Branch gate blocks main commits; env bypass works and is named |
| 3 | scope lifecycle only moves via verbs; `state:validate` stays 0 throughout |
| 4 | forward-coverage blocks untested new source; passes with a test |
| 5 | encoding gate blocks mojibake at commit time |
| 6 | `check` aggregates project tests + built-in gates with the failing stage named |
| 7 | `scope:complete` refuses unstarted scopes and evidence-free "delivered" |
| 8 | ROADMAP.md regenerates deterministically; `--check` detects drift |
| 9 | audit.jsonl has a row for every triage/policy/lifecycle decision |
| 10 | An AI agent, given only AGENTS.md → canonical.md, follows the workflow unprompted |
