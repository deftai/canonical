import { parseArgs, renderJson } from "@canonpack/core/args";
import type { GhSeams } from "@canonpack/core/gh";
import { GhConfigError, ghClient, resolveRepo } from "@canonpack/core/gh";
import { emit, ingest, reconcile } from "@canonpack/core/issue-sync";

function configError(prefix: string, err: unknown): string {
  return `canon issue-sync ${prefix}: ${err instanceof GhConfigError ? err.message : String(err)}`;
}

async function runIngest(argv: string[], seams: GhSeams): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["label", "project-root"],
    boolFlags: ["all", "dry-run", "json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon issue-sync ingest: ${parsed.error}\n`);
    return 2;
  }
  const numberArg = parsed.positional[0];
  const all = parsed.flags.all === true;
  if (numberArg === undefined && !all) {
    process.stderr.write("canon issue-sync ingest: provide an issue number or --all\n");
    return 2;
  }
  if (numberArg !== undefined && all) {
    process.stderr.write("canon issue-sync ingest: cannot combine an issue number with --all\n");
    return 2;
  }
  let issueNumber: number | undefined;
  if (numberArg !== undefined) {
    issueNumber = Number(numberArg);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      process.stderr.write(`canon issue-sync ingest: invalid issue number: ${numberArg}\n`);
      return 2;
    }
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const json = parsed.flags.json === true;
  const dryRun = parsed.flags["dry-run"] === true;

  let repo: ReturnType<typeof resolveRepo>;
  let client: ReturnType<typeof ghClient>;
  try {
    repo = resolveRepo(projectRoot, seams);
    client = ghClient(seams);
  } catch (err) {
    process.stderr.write(`${configError("ingest", err)}\n`);
    return 2;
  }

  const result = await ingest(client, repo, projectRoot, {
    number: issueNumber,
    all,
    label: parsed.values.label,
    dryRun,
  });

  if (json) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        dry_run: result.dryRun,
        message: result.message,
        skipped: result.skipped,
        written: result.written,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const path of result.written) {
      process.stdout.write(`  ${result.dryRun ? "would write" : "wrote"}: ${path}\n`);
    }
    for (const skip of result.skipped) {
      process.stdout.write(`  skip issue #${skip.issueNumber}: ${skip.reason}\n`);
    }
  }
  return result.code;
}

async function runEmit(argv: string[], seams: GhSeams): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon issue-sync emit: ${parsed.error}\n`);
    return 2;
  }
  const scopeId = parsed.positional[0];
  if (scopeId === undefined) {
    process.stderr.write("canon issue-sync emit: missing required <scope-id>\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const json = parsed.flags.json === true;

  let repo: ReturnType<typeof resolveRepo>;
  let client: ReturnType<typeof ghClient>;
  try {
    repo = resolveRepo(projectRoot, seams);
    client = ghClient(seams);
  } catch (err) {
    process.stderr.write(`${configError("emit", err)}\n`);
    return 2;
  }

  const result = await emit(client, repo, projectRoot, scopeId);

  if (json) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        created: result.created,
        issue_number: result.issueNumber,
        message: result.message,
      })}\n`,
    );
  } else {
    process.stdout.write(`${result.message}\n`);
  }
  return result.code;
}

async function runReconcile(argv: string[], seams: GhSeams): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon issue-sync reconcile: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const json = parsed.flags.json === true;

  let repo: ReturnType<typeof resolveRepo>;
  let client: ReturnType<typeof ghClient>;
  try {
    repo = resolveRepo(projectRoot, seams);
    client = ghClient(seams);
  } catch (err) {
    process.stderr.write(`${configError("reconcile", err)}\n`);
    return 2;
  }

  const result = await reconcile(client, repo, projectRoot);

  if (json) {
    process.stdout.write(
      `${renderJson({ code: result.code, findings: result.findings, message: result.message })}\n`,
    );
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const finding of result.findings) {
      process.stdout.write(`  [${finding.kind}] ${finding.message}\n`);
    }
  }
  return result.code;
}

/**
 * `issue:sync ingest|emit|reconcile -- ...`
 * Contract: content/canonical-tasks.md `issue:sync`.
 */
export async function run(argv: string[], seams: GhSeams = {}): Promise<number> {
  const sub = argv[0];
  if (sub === undefined) {
    process.stderr.write("canon issue-sync: missing subcommand (ingest|emit|reconcile)\n");
    return 2;
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "ingest":
      return runIngest(rest, seams);
    case "emit":
      return runEmit(rest, seams);
    case "reconcile":
      return runReconcile(rest, seams);
    default:
      process.stderr.write(
        `canon issue-sync: unknown subcommand '${sub}' (ingest|emit|reconcile)\n`,
      );
      return 2;
  }
}
