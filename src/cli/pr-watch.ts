import { parseArgs, renderJson } from "../args/index.js";
import { softEmitUsage } from "../collection/index.js";
import type { GhSeams } from "../gh/index.js";
import { GhConfigError, ghClient, resolveRepo } from "../gh/index.js";
import { watchPr } from "../pr/index.js";

/**
 * `pr:watch -- <pr-number> [--one-shot] [--timeout=<seconds>] [--project-root=<path>] [--json]`
 * Contract: content/canonical-tasks.md `pr:watch`.
 */
export async function run(argv: string[], seams: GhSeams = {}): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["timeout", "project-root"],
    boolFlags: ["one-shot", "json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon pr-watch: ${parsed.error}\n`);
    return 2;
  }
  const prArg = parsed.positional[0];
  if (prArg === undefined) {
    process.stderr.write("canon pr-watch: missing required <pr-number>\n");
    return 2;
  }
  const prNumber = Number(prArg);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(`canon pr-watch: invalid PR number: ${prArg}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const json = parsed.flags.json === true;
  const oneShot = parsed.flags["one-shot"] === true;
  const timeoutRaw = parsed.values.timeout;
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined) {
    const seconds = Number(timeoutRaw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      process.stderr.write(`canon pr-watch: invalid --timeout: ${timeoutRaw}\n`);
      return 2;
    }
    timeoutMs = seconds * 1000;
  }

  let repo: ReturnType<typeof resolveRepo>;
  try {
    repo = resolveRepo(projectRoot, seams);
  } catch (err) {
    process.stderr.write(
      `canon pr-watch: ${err instanceof GhConfigError ? err.message : String(err)}\n`,
    );
    return 2;
  }

  let client: ReturnType<typeof ghClient>;
  try {
    client = ghClient(seams);
  } catch (err) {
    process.stderr.write(
      `canon pr-watch: ${err instanceof GhConfigError ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const result = await watchPr(client, repo, prNumber, { oneShot, timeoutMs });

  if (json) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        pr: prNumber,
        message: result.message,
        clean: result.clean?.clean,
        head_sha: result.clean?.headSha,
        reasons: result.clean?.reasons,
        up_to_date: result.clean?.upToDate,
        closing_keyword_present: result.clean?.closingKeywordPresent,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.message}\n`);
    if (result.clean !== undefined && result.clean.reasons.length > 0) {
      for (const reason of result.clean.reasons) {
        process.stdout.write(`  - ${reason}\n`);
      }
    }
  }
  if (result.code === 0) {
    await softEmitUsage(projectRoot, "pr_watch_clean");
  }
  return result.code;
}
