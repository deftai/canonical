/** `check` -- content/canonical-tasks.md. Quality gate over resolveCheckCommands/runCheck. */
import { parseArgs, renderJson } from "../args/index.js";
import { coverageCheckDimensions } from "../check/coverage-summary.js";
import { runCheck } from "../check/index.js";
import { recordCheckRun, softEmitUsage } from "../collection/index.js";
import { dispatch } from "./dispatch.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: check: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const checkStartedMs = Date.now();
  const result = await runCheck(projectRoot, { dispatchFn: dispatch });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        ok: result.ok,
        code: result.code,
        failing_stage: result.failingStage ?? null,
        message: result.message,
      })}\n`,
    );
  } else if (result.ok) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }

  if (result.code === 0 || result.code === 1) {
    recordCheckRun(projectRoot);
    const coverage = coverageCheckDimensions(projectRoot, { notBeforeMs: checkStartedMs });
    if (result.code === 0) {
      await softEmitUsage(projectRoot, "check_pass", 1, coverage);
    } else {
      const failDims: Record<string, string | number | boolean> = {
        ...(coverage ?? {}),
      };
      if (result.failingStage !== undefined) {
        failDims.failed_stage = result.failingStage;
      }
      await softEmitUsage(
        projectRoot,
        "check_fail",
        1,
        Object.keys(failDims).length > 0 ? failDims : undefined,
      );
    }
  }
  return result.code;
}
