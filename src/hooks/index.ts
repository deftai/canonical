import { chmodSync } from "node:fs";
import { atomicWriteText } from "../fs/contained-write.js";
import { type GitRunner, setConfig } from "../git/index.js";

/**
 * `setup` (content/canonical-tasks.md): deposit .githooks/pre-commit and
 * .githooks/pre-push, chmod them executable, and point core.hooksPath at
 * .githooks. Idempotent -- atomicWriteText always overwrites in place, so
 * re-running `setup` produces the same result.
 *
 * The hook bodies below are the single source of truth; the copies committed
 * at .githooks/pre-commit and .githooks/pre-push in this repo are kept in
 * sync with these constants by hand (see content/canonical-tasks.md `setup`).
 */

export const PRE_COMMIT_HOOK = `#!/bin/sh
# canon pre-commit hook -- deposited by \`canon setup\` (content/canonical-tasks.md).
# Runs verify:branch, verify:encoding --staged, verify:forward-coverage --staged,
# and state:validate when xbrief/ exists. Fails closed (exit 2) when the canon
# CLI cannot be resolved -- never silently skips a gate.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
    echo "canon pre-commit: unable to resolve repo root via 'git rev-parse'." >&2
    exit 1
fi

run_canon() {
    if [ -n "$CANON_HOOKS_BIN" ]; then
        "$CANON_HOOKS_BIN" "$@"
        return $?
    fi
    if command -v canon >/dev/null 2>&1; then
        canon "$@"
        return $?
    fi
    if [ -f "$REPO_ROOT/src/cli/bin.ts" ] && [ -f "$REPO_ROOT/dist/cli/bin.js" ]; then
        node "$REPO_ROOT/dist/cli/bin.js" "$@"
        return $?
    fi
    echo "canon pre-commit: cannot resolve the canon CLI." >&2
    echo "  Tried: \\$CANON_HOOKS_BIN, 'canon' on PATH, node dist/cli/bin.js (framework checkout)." >&2
    echo "  Recovery: npm i -g @deftai/canonical, run 'pnpm run build' in this repo, or set CANON_HOOKS_BIN." >&2
    exit 2
}

run_canon verify:branch --project-root "$REPO_ROOT" || exit $?

run_canon verify:encoding --staged --project-root "$REPO_ROOT" || exit $?

run_canon verify:forward-coverage --staged --project-root "$REPO_ROOT" || exit $?

if [ -d "$REPO_ROOT/xbrief" ]; then
    run_canon state:validate --project-root "$REPO_ROOT" || exit $?
fi
`;

export const PRE_PUSH_HOOK = `#!/bin/sh
# canon pre-push hook -- deposited by \`canon setup\` (content/canonical-tasks.md).
# Refuses to delete or force-update the default branch's ref. Reads the
# standard pre-push stdin protocol: "local_ref local_sha remote_ref remote_sha".
# ALLOW_DESTRUCTIVE_GIT=1 bypasses, but always prints an audit line to stderr.

ZERO_SHA="0000000000000000000000000000000000000000"

default_ref="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)"
if [ -n "$default_ref" ]; then
    default_ref="refs/heads/\${default_ref#refs/remotes/origin/}"
elif git show-ref --verify --quiet refs/heads/main; then
    default_ref="refs/heads/main"
elif git show-ref --verify --quiet refs/heads/master; then
    default_ref="refs/heads/master"
else
    default_ref="refs/heads/main"
fi

status=0
while read -r local_ref local_sha remote_ref remote_sha; do
    [ -z "$local_ref" ] && continue
    [ "$remote_ref" = "$default_ref" ] || continue

    destructive=0
    reason=""
    if [ "$local_sha" = "$ZERO_SHA" ]; then
        destructive=1
        reason="delete default branch ref '$remote_ref'"
    elif [ "$remote_sha" != "$ZERO_SHA" ] && ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
        destructive=1
        reason="force-update default branch ref '$remote_ref'"
    fi

    if [ "$destructive" = "1" ]; then
        if [ "$ALLOW_DESTRUCTIVE_GIT" = "1" ]; then
            echo "canon: destructive-git policy bypassed for this push" >&2
            continue
        fi
        echo "canon pre-push: refusing to $reason." >&2
        echo "  Bypass (audited): ALLOW_DESTRUCTIVE_GIT=1" >&2
        status=1
    fi
done

exit $status
`;

export interface DepositHooksResult {
  readonly ok: boolean;
  readonly wrote: readonly string[];
  readonly message: string;
}

/** Write both hook scripts, chmod them executable (skipped on win32), and set core.hooksPath. */
export function depositHooks(projectRoot: string, run?: GitRunner): DepositHooksResult {
  const wrote: string[] = [];
  try {
    const preCommitPath = atomicWriteText(projectRoot, ".githooks/pre-commit", PRE_COMMIT_HOOK);
    wrote.push(".githooks/pre-commit");
    const prePushPath = atomicWriteText(projectRoot, ".githooks/pre-push", PRE_PUSH_HOOK);
    wrote.push(".githooks/pre-push");
    if (process.platform !== "win32") {
      chmodSync(preCommitPath, 0o755);
      chmodSync(prePushPath, 0o755);
    }
  } catch (err) {
    return {
      ok: false,
      wrote,
      message: `setup: failed to write hook files -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const configured = setConfig(projectRoot, "core.hooksPath", ".githooks", run);
  if (!configured) {
    return {
      ok: false,
      wrote,
      message: "setup: failed to set core.hooksPath (is this a git repository?)",
    };
  }

  return {
    ok: true,
    wrote,
    message: "setup: deposited .githooks/pre-commit, .githooks/pre-push; core.hooksPath=.githooks",
  };
}
