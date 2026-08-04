import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { type CommandRunner, resolveCheckCommands, runCheck } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

function writeProject(overrides: Record<string, unknown> = {}): string {
  const root = tempDir("check-test-");
  mkdirSync(join(root, "briefs"), { recursive: true });
  writeFileSync(
    join(root, "briefs", "PROJECT.json"),
    `${JSON.stringify({ title: "t", policy: {}, ...overrides }, null, 2)}\n`,
  );
  return root;
}

describe("resolveCheckCommands: detection matrix", () => {
  it("uses briefs/PROJECT.json quality.commands when non-empty", () => {
    const root = writeProject({ quality: { commands: ["custom lint", "custom test"] } });
    const result = resolveCheckCommands(root);
    expect(result).toEqual({ ok: true, commands: ["custom lint", "custom test"] });
  });

  it("detects package.json + pnpm-lock.yaml as pnpm run <script> for scripts that exist", () => {
    const root = writeProject();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }),
    );
    const result = resolveCheckCommands(root);
    expect(result).toEqual({ ok: true, commands: ["pnpm run lint", "pnpm run test"] });
  });

  it("detects package.json without pnpm-lock.yaml as npm run <script>", () => {
    const root = writeProject();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint .", build: "tsc", test: "vitest run" } }),
    );
    const result = resolveCheckCommands(root);
    expect(result).toEqual({
      ok: true,
      commands: ["npm run lint", "npm run build", "npm run test"],
    });
  });

  it("detects go.mod as the fixed go vet/build/test triple", () => {
    const root = writeProject();
    writeFileSync(join(root, "go.mod"), "module example.com/x\n\ngo 1.22\n");
    const result = resolveCheckCommands(root);
    expect(result).toEqual({
      ok: true,
      commands: ["go vet ./...", "go build ./...", "go test ./..."],
    });
  });

  it("detects pyproject.toml as python -m pytest", () => {
    const root = writeProject();
    writeFileSync(join(root, "pyproject.toml"), "[project]\nname = 'x'\n");
    const result = resolveCheckCommands(root);
    expect(result).toEqual({ ok: true, commands: ["python -m pytest"] });
  });

  it("returns a config error (exit 2 semantics) when nothing is configured or detected", () => {
    const root = writeProject();
    const result = resolveCheckCommands(root);
    expect(result).toEqual({ ok: false, message: "no commands configured or detected" });
  });

  it("falls through to the next detector when package.json has no matching scripts", () => {
    const root = writeProject();
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { start: "node ." } }));
    writeFileSync(join(root, "go.mod"), "module example.com/x\n\ngo 1.22\n");
    const result = resolveCheckCommands(root);
    expect(result).toEqual({
      ok: true,
      commands: ["go vet ./...", "go build ./...", "go test ./..."],
    });
  });
});

describe("runCheck: stage-failure naming", () => {
  function fakeDispatch(codes: Record<string, number>): (argv: string[]) => Promise<number> {
    return async (argv) => codes[argv[0] ?? ""] ?? 0;
  }

  it("runs configured commands in order via the injected runner, then the built-in stages", async () => {
    const root = writeProject({ quality: { commands: ["a", "b"] } });
    const seen: string[] = [];
    const runner: CommandRunner = (command) => {
      seen.push(command);
      return { status: 0 };
    };
    const dispatched: string[] = [];
    const result = await runCheck(root, {
      commandRunner: runner,
      dispatchFn: async (argv) => {
        dispatched.push(argv[0] ?? "");
        return 0;
      },
    });
    expect(seen).toEqual(["a", "b"]);
    expect(dispatched).toEqual(["state:validate", "verify:encoding"]);
    expect(result).toEqual({ ok: true, code: 0, message: "all checks passed" });
  });

  it("stops at the first failing configured command and names it", async () => {
    const root = writeProject({ quality: { commands: ["a", "b", "c"] } });
    const seen: string[] = [];
    const runner: CommandRunner = (command) => {
      seen.push(command);
      return { status: command === "b" ? 1 : 0 };
    };
    const result = await runCheck(root, {
      commandRunner: runner,
      dispatchFn: fakeDispatch({}),
    });
    expect(seen).toEqual(["a", "b"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.failingStage).toBe("b");
  });

  it("names the failing built-in stage when a configured command runner never spawns a real process", async () => {
    const root = writeProject({ quality: { commands: ["a"] } });
    const result = await runCheck(root, {
      commandRunner: () => ({ status: 0 }),
      dispatchFn: fakeDispatch({ "state:validate": 1 }),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.failingStage).toBe("state:validate");
  });

  it("reports a config error when no commands can be resolved", async () => {
    const root = writeProject();
    const result = await runCheck(root, {
      commandRunner: () => ({ status: 0 }),
      dispatchFn: fakeDispatch({}),
    });
    expect(result).toEqual({ ok: false, code: 2, message: "no commands configured or detected" });
  });
});
