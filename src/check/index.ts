import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectQualityBlock, readProjectBrief } from "../policy/index.js";
import type { GateExitCode } from "../types/index.js";

/**
 * Quality gate command resolution + execution (content/canonical-tasks.md `check`).
 *
 * Command source, in order: xbrief/PROJECT.json `quality.commands[]` when
 * non-empty; else detect from the toolchain on disk (package.json, go.mod,
 * pyproject.toml); else a config error.
 */

export type ResolveCheckCommandsResult =
  | { readonly ok: true; readonly commands: readonly string[] }
  | { readonly ok: false; readonly message: string };

function detectPackageJsonCommands(projectRoot: string): readonly string[] {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return [];
  }
  let scripts: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const rawScripts = (parsed as Record<string, unknown>).scripts;
      if (typeof rawScripts === "object" && rawScripts !== null) {
        scripts = rawScripts as Record<string, unknown>;
      }
    }
  } catch {
    return [];
  }
  const pm = existsSync(join(projectRoot, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  const commands: string[] = [];
  // Spec order: format check first, then lint, build, test. Coverage
  // thresholds are enforced by the project's own test tooling config (the
  // pack's engineering.md requires thresholds in config, not convention).
  for (const script of ["format:check", "lint", "build", "test"]) {
    if (typeof scripts[script] === "string") {
      commands.push(`${pm} run ${script}`);
    }
  }
  return commands;
}

function detectGoModCommands(projectRoot: string): readonly string[] {
  if (!existsSync(join(projectRoot, "go.mod"))) {
    return [];
  }
  return ["go vet ./...", "go build ./...", "go test ./..."];
}

function detectPyprojectCommands(projectRoot: string): readonly string[] {
  if (!existsSync(join(projectRoot, "pyproject.toml"))) {
    return [];
  }
  return ["python -m pytest"];
}

const DETECTORS: readonly ((projectRoot: string) => readonly string[])[] = [
  detectPackageJsonCommands,
  detectGoModCommands,
  detectPyprojectCommands,
];

/** PROJECT.xbrief.json plan["x-canonical/quality"].commands[] if non-empty, else detect from the toolchain on disk. */
export function resolveCheckCommands(projectRoot: string): ResolveCheckCommandsResult {
  const read = readProjectBrief(projectRoot);
  if (!read.ok) {
    return { ok: false, message: read.message };
  }
  const configured = projectQualityBlock(read.project).commands;
  if (configured !== undefined && configured.length > 0) {
    return { ok: true, commands: configured };
  }
  for (const detect of DETECTORS) {
    const commands = detect(projectRoot);
    if (commands.length > 0) {
      return { ok: true, commands };
    }
  }
  return { ok: false, message: "no commands configured or detected" };
}

export interface CommandRunResult {
  readonly status: number;
}

/** Injectable command execution seam. Tests must never invoke this against a real package manager. */
export type CommandRunner = (command: string, cwd?: string) => CommandRunResult;

/** Quote one argument for a cmd.exe command line (win32 .cmd shims). */
function quoteWin32Arg(arg: string): string {
  if (arg.length > 0 && !/[\s"&|<>^()%!]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Naive whitespace argv-split, then spawnSync(shell:false, stdio:"inherit") in
 * the project root. On win32, package-manager entry points are .cmd shims Node
 * refuses to spawn with shell:false -- route through a tightly quoted
 * `cmd.exe /d /s /c` line instead (same discipline as tasks/engine-pm-run.cjs).
 */
export const defaultCommandRunner: CommandRunner = (command, cwd) => {
  const [cmd, ...args] = command.split(/\s+/).filter((s) => s.length > 0);
  if (cmd === undefined) {
    return { status: 1 };
  }
  if (process.platform === "win32") {
    const line = [cmd, ...args].map(quoteWin32Arg).join(" ");
    const winResult = spawnSync("cmd.exe", ["/d", "/s", "/c", line], {
      shell: false,
      stdio: "inherit",
      cwd,
      windowsHide: true,
    });
    return { status: winResult.status ?? 1 };
  }
  const result = spawnSync(cmd, args, { shell: false, stdio: "inherit", cwd, windowsHide: true });
  return { status: result.status ?? 1 };
};

/** Seam for the built-in `state:validate` / `verify:encoding` stages -- always the real CLI dispatcher in production. */
export type DispatchFn = (argv: string[]) => Promise<number>;

export interface RunCheckOptions {
  readonly commandRunner?: CommandRunner;
  readonly dispatchFn: DispatchFn;
}

export interface RunCheckResult {
  readonly ok: boolean;
  readonly code: GateExitCode;
  /** The command or built-in stage name that failed, absent when `ok`. */
  readonly failingStage?: string;
  readonly message: string;
}

/** Built-in stages appended after the configured/detected command list (content/canonical-tasks.md `check`). */
const BUILTIN_STAGES = ["state:validate", "verify:encoding"] as const;

/**
 * Run configured/detected commands in order, stopping at the first failure;
 * then run the built-in `state:validate` + `verify:encoding` stages via
 * `dispatchFn`.
 */
export async function runCheck(
  projectRoot: string,
  opts: RunCheckOptions,
): Promise<RunCheckResult> {
  const resolved = resolveCheckCommands(projectRoot);
  if (!resolved.ok) {
    return { ok: false, code: 2, message: resolved.message };
  }
  const runner = opts.commandRunner ?? defaultCommandRunner;
  for (const command of resolved.commands) {
    const result = runner(command, projectRoot);
    if (result.status !== 0) {
      return {
        ok: false,
        code: 1,
        failingStage: command,
        message: `check failed at stage: ${command}`,
      };
    }
  }
  for (const stage of BUILTIN_STAGES) {
    const code = await opts.dispatchFn([stage, "--project-root", projectRoot]);
    if (code !== 0) {
      return {
        ok: false,
        code: 1,
        failingStage: stage,
        message: `check failed at stage: ${stage}`,
      };
    }
  }
  return { ok: true, code: 0, message: "all checks passed" };
}
