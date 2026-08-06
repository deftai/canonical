import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceItem,
  cleanupTempDirs,
  tempGitRepo,
  writeScopeFixture,
} from "../test-support/index.js";
import { run } from "./swarm-run.js";

afterAll(() => {
  cleanupTempDirs();
});

let out = "";
let err = "";
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  out = "";
  err = "";
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

function readyOverrides(filesScope: readonly string[]) {
  return {
    "x-canonical/kind": "story",
    items: [acceptanceItem("ac1", "one"), acceptanceItem("ac2", "two")],
    "x-canonical/swarm": { filesScope, verifyCommands: ["task check"], readiness: "ready" },
  };
}

describe("canon swarm-run -- stories mode", () => {
  it("exits 0 and prints the manifest for a ready cohort", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyOverrides(["src/foo/"]),
    );
    const code = run(["--project-root", root, a]);
    expect(code).toBe(0);
    expect(existsSync(join(root, ".canonical", "cache", "launch-manifest.json"))).toBe(true);
    expect(JSON.parse(out)).toHaveProperty("stories");
  });

  it("exits 1 and lists violations when not ready", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", {
      "x-canonical/kind": "chore",
    });
    const code = run(["--project-root", root, a]);
    expect(code).toBe(1);
    expect(err).toContain("not ready");
  });

  it("--json on failure emits a machine-readable violation list", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", {
      "x-canonical/kind": "chore",
    });
    const code = run(["--project-root", root, a, "--json"]);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.trim());
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.violations)).toBe(true);
  });

  it("exits 2 with no story paths and no --finalize", () => {
    const root = tempGitRepo({ withBriefs: true });
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
  });
});

describe("canon swarm-run -- finalize mode", () => {
  it("exits 2 when --finalize is given without --manifest", () => {
    const root = tempGitRepo({ withBriefs: true });
    const code = run(["--project-root", root, "--finalize"]);
    expect(code).toBe(2);
  });

  it("finalizes stories from a manifest and prints the finalized scopes", () => {
    const root = tempGitRepo({ withBriefs: true });
    writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", readyOverrides(["src/foo/"]));
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        created: "2026-01-01T00:00:00.000Z",
        stories: [
          {
            story_id: "2026-01-01-a.xbrief.json",
            story_path: "xbrief/active/2026-01-01-a.xbrief.json",
            worktree_path: ".scratch/worktrees/2026-01-01-a",
            base_branch: "main",
          },
        ],
      }),
    );
    const code = run(["--project-root", root, "--finalize", "--manifest", manifestPath]);
    expect(code).toBe(0);
    expect(out).toContain("finalized: xbrief/completed/2026-01-01-a.xbrief.json");
    expect(existsSync(join(root, "xbrief", "completed", "2026-01-01-a.xbrief.json"))).toBe(true);
  });
});
