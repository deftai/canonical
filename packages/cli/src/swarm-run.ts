import { resolve } from "node:path";
import { parseArgs, renderJson } from "@canonpack/core/args";
import { swarmRun } from "@canonpack/core/swarm";

/**
 * `canon swarm-run` (alias `swarm:run`) -- Contract: content/canonical-tasks.md
 * `swarm:run`. Mode A: positionals are story paths (readiness + manifest).
 * Mode B: `--finalize --manifest <path>` (post-merge scope:complete).
 */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "manifest"],
    boolFlags: ["json", "finalize"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = resolve(parsed.values["project-root"] ?? ".");

  if (parsed.flags.finalize === true) {
    const manifestPath = parsed.values.manifest;
    if (manifestPath === undefined) {
      process.stderr.write("canon: swarm-run --finalize requires --manifest <path>\n");
      return 2;
    }
    const result = swarmRun(projectRoot, { mode: "finalize", manifestPath });
    if (result.code === 2) {
      process.stderr.write(`canon: ${result.message ?? "swarm-run finalize failed"}\n`);
      return 2;
    }
    if (parsed.flags.json === true) {
      process.stdout.write(`${renderJson({ finalized: result.finalized })}\n`);
    } else if (result.finalized.length === 0) {
      process.stdout.write("swarm-run finalize: no active-scope stories in manifest to finalize\n");
    } else {
      for (const scope of result.finalized) {
        process.stdout.write(`finalized: ${scope}\n`);
      }
    }
    return 0;
  }

  if (parsed.positional.length === 0) {
    process.stderr.write(
      "canon: swarm-run requires story paths, or --finalize --manifest <path>\n",
    );
    return 2;
  }

  const result = swarmRun(projectRoot, { mode: "stories", storyPaths: parsed.positional });
  if (result.code === 2) {
    process.stderr.write(`canon: ${result.message ?? "swarm-run readiness check failed"}\n`);
    return 2;
  }
  if (result.code === 1) {
    if (parsed.flags.json === true) {
      process.stdout.write(`${renderJson({ ok: false, violations: result.violations })}\n`);
    } else {
      process.stderr.write("swarm-run: not ready\n");
      for (const v of result.violations) {
        process.stderr.write(`  ${v.story}: ${v.reason}\n`);
      }
    }
    return 1;
  }

  const manifest = result.manifest;
  if (parsed.flags.json === true) {
    process.stdout.write(`${renderJson({ ok: true, manifest })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  return 0;
}
