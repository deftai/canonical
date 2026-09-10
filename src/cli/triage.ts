/** `canon triage` -- content/canonical-tasks.md #triage. */
import { parseArgs, renderJson } from "../args/index.js";
import { softEmitUsage, triageDimensions } from "../collection/index.js";
import { isTriageVerb, triageDecide } from "../triage/index.js";
import { findScope, readScope } from "../xbrief/brief-io.js";

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "note"],
    boolFlags: ["json", "force"],
    maxPositional: 3,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: triage: ${parsed.error}\n`);
    return 2;
  }

  const [verbArg, scopeArg, winningUri] = parsed.positional;
  if (verbArg === undefined || !isTriageVerb(verbArg)) {
    process.stderr.write(
      "canon: triage: first argument must be one of accept|reject|defer|duplicate\n",
    );
    return 2;
  }
  if (scopeArg === undefined) {
    process.stderr.write("canon: triage: missing scope argument\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const found = findScope(projectRoot, scopeArg);
  let fromStatus = "proposed";
  if (found !== null && !("ambiguous" in found)) {
    const read = readScope(found.path);
    if (read.ok) {
      fromStatus = read.scope.plan.status;
    }
  }
  const result = triageDecide(projectRoot, {
    verb: verbArg,
    scope: scopeArg,
    note: parsed.values.note,
    force: parsed.flags.force ?? false,
    winningUri,
  });

  if (!result.ok) {
    process.stderr.write(`canon: triage: ${result.message}\n`);
    return result.code;
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        ok: true,
        verb: result.verb,
        scope: result.scope,
        status: result.status,
        wip_cap_override: result.wipCapOverride ?? false,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.verb}: ${result.scope} -> ${result.status}\n`);
  }
  void softEmitUsage(
    projectRoot,
    "xbrief_triage",
    1,
    triageDimensions(result.verb, fromStatus, result.status),
  );
  return 0;
}
