/** `canon collection:status` -- local consent decision (+ optional live SDK status). */
import { parseArgs, renderJson } from "../args/index.js";
import { collectionStatus } from "../collection/index.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "live"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-status: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = await collectionStatus(projectRoot, { live: parsed.flags.live === true });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        consent_version: result.status.consentVersion ?? null,
        expires_at: result.status.expiresAt ?? null,
        identity: result.status.identity,
        install_id: result.status.installId ?? null,
        live_state: result.status.liveState ?? null,
        message: result.message,
        metrics: result.status.metrics,
        prompt_state: result.status.promptState,
        scopes: result.status.scopes,
        submissions: result.status.submissions,
      })}\n`,
    );
  } else {
    const stream = result.code === 0 ? process.stdout : process.stderr;
    stream.write(`${result.message}\n`);
  }
  return result.code;
}
