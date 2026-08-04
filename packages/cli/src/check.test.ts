import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "@canonpack/core/test-support";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./check.js";

afterAll(() => {
  cleanupTempDirs();
});

function writeProject(overrides: Record<string, unknown> = {}): string {
  const root = tempDir("cli-check-test-");
  mkdirSync(join(root, "briefs"), { recursive: true });
  writeFileSync(
    join(root, "briefs", "PROJECT.json"),
    `${JSON.stringify({ title: "t", policy: {}, ...overrides }, null, 2)}\n`,
  );
  return root;
}

let outBuf: string[];
let errBuf: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  outBuf = [];
  errBuf = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    outBuf.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errBuf.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("canon check", () => {
  it("reports exit 2 with 'no commands configured or detected' for an empty project", async () => {
    const root = writeProject();
    const code = await run(["--project-root", root]);
    expect(code).toBe(2);
    expect(errBuf.join("")).toContain("no commands configured or detected");
  });

  it("--json prints a one-line, key-sorted payload to stdout on config error", async () => {
    const root = writeProject();
    const code = await run(["--project-root", root, "--json"]);
    expect(code).toBe(2);
    expect(errBuf.join("")).toBe("");
    const line = outBuf.join("").trim();
    expect(line.split("\n")).toHaveLength(1);
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      code: 2,
      failing_stage: null,
      message: "no commands configured or detected",
      ok: false,
    });
  });

  it("wires the built-in stages through the real dispatcher (state:validate stub reports exit 1, naming the stage)", async () => {
    // "true" is a portable no-op binary, not a package manager -- exercising the
    // real dispatch seam for the built-in stages without spawning any toolchain.
    const root = writeProject({ quality: { commands: ["true"] } });
    const code = await run(["--project-root", root, "--json"]);
    // state:validate is still an unimplemented stub in this stream slice, so the
    // real dispatcher reports it as the failing stage rather than a fake one.
    expect(code).toBe(1);
    const parsed = JSON.parse(outBuf.join("").trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.failing_stage).toBe("state:validate");
  });
});
