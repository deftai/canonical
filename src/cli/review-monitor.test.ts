import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run } from "./review-monitor.js";

afterAll(() => {
  cleanupTempDirs();
});

let out = "";
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  out = "";
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("canon review-monitor", () => {
  it("requires a register|release|check action", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(run(["--project-root", root])).toBe(2);
  });

  it("requires --pr", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(run(["check", "--project-root", root])).toBe(2);
  });

  it("register requires --owner", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(run(["register", "--pr", "7", "--project-root", root])).toBe(2);
  });

  it("register -> check reports 0 and prints the owner", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(run(["register", "--pr", "7", "--owner", "alice", "--project-root", root])).toBe(0);
    out = "";
    const code = run(["check", "--pr", "7", "--project-root", root]);
    expect(code).toBe(0);
    expect(out).toContain("alice");
  });

  it("check reports 1 when no lease is registered", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(run(["check", "--pr", "8", "--project-root", root])).toBe(1);
  });

  it("release then check reports 1", () => {
    const root = tempGitRepo({ withBriefs: false });
    run(["register", "--pr", "9", "--owner", "alice", "--project-root", root]);
    expect(run(["release", "--pr", "9", "--project-root", root])).toBe(0);
    expect(run(["check", "--pr", "9", "--project-root", root])).toBe(1);
  });

  it("--json check emits {active, owner}", () => {
    const root = tempGitRepo({ withBriefs: false });
    run(["register", "--pr", "10", "--owner", "alice", "--project-root", root]);
    out = "";
    run(["check", "--pr", "10", "--project-root", root, "--json"]);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({ active: true, owner: "alice" });
  });
});
