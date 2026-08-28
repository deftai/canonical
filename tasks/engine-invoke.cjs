#!/usr/bin/env node
"use strict";

/**
 * Spawn the canon CLI without shell-interpolating operator free-text
 * (#2547, #8). Prefer CANON_ENGINE_VERB + CANON_ENGINE_CLI_ARGS_JSON (true
 * argv array from go-task CLI_ARGS_LIST). Legacy CANON_ENGINE_CMD_JSON still
 * shellSplits a reconstructed string and is unsafe for unquoted newlines.
 *
 * Lives under tasks/ (not repo-root scripts/) so @canonpack/content
 * prepack ships it beside tasks/engine.yml (#2022 Phase 3).
 */

const { spawnSync } = require("node:child_process");

/**
 * cmd.exe command separators / metacharacters. Free-text CANON_ENGINE_CMD_JSON
 * tokens (release --summary text, CLI_ARGS, #2547) may legitimately contain
 * these; double-quoting renders them literal to cmd.exe's parser so a token can
 * never break out of its argv slot (subprocess-scm-01 / #2911).
 */
const WIN32_CMD_METACHAR_RE = /[\s"&|<>^()%!]/;

/**
 * Quote a single argument for `cmd.exe /d /s /c` so that shell metacharacters
 * stay inside one argv token. Mirrors tasks/engine-pm-run.cjs quoteWin32Arg but
 * also quotes cmd.exe separators (& | < > ^ ( ) % !) because engine-invoke
 * forwards operator free-text, not an allowlisted command.
 * @param {string} arg
 */
function quoteWin32Arg(arg) {
  const s = String(arg);
  if (s.length > 0 && !WIN32_CMD_METACHAR_RE.test(s)) {
    return s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

/** Minimal POSIX-ish shell word splitter (double/single quotes, escapes). */
function shellSplit(input) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      if (c === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[++i];
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

/**
 * Resolve spawn argv without shell-splitting free-text values (#8).
 *
 * Precedence:
 * 1. CANON_ENGINE_ARGV_JSON — full JSON string array
 * 2. CANON_ENGINE_VERB + CANON_ENGINE_CLI_ARGS_JSON (+ optional PROJECT_ROOT)
 * 3. Legacy CANON_ENGINE_CMD_JSON / CANON_ENGINE_CMD string + shellSplit
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function resolveEngineArgv(env = process.env) {
  if (env.CANON_ENGINE_ARGV_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(env.CANON_ENGINE_ARGV_JSON);
    } catch {
      console.error("canon: CANON_ENGINE_ARGV_JSON is not valid JSON");
      process.exit(2);
    }
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
      console.error("canon: CANON_ENGINE_ARGV_JSON must be a JSON array of strings");
      process.exit(2);
    }
    return parsed;
  }

  const verb = env.CANON_ENGINE_VERB;
  if (verb !== undefined && verb !== null && String(verb).trim() !== "") {
    let cliArgs = [];
    if (env.CANON_ENGINE_CLI_ARGS_JSON) {
      try {
        cliArgs = JSON.parse(env.CANON_ENGINE_CLI_ARGS_JSON);
      } catch {
        console.error("canon: CANON_ENGINE_CLI_ARGS_JSON is not valid JSON");
        process.exit(2);
      }
      if (!Array.isArray(cliArgs) || cliArgs.some((x) => typeof x !== "string")) {
        console.error("canon: CANON_ENGINE_CLI_ARGS_JSON must be a JSON array of strings");
        process.exit(2);
      }
    }
    const argv = [String(verb), ...cliArgs];
    const root = env.CANON_ENGINE_PROJECT_ROOT;
    if (root !== undefined && root !== null && String(root) !== "") {
      argv.push(`--project-root=${root}`);
    }
    return argv;
  }

  let cmdLine = "";
  if (env.CANON_ENGINE_CMD_JSON) {
    try {
      cmdLine = JSON.parse(env.CANON_ENGINE_CMD_JSON);
    } catch {
      console.error("canon: CANON_ENGINE_CMD_JSON is not valid JSON");
      process.exit(2);
    }
  } else {
    cmdLine = String(env.CANON_ENGINE_CMD || "");
  }
  return shellSplit(String(cmdLine).trim());
}

function main() {
  const mode = process.argv[2];
  const target = process.argv[3];
  const argv = resolveEngineArgv(process.env);
  if (argv.length === 0) {
    console.error("canon: engine argv is empty (set CANON_ENGINE_VERB or CANON_ENGINE_CMD_JSON)");
    process.exit(2);
  }
  if (!mode || !target) {
    console.error("canon: engine-invoke usage: engine-invoke.cjs <vendored|global> <bin-or-cli>");
    process.exit(2);
  }

  const plan = buildSpawnPlan(mode, target, argv);
  if (!plan) {
    console.error(`canon: engine-invoke unknown mode ${JSON.stringify(mode)}`);
    process.exit(2);
  }

  // Command transport is one-hop: a spawned CLI may invoke Task again with a
  // different ENGINE_CMD, which must not be shadowed by this inherited value.
  const childEnv = { ...process.env };
  delete childEnv.CANON_ENGINE_ARGV_JSON;
  delete childEnv.CANON_ENGINE_CLI_ARGS_JSON;
  delete childEnv.CANON_ENGINE_VERB;
  delete childEnv.CANON_ENGINE_PROJECT_ROOT;
  delete childEnv.CANON_ENGINE_CMD_JSON;
  delete childEnv.CANON_ENGINE_CMD;

  // stdio inherit (not pipe): piped stdout/stderr deadlocks when the child emits
  // more than the OS pipe buffer before exit — observed as greenfield smoke
  // hanging then CI SIGTERM exit 143 with no output (#2554 / #2547).
  const result = spawnSync(plan.command, plan.args, {
    stdio: "inherit",
    env: childEnv,
    // Never shell:true — even on win32 global (subprocess-scm-01 / #2911). The
    // win32 .cmd shim is reached through a tightly quoted cmd.exe wrapper below.
    shell: plan.shell,
    // CREATE_NO_WINDOW: hide console windows from Cursor Task / nested shells (#2563).
    windowsHide: true,
  });
  const code = result.status;
  process.exit(code === null ? 1 : code);
}

/**
 * Resolve the concrete spawn command/args for a mode+target without ever using
 * shell:true. On the win32 global path the target is a `.cmd` shim that Node
 * refuses to spawn with shell:false (CVE-2024-27980 / #2415); shell:true would
 * let cmd.exe re-parse free-text CANON_ENGINE_CMD_JSON tokens (subprocess-scm-01
 * / #2911). Instead route through `cmd.exe /d /s /c` with every token tightly
 * quoted so metacharacters stay inside a single argv token — aligned with
 * tasks/engine-pm-run.cjs executeAllowlisted().
 *
 * @param {string} mode
 * @param {string} target
 * @param {string[]} argv
 * @param {{ platform?: string, nodePath?: string }} [opts]
 * @returns {{ command: string, args: string[], shell: false } | null}
 */
function buildSpawnPlan(mode, target, argv, opts = {}) {
  const platform = opts.platform || process.platform;
  const nodePath = opts.nodePath || process.execPath;

  let execPath;
  let execArgv;
  if (mode === "vendored") {
    execPath = nodePath;
    execArgv = [target, ...argv];
  } else if (mode === "global") {
    execPath = target;
    execArgv = argv;
  } else {
    return null;
  }

  if (mode === "global" && platform === "win32") {
    const commandLine = [execPath, ...execArgv].map(quoteWin32Arg).join(" ");
    return { command: "cmd.exe", args: ["/d", "/s", "/c", commandLine], shell: false };
  }

  return { command: execPath, args: execArgv, shell: false };
}

if (require.main === module) {
  main();
}

module.exports = {
  shellSplit,
  quoteWin32Arg,
  buildSpawnPlan,
  resolveEngineArgv,
  WIN32_CMD_METACHAR_RE,
};
