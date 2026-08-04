/** `render` -- content/canonical-tasks.md. `roadmap|spec [--check]`. */
import { parseArgs, renderJson } from "../args/index.js";
import { renderRoadmap, renderSpec } from "../render/index.js";

const RENDER_TARGETS = ["roadmap", "spec"] as const;
type RenderTarget = (typeof RENDER_TARGETS)[number];

function isRenderTarget(value: string | undefined): value is RenderTarget {
  return value !== undefined && (RENDER_TARGETS as readonly string[]).includes(value);
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["check", "json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: render: ${parsed.error}\n`);
    return 2;
  }

  const target = parsed.positional[0];
  if (!isRenderTarget(target)) {
    process.stderr.write("canon: render: expected 'roadmap' or 'spec'\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const opts = { check: parsed.flags.check === true };
  const result =
    target === "roadmap" ? renderRoadmap(projectRoot, opts) : renderSpec(projectRoot, opts);

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        ok: result.ok,
        code: result.code,
        message: result.message,
        path: result.path ?? null,
      })}\n`,
    );
    return result.code;
  }

  if (result.ok) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
