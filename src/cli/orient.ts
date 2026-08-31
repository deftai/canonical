import { parseArgs, renderJson } from "../args/index.js";
import { softEmitUsage } from "../collection/index.js";
import { orient } from "../orient/index.js";

/** `canon orient` -- contract: content/canonical-tasks.md. */
export async function run(argv: string[]): Promise<number> {
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
        consent: snapshot.consent,
        consent_line: snapshot.consentLine,
        dirty: snapshot.dirty,
        exit_code: snapshot.code,
        identity: snapshot.consent.identity,
        identity_mode: snapshot.consent.identityMode,
        is_git_repo: snapshot.isGitRepo,
        metrics: snapshot.consent.metrics,
        metrics_mode: snapshot.consent.metricsMode,
        submissions: snapshot.consent.submissions,
        tools: snapshot.tools.map((t) => `${t.name}:${t.ok ? "ok" : "broken"}`),
        xbrief_readable: snapshot.xbriefReadable,
      })}\n`,
    );
  } else if (snapshot.code === 0) {
    process.stdout.write(`${snapshot.message}\n`);
  } else {
    process.stderr.write(`${snapshot.message}\n`);
  }

  if (snapshot.code === 0) {
    await softEmitUsage(projectRoot, "orient_ok");
  }
  return snapshot.code;
}
