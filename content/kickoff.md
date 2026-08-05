# Kickoff & Refinement

Load when: the user describes a new app or feature they want built, asks to "set this up" or "spec this out", or a scope you are about to start lacks clear acceptance criteria.

Legend: `!` MUST · `~` SHOULD · `≉` SHOULD NOT · `⊗` MUST NOT · `?` MAY

## New App ("I want to make an app that does X, help me set this up")

- ! Interview BEFORE writing any code or briefs. One question per turn, numbered options with a recommended pick marked, `Discuss` and `Back` as the final two options (canonical.md menu contract). Cover, in order:
  1. What the app does, in one sentence (confirm your restatement).
  2. Who uses it and where it runs (CLI / web / mobile / library).
  3. The 3–6 must-have features for a first working version.
  4. Explicit non-goals (what v1 will NOT do).
  5. Stack (offer a recommended default for their platform; accept "you pick").
- ! Then generate the state, without further prompting:
  1. `xbrief/PROJECT.json` — title, a `narratives.Description` one-paragraph gestalt, and `quality.commands` for the chosen stack.
  2. `xbrief/spec.json` — narratives `Problem`, `Users`, `NonGoals`; `items` = the must-have list.
  3. One scope per must-have feature: `task scope:new -- "<feature>"`, then edit each brief to fill `narratives.Description` and 2–5 observable acceptance `items` derived from the interview.
  4. `task -x state:validate` (must exit 0), then `task -x render -- roadmap`.
- ! Finish with a short summary and a numbered menu: (1) accept all into pending, (2) review scopes one by one, (3) add/remove a feature, then `Discuss`, `Back`. On accept, use `task triage -- accept <scope>` per scope.
- ⊗ Skip the interview because the request seems clear — confirm the one-sentence restatement at minimum.

## New Feature ("oh, and I also want Z")

- ! `task scope:new -- "<feature>"`, fill `narratives.Description` and 2–5 acceptance `items`, `task -x state:validate`, then present the triage menu (accept into pending now, or leave proposed).
- ~ Ask clarifying questions (max 3) ONLY when you cannot write observable acceptance criteria from what the user said; otherwise write your best criteria and show them for confirmation.

## Underspecified Scope at Start Time

- ! Before `scope:start` on any scope with fewer than 2 acceptance items or an empty `Description`: stop, run a mini-interview (max 3 questions, numbered options), update the brief, `task -x state:validate`, THEN start.
- ⊗ Begin implementing a scope whose acceptance you could not state as observable outcomes.
- ~ While implementing, flip each acceptance item's `done` to `true` as it is verifiably satisfied; all items `done` before `scope:complete`.
