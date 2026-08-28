/** `canon scope:complete` -- content/canonical-tasks.md #scope:complete. */
import { parseArgs, renderJson } from "../args/index.js";
import { softEmitUsage } from "../collection/index.js";
import { scopeComplete } from "../scope/index.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "disposition", "pr", "sha"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: scope-complete: ${parsed.error}\n`);
    return 2;
  }

  const scopeArg = parsed.positional[0];
  if (scopeArg === undefined) {
    process.stderr.write("canon: scope-complete: missing scope argument\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = await scopeComplete(projectRoot, {
    scope: scopeArg,
    disposition: parsed.values.disposition,
    pr: parsed.values.pr,
    sha: parsed.values.sha,
  });

  if (!result.ok) {
    process.stderr.write(`canon: scope-complete: ${result.message}\n`);
    return result.code;
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        ok: true,
        scope: result.scope,
        status: result.status,
        issue_closed: result.issueClosed ?? null,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.scope}: completed\n`);
  }
  const dimensions: Record<string, string | number | boolean> = {};
  if (parsed.values.disposition !== undefined) {
    dimensions.disposition = parsed.values.disposition;
  }
  if (parsed.values.pr !== undefined) {
    dimensions.had_delivery_pr = true;
  }
  await softEmitUsage(
    projectRoot,
    "scope_complete",
    1,
    Object.keys(dimensions).length > 0 ? dimensions : undefined,
  );
  return 0;
}
