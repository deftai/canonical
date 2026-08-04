import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveContentRoot } from "./content-root.js";

describe("resolveContentRoot", () => {
  // In this workspace, @canonpack/core has no dependency on @canonpack/content
  // (pnpm-isolated), so resolution always falls through to the source-layout
  // fallback: walk up from this module's directory to the dir containing
  // pnpm-workspace.yaml (present at THIS worktree's root) and synthesize the
  // payload from content/*, Taskfile.yml, tasks/, .githooks/.
  it("falls back to the workspace source layout", () => {
    const payload = resolveContentRoot();
    expect(payload.source).toBe("workspace-fallback");
    expect(payload.entries.length).toBeGreaterThan(0);
  });

  it("includes every content/*.md rule file at the deposit root", () => {
    const payload = resolveContentRoot();
    const relPaths = payload.entries.map((e) => e.relPath);
    for (const md of [
      "canonical.md",
      "canonical-tasks.md",
      "engineering.md",
      "multi-agent.md",
      "scm.md",
      "state.md",
    ]) {
      expect(relPaths).toContain(md);
    }
  });

  it("includes Taskfile.yml, tasks/*, and .githooks/* with nested rel paths", () => {
    const payload = resolveContentRoot();
    const relPaths = payload.entries.map((e) => e.relPath);
    expect(relPaths).toContain("Taskfile.yml");
    expect(relPaths.some((p) => p.startsWith("tasks/"))).toBe(true);
    expect(relPaths.some((p) => p.startsWith(".githooks/"))).toBe(true);
    expect(relPaths).toContain(".githooks/pre-commit");
    expect(relPaths).toContain(".githooks/pre-push");
  });

  it("every entry's absPath exists and relPath uses POSIX separators", () => {
    const payload = resolveContentRoot();
    for (const entry of payload.entries) {
      expect(entry.relPath).not.toContain("\\");
      expect(() => {
        // Reading confirms absPath is a real, readable file.
        readFileSync(entry.absPath, "utf8");
      }).not.toThrow();
    }
  });

  it("throws a ContentRootResolutionError-shaped error when nothing resolves", () => {
    // A module URL under a location with no pnpm-workspace.yaml anywhere
    // above it (and no @canonpack/content dependency) must fail closed.
    expect(() => resolveContentRoot("file:///")).toThrow(/could not resolve/);
  });
});
