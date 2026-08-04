import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveContentRoot } from "./content-root.js";

describe("resolveContentRoot", () => {
  // Single-package model: walk up from this module's directory to the dir
  // whose package.json is named @deftai/canonical (this repo root, or the
  // installed package root -- same layout) and synthesize the payload from
  // content/*, Taskfile.yml, tasks/, .githooks/.
  it("resolves the package root by walking up to the named package.json", () => {
    const payload = resolveContentRoot();
    expect(payload.source).toBe("package");
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
    // A module URL under a location with no @deftai/canonical package.json
    // anywhere above it must fail closed.
    expect(() => resolveContentRoot("file:///")).toThrow(/no package.json named/);
  });
});
