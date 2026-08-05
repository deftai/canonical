import { parseArgs, renderJson } from "../args/index.js";
import { orient } from "../orient/index.js";

/** `canon orient` -- contract: content/canonical-tasks.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "allow-dirty"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: orient -- ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const snapshot = orient(projectRoot, { allowDirty: parsed.flags["allow-dirty"] === true });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        branch: snapshot.branch,
        xbrief_readable: snapshot.xbriefReadable,
        dirty: snapshot.dirty,
        exit_code: snapshot.code,
        is_git_repo: snapshot.isGitRepo,
        tools: snapshot.tools.map((t) => `${t.name}:${t.ok ? "ok" : "broken"}`),
      })}\n`,
    );
    return snapshot.code;
  }

  if (snapshot.code === 0) {
    process.stdout.write(`${snapshot.message}\n`);
  } else {
    process.stderr.write(`${snapshot.message}\n`);
  }
  return snapshot.code;
}
