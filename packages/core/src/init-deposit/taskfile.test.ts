import { describe, expect, it } from "vitest";
import { applyTaskfile, CANONICAL_TASKFILE_INCLUDE } from "./taskfile.js";

describe("applyTaskfile", () => {
  it("writes a minimal Taskfile when absent", () => {
    const result = applyTaskfile(null);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(CANONICAL_TASKFILE_INCLUDE);
    expect(result.content).toContain("version: '3'");
  });

  it("is a no-op once the probe string is present", () => {
    const existing =
      "version: '3'\nincludes:\n  canon:\n    taskfile: ./.canonical/core/Taskfile.yml\n    optional: true\n";
    const result = applyTaskfile(existing);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(existing);
  });

  it("inserts the canon child right after an existing includes: line", () => {
    const existing = "version: '3'\n\nincludes:\n  other:\n    taskfile: ./tasks/other.yml\n";
    const result = applyTaskfile(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toContain(CANONICAL_TASKFILE_INCLUDE);
    const lines = result.content.split("\n");
    const includesIdx = lines.indexOf("includes:");
    expect(includesIdx).toBeGreaterThanOrEqual(0);
    expect(lines[includesIdx + 1]).toBe("  canon:");
    // The pre-existing include block is preserved.
    expect(result.content).toContain("other:");
    expect(result.content).toContain("./tasks/other.yml");
  });

  it("appends a fresh includes: block when there is no top-level includes:", () => {
    const existing = "version: '3'\n\ntasks:\n  foo:\n    cmds: [echo hi]\n";
    const result = applyTaskfile(existing);
    expect(result.changed).toBe(true);
    expect(result.content).toContain("includes:");
    expect(result.content).toContain(CANONICAL_TASKFILE_INCLUDE);
    expect(result.content).toContain("foo:");
  });

  it("is idempotent across two applications", () => {
    const first = applyTaskfile(null);
    const second = applyTaskfile(first.content);
    expect(second.changed).toBe(false);
  });
});
