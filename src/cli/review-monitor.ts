import { resolve } from "node:path";
import { parseArgs, renderJson } from "../args/index.js";
import { checkLease, registerLease, releaseLease } from "../review-monitor/index.js";

const ACTIONS = new Set(["register", "release", "check"]);

/**
 * `canon review-monitor` -- Contract: content/canonical-tasks.md `review-monitor`.
 * `register --pr=N --owner=…` | `release --pr=N` | `check --pr=N`.
 */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "pr", "owner"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: ${parsed.error}\n`);
    return 2;
  }

  const action = parsed.positional[0];
  if (action === undefined || !ACTIONS.has(action)) {
    process.stderr.write("canon: review-monitor requires one of register|release|check\n");
    return 2;
  }

  const prRaw = parsed.values.pr;
  if (prRaw === undefined) {
    process.stderr.write("canon: review-monitor requires --pr <n>\n");
    return 2;
  }
  const pr = Number(prRaw);
  if (!Number.isInteger(pr)) {
    process.stderr.write(`canon: --pr must be an integer, got ${JSON.stringify(prRaw)}\n`);
    return 2;
  }

  const projectRoot = resolve(parsed.values["project-root"] ?? ".");
  const json = parsed.flags.json === true;

  if (action === "register") {
    const owner = parsed.values.owner;
    if (owner === undefined) {
      process.stderr.write("canon: review-monitor register requires --owner <name>\n");
      return 2;
    }
    const result = registerLease(projectRoot, pr, owner);
    if (result.code === 2) {
      process.stderr.write(`canon: ${result.message ?? "review-monitor register failed"}\n`);
      return 2;
    }
    if (json) {
      process.stdout.write(`${renderJson({ lease: result.lease })}\n`);
    } else {
      process.stdout.write(`registered: pr #${pr} owner=${owner}\n`);
    }
    return 0;
  }

  if (action === "release") {
    const result = releaseLease(projectRoot, pr);
    if (result.code === 2) {
      process.stderr.write(`canon: ${result.message ?? "review-monitor release failed"}\n`);
      return 2;
    }
    if (json) {
      process.stdout.write(`${renderJson({ released: result.released })}\n`);
    } else {
      process.stdout.write(
        result.released ? `released: pr #${pr}\n` : `no lease to release for pr #${pr}\n`,
      );
    }
    return 0;
  }

  // check
  const result = checkLease(projectRoot, pr);
  if (result.code === 2) {
    process.stderr.write(`canon: ${result.message ?? "review-monitor check failed"}\n`);
    return 2;
  }
  if (result.code === 1) {
    if (json) {
      process.stdout.write(`${renderJson({ active: false })}\n`);
    } else {
      process.stdout.write(`no active lease for pr #${pr}\n`);
    }
    return 1;
  }
  if (json) {
    process.stdout.write(`${renderJson({ active: true, owner: result.lease?.owner })}\n`);
  } else {
    process.stdout.write(`${result.lease?.owner ?? ""}\n`);
  }
  return 0;
}
