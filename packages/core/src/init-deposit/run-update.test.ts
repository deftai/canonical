import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { runInit } from "./run-init.js";
import { runUpdate } from "./run-update.js";

afterAll(() => {
  cleanupTempDirs();
});

describe("runUpdate", () => {
  it("exits 2 when there is no existing deposit", () => {
    const root = tempGitRepo({ withBriefs: false });
    const result = runUpdate(root);
    expect(result.code).toBe(2);
    expect(result.message).toMatch(/canon init/);
  });

  it("re-stamps VERSION with fetched_by: canon-update after a prior init", () => {
    const root = tempGitRepo({ withBriefs: false });
    const init = runInit(root);
    expect(init.code).toBe(0);
    const versionAfterInit = readFileSync(join(root, ".canonical", "core", "VERSION"), "utf8");
    expect(versionAfterInit).toContain("fetched_by: canon-init");

    const update = runUpdate(root);
    expect(update.code).toBe(0);
    const versionAfterUpdate = readFileSync(join(root, ".canonical", "core", "VERSION"), "utf8");
    expect(versionAfterUpdate).toContain("fetched_by: canon-update");

    // Payload content is intact after the swap.
    expect(existsSync(join(root, ".canonical", "core", "canonical.md"))).toBe(true);
    expect(existsSync(join(root, ".canonical", "core", "tasks", "engine.yml"))).toBe(true);
    expect(existsSync(join(root, ".canonical", "core", ".githooks", "pre-push"))).toBe(true);

    // No leftover staging/backup directories.
    expect(existsSync(join(root, ".canonical", "core.staging"))).toBe(false);
    expect(existsSync(join(root, ".canonical", "core.bak"))).toBe(false);
  });

  it("preserves a customized AGENTS.md body outside the managed section across update", () => {
    const root = tempGitRepo({ withBriefs: false });
    runInit(root);
    const withCustomNote = `${readFileSync(join(root, "AGENTS.md"), "utf8")}\n\nCustom team note.\n`;
    writeFileSync(join(root, "AGENTS.md"), withCustomNote);

    const update = runUpdate(root);
    expect(update.code).toBe(0);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Custom team note.");
  });

  it("re-runs idempotently -- a second update reports the deposit as skipped", () => {
    const root = tempGitRepo({ withBriefs: false });
    runInit(root);
    runUpdate(root);
    const second = runUpdate(root);
    expect(second.code).toBe(0);
    expect(second.skipped).toContain(".canonical/core/canonical.md");
  });
});
