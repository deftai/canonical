import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, git, tempGitRepo } from "../test-support/index.js";
import { orient, type ToolProbe } from "./index.js";

afterAll(cleanupTempDirs);

const okProbe = (bin: string): ToolProbe => ({ name: bin, ok: true, detail: `${bin} 1.0.0` });
const brokenProbe = (bin: string): ToolProbe =>
  bin === "git" ? { name: bin, ok: false, detail: "not found" } : okProbe(bin);

describe("orient", () => {
  it("exits 0 ready on a clean repo with xbrief/", () => {
    const root = tempGitRepo();
    const snapshot = orient(root, { probeTool: okProbe });
    expect(snapshot.code).toBe(0);
    expect(snapshot.isGitRepo).toBe(true);
    expect(snapshot.xbriefReadable).toBe(true);
    expect(snapshot.dirty).toBe(false);
  });

  it("exits 1 when xbrief/ is missing", () => {
    const root = tempGitRepo({ withBriefs: false });
    const snapshot = orient(root, { probeTool: okProbe });
    expect(snapshot.code).toBe(1);
    expect(snapshot.message).toContain("xbrief/ not found");
  });

  it("exits 1 when the tree is dirty without --allow-dirty", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "README.md"), "# dirty\n");
    const snapshot = orient(root, { probeTool: okProbe });
    expect(snapshot.code).toBe(1);
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.message).toContain("dirty");
  });

  it("exits 0 when the tree is dirty but --allow-dirty is passed", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "README.md"), "# dirty\n");
    const snapshot = orient(root, { probeTool: okProbe, allowDirty: true });
    expect(snapshot.code).toBe(0);
    expect(snapshot.dirty).toBe(true);
  });

  it("exits 2 when a required tool is broken", () => {
    const root = tempGitRepo();
    const snapshot = orient(root, { probeTool: brokenProbe });
    expect(snapshot.code).toBe(2);
    expect(snapshot.message).toContain("git");
  });

  it("reports the current branch name", () => {
    const root = tempGitRepo({ branch: "main" });
    git(root, "switch", "-c", "feat/orient");
    const snapshot = orient(root, { probeTool: okProbe });
    expect(snapshot.branch).toBe("feat/orient");
  });
});
