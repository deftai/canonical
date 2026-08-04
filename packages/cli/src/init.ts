import { resolve } from "node:path";
import { parseArgs, renderJson } from "@canonpack/core/args";
import { runInit } from "@canonpack/core/init-deposit";

/** `canon init` -- Contract: content/canonical-tasks.md `setup`/install flow, README.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, { valueFlags: ["project-root"], boolFlags: ["json"] });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = resolve(parsed.values["project-root"] ?? ".");
  const result = runInit(projectRoot);

  if (result.code === 2) {
    process.stderr.write(`canon: ${result.message ?? "init failed"}\n`);
    return 2;
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({ written: result.written, skipped: result.skipped, warnings: result.warnings })}\n`,
    );
    return 0;
  }

  for (const path of result.written) {
    process.stdout.write(`written: ${path}\n`);
  }
  for (const path of result.skipped) {
    process.stdout.write(`skipped: ${path}\n`);
  }
  for (const warning of result.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  return 0;
}
