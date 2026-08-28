/** `check` -- content/canonical-tasks.md. Quality gate over resolveCheckCommands/runCheck. */
import { parseArgs, renderJson } from "../args/index.js";
import { runCheck } from "../check/index.js";
import { softEmitUsage } from "../collection/index.js";
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

  if (result.code === 0) {
    await softEmitUsage(projectRoot, "check_pass");
  } else if (result.code === 1) {
    await softEmitUsage(
      projectRoot,
      "check_fail",
      1,
      result.failingStage !== undefined ? { failed_stage: result.failingStage } : undefined,
    );
  }
  return result.code;
}
