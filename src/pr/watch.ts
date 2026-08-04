import type { GhClient, RepoSlug } from "../gh/rest.js";
import { CHANGES_REQUESTED_REASON_PREFIX, type CleanResult, evaluateClean } from "./clean.js";

/** Exit codes per content/canonical-tasks.md `pr:watch`. */
export type WatchExitCode = 0 | 1 | 2;

export interface WatchOptions {
  /** Evaluate once and return immediately instead of polling. */
  readonly oneShot?: boolean;
  /** Overall wall-clock budget; default 15 minutes. */
  readonly timeoutMs?: number;
  /** Delay between polls; default 5 seconds. */
  readonly pollMs?: number;
  /** Injectable sleep for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests; returns epoch millis. */
  readonly now?: () => number;
}

export interface WatchResult {
  readonly code: WatchExitCode;
  readonly message: string;
  readonly clean?: CleanResult;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 5000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasUnsupersededChangesRequested(result: CleanResult): boolean {
  return result.reasons.some((r) => r.startsWith(CHANGES_REQUESTED_REASON_PREFIX));
}

/**
 * Poll a PR until a terminal state for its current head SHA:
 *   CLEAN -> 0; new un-superseded CHANGES_REQUESTED on current head -> 1;
 *   timeout or API error -> 2. `oneShot` performs a single evaluation and
 *   maps directly (non-terminal single-shot outcomes -> 2, same as timeout).
 */
export async function watchPr(
  client: GhClient,
  repo: RepoSlug,
  prNumber: number,
  opts: WatchOptions = {},
): Promise<WatchResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const start = now();

  for (;;) {
    let result: CleanResult;
    try {
      result = await evaluateClean(client, repo, prNumber);
    } catch (err) {
      return { code: 2, message: `API error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (result.clean) {
      return { code: 0, message: "CLEAN", clean: result };
    }

    if (hasUnsupersededChangesRequested(result)) {
      return {
        code: 1,
        message: `CHANGES_REQUESTED on current head: ${result.reasons.filter((r) => r.startsWith(CHANGES_REQUESTED_REASON_PREFIX)).join(", ")}`,
        clean: result,
      };
    }

    if (opts.oneShot === true) {
      return { code: 2, message: "not CLEAN (one-shot): no terminal state reached", clean: result };
    }

    if (now() - start >= timeoutMs) {
      return { code: 2, message: "timeout waiting for PR to reach CLEAN", clean: result };
    }

    await sleep(pollMs);
  }
}
