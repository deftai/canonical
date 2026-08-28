/** `canon collection:opt-out` -- revoke consent and clear credentials. */
import { parseArgs, renderJson } from "../args/index.js";
import { collectionOptOut } from "../collection/index.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "confirm", "identity"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-opt-out: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = await collectionOptOut(projectRoot, {
    confirm: parsed.flags.confirm === true,
    identity: parsed.flags.identity === true,
  });

  if (parsed.flags.json === true) {
    process.stdout.write(`${renderJson({ code: result.code, message: result.message })}\n`);
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
