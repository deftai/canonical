import { spawnSync } from "node:child_process";
import { parseArgs, renderJson } from "@canonpack/core/args";
import { depositHooks } from "@canonpack/core/hooks";

interface ToolResult {
  readonly ok: boolean;
  readonly detail: string;
}

function probeVersion(bin: string): ToolResult {
  const result = spawnSync(bin, ["--version"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error !== undefined || result.status !== 0) {
    return { ok: false, detail: "not found on PATH" };
  }
  const firstLine = (result.stdout || result.stderr || "").trim().split("\n")[0] ?? "";
  return { ok: true, detail: firstLine };
}

const MIN_TASK_VERSION: readonly [number, number, number] = [3, 33, 0];

function parseVersion(detail: string): readonly [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(detail);
  if (m === null) {
    return null;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  return [major, minor, patch];
}

function isAtLeast(
  version: readonly [number, number, number],
  min: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    const v = version[i] ?? 0;
    const m = min[i] ?? 0;
    if (v > m) {
      return true;
    }
    if (v < m) {
      return false;
    }
  }
  return true;
}

/** `canon setup` -- contract: content/canonical-tasks.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: setup -- ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const deposit = depositHooks(projectRoot);
  if (!deposit.ok) {
    process.stderr.write(`canon: setup -- ${deposit.message}\n`);
    return 2;
  }

  const git = probeVersion("git");
  const node = probeVersion("node");
  const task = probeVersion("task");

  const warnings: string[] = [];
  if (task.ok) {
    const version = parseVersion(task.detail);
    if (version !== null && !isAtLeast(version, MIN_TASK_VERSION)) {
      warnings.push(
        `go-task ${version.join(".")} detected; >= ${MIN_TASK_VERSION.join(".")} is required for flattened Taskfile includes.`,
      );
    }
  }
  for (const w of warnings) {
    process.stderr.write(`canon: setup warning -- ${w}\n`);
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        exit_code: 0,
        git_found: git.ok,
        node_found: node.ok,
        task_found: task.ok,
        warning_count: warnings.length,
        wrote: deposit.wrote,
      })}\n`,
    );
    return 0;
  }

  const lines = [
    deposit.message,
    git.ok ? `git: found (${git.detail})` : "git: NOT FOUND on PATH",
    node.ok ? `node: found (${node.detail})` : "node: NOT FOUND on PATH",
    task.ok
      ? `task: found (${task.detail})`
      : "task: not found on PATH (optional; needed to run `task <verb>`)",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
