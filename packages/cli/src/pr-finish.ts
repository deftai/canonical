import { parseArgs, renderJson } from "@canonpack/core/args";
import type { GhSeams } from "@canonpack/core/gh";
import { GhConfigError, resolveRepo } from "@canonpack/core/gh";
import { finishPr } from "@canonpack/core/pr";

/**
 * `pr:finish -- <pr-number> [--project-root=<path>] [--json]`
 * Contract: content/canonical-tasks.md `pr:finish`.
 */
export async function run(argv: string[], seams: GhSeams = {}): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon pr-finish: ${parsed.error}\n`);
    return 2;
  }
  const prArg = parsed.positional[0];
  if (prArg === undefined) {
    process.stderr.write("canon pr-finish: missing required <pr-number>\n");
    return 2;
  }
  const prNumber = Number(prArg);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    process.stderr.write(`canon pr-finish: invalid PR number: ${prArg}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const json = parsed.flags.json === true;

  let repo: ReturnType<typeof resolveRepo>;
  try {
    repo = resolveRepo(projectRoot, seams);
  } catch (err) {
    process.stderr.write(
      `canon pr-finish: ${err instanceof GhConfigError ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const result = await finishPr(seams, repo, prNumber, projectRoot);

  if (json) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        pr: prNumber,
        merged: result.merged,
        issue_closed: result.issueClosed,
        issue_number: result.issueNumber,
        message: result.message,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.message}\n`);
  }
  return result.code;
}
