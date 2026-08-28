/**
 * Unit tests for tasks/engine-invoke.cjs argv transport (#8).
 * No network; asserts spawn argv preserves a single --details=... token.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const engineInvoke = require(
  join(dirname(fileURLToPath(import.meta.url)), "..", "tasks", "engine-invoke.cjs"),
) as {
  resolveEngineArgv: (env?: NodeJS.ProcessEnv) => string[];
  buildSpawnPlan: (
    mode: string,
    target: string,
    argv: string[],
    opts?: { platform?: string; nodePath?: string },
  ) => { command: string; args: string[]; shell: false } | null;
  quoteWin32Arg: (arg: string) => string;
};

const SPECIAL_DETAILS = [
  { name: "spaces", value: "line with spaces" },
  { name: "newlines", value: "line1\nline2 with spaces" },
  { name: "double quotes", value: 'say "hello"' },
  { name: "single quotes", value: "it's broken" },
  { name: "backticks", value: "use `code` here" },
  {
    name: "mixed",
    value: "line1\nline2 with spaces and \"quotes\" and 'apostrophes' and `ticks`",
  },
] as const;

describe("engine-invoke resolveEngineArgv", () => {
  it("prefers CANON_ENGINE_ARGV_JSON full argv array", () => {
    const details = "--details=line1\nline2 with spaces";
    const argv = engineInvoke.resolveEngineArgv({
      CANON_ENGINE_ARGV_JSON: JSON.stringify([
        "feedback",
        "--kind=feature",
        details,
        "--project-root=/tmp/proj",
      ]),
    });
    expect(argv).toEqual(["feedback", "--kind=feature", details, "--project-root=/tmp/proj"]);
    expect(argv.filter((a) => a.startsWith("--details="))).toHaveLength(1);
  });

  it("assembles from VERB + CLI_ARGS_JSON + PROJECT_ROOT without shellSplit", () => {
    for (const { name, value } of SPECIAL_DETAILS) {
      const detailsToken = `--details=${value}`;
      const argv = engineInvoke.resolveEngineArgv({
        CANON_ENGINE_VERB: "feedback",
        CANON_ENGINE_CLI_ARGS_JSON: JSON.stringify([
          "--kind=feature",
          detailsToken,
          "--summary=short",
        ]),
        CANON_ENGINE_PROJECT_ROOT: "/tmp/proj",
      });
      expect(argv, name).toEqual([
        "feedback",
        "--kind=feature",
        detailsToken,
        "--summary=short",
        "--project-root=/tmp/proj",
      ]);
      expect(
        argv.filter((a) => a.startsWith("--details=")),
        name,
      ).toHaveLength(1);
      expect(
        argv.find((a) => a.startsWith("--details=")),
        name,
      ).toBe(detailsToken);
    }
  });

  it("falls back to CANON_ENGINE_CMD_JSON shellSplit for legacy callers", () => {
    const argv = engineInvoke.resolveEngineArgv({
      CANON_ENGINE_CMD_JSON: JSON.stringify("feedback --kind=bug --summary=ok --project-root /tmp"),
    });
    expect(argv[0]).toBe("feedback");
    expect(argv).toContain("--kind=bug");
  });
});

describe("engine-invoke buildSpawnPlan preserves details token", () => {
  for (const { name, value } of SPECIAL_DETAILS) {
    it(`unix vendored spawn keeps single --details token (${name})`, () => {
      const detailsToken = `--details=${value}`;
      const argv = ["feedback", "--kind=feature", detailsToken, "--project-root=/tmp/proj"];
      const plan = engineInvoke.buildSpawnPlan("vendored", "/path/to/bin.js", argv, {
        platform: "darwin",
        nodePath: "/usr/bin/node",
      });
      expect(plan).not.toBeNull();
      expect(plan?.shell).toBe(false);
      expect(plan?.args.filter((a) => a.startsWith("--details="))).toHaveLength(1);
      expect(plan?.args).toContain(detailsToken);
      expect(plan?.args).toEqual(["/path/to/bin.js", ...argv]);
    });

    it(`win32 global cmd quoting keeps details inside one token (${name})`, () => {
      const detailsToken = `--details=${value}`;
      const argv = ["feedback", "--kind=feature", detailsToken];
      const plan = engineInvoke.buildSpawnPlan("global", "canon.cmd", argv, {
        platform: "win32",
      });
      expect(plan).not.toBeNull();
      expect(plan?.command).toBe("cmd.exe");
      expect(plan?.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      const commandLine = plan?.args[3] ?? "";
      // The command line is a single string for cmd.exe; details must appear as
      // one quoted/escaped token, not whitespace-split into separate words.
      expect(commandLine.includes(engineInvoke.quoteWin32Arg(detailsToken))).toBe(true);
      expect(commandLine.startsWith("canon.cmd")).toBe(true);
    });
  }
});
