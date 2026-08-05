import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { workNext } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

function writePlan(root: string, value: unknown): void {
  mkdirSync(join(root, "xbrief"), { recursive: true });
  writeFileSync(join(root, "xbrief", "plan.json"), JSON.stringify(value, null, 2));
}

describe("workNext", () => {
  it("returns empty when xbrief/ has no plan.json and no pending scopes", () => {
    const root = tempGitRepo();
    const result = workNext(root);
    expect(result.kind).toBe("empty");
  });

  it("follows plan.json's sequence and returns the first non-terminal entry", () => {
    const root = tempGitRepo();
    const doneRel = writeScopeFixture(root, "completed", "2026-01-01-done.json", {
      title: "Already done",
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const nextRel = writeScopeFixture(root, "pending", "2026-01-02-next.json", {
      title: "Do this next",
      plan: {
        status: "pending",
        created: "2026-01-02T00:00:00.000Z",
        updated: "2026-01-02T00:00:00.000Z",
      },
    });
    writePlan(root, { sequence: [doneRel, nextRel] });

    const result = workNext(root);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.item.relPath).toBe(nextRel);
      expect(result.item.title).toBe("Do this next");
    }
  });

  it("returns empty when every sequence entry is already terminal (does not fall back to pending/)", () => {
    const root = tempGitRepo();
    const doneRel = writeScopeFixture(root, "completed", "2026-01-01-done.json", {
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    // A pending scope exists, but the sequence branch governs exclusively once present.
    writeScopeFixture(root, "pending", "2026-01-02-ignored.json");
    writePlan(root, { sequence: [doneRel] });

    const result = workNext(root);
    expect(result.kind).toBe("empty");
  });

  it("errors when plan.json is not valid JSON", () => {
    const root = tempGitRepo();
    mkdirSync(join(root, "xbrief"), { recursive: true });
    writeFileSync(join(root, "xbrief", "plan.json"), "{ not json");
    const result = workNext(root);
    expect(result.kind).toBe("error");
  });

  it("errors when plan.sequence is present but not an array of strings", () => {
    const root = tempGitRepo();
    writePlan(root, { sequence: "not-an-array" });
    const result = workNext(root);
    expect(result.kind).toBe("error");
  });

  it("errors when a sequence entry points at unparsable JSON", () => {
    const root = tempGitRepo();
    mkdirSync(join(root, "xbrief", "pending"), { recursive: true });
    writeFileSync(join(root, "xbrief", "pending", "2026-01-01-broken.json"), "{ not json");
    writePlan(root, { sequence: ["xbrief/pending/2026-01-01-broken.json"] });
    const result = workNext(root);
    expect(result.kind).toBe("error");
  });

  it("falls back to ranking xbrief/pending/*.json when plan.json has no sequence field", () => {
    const root = tempGitRepo();
    writePlan(root, { title: "no sequence here" });
    const older = writeScopeFixture(root, "pending", "2026-01-01-older.json", {
      title: "older",
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "pending", "2026-01-05-newer.json", {
      title: "newer",
      plan: {
        status: "pending",
        created: "2026-01-05T00:00:00.000Z",
        updated: "2026-01-05T00:00:00.000Z",
      },
    });

    const result = workNext(root);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.item.relPath).toBe(older);
    }
  });

  it("ranks pending scopes with satisfied dependencies before unsatisfied ones, regardless of age", () => {
    const root = tempGitRepo();
    const depRel = writeScopeFixture(root, "completed", "2026-01-01-dependency.json", {
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const depFilename = depRel.split("/").pop();
    if (depFilename === undefined) {
      throw new Error("unreachable");
    }

    // Blocked is OLDER but its dependency is not completed.
    writeScopeFixture(root, "pending", "2026-01-02-blocked.json", {
      title: "blocked on dependency",
      plan: {
        status: "pending",
        created: "2026-01-02T00:00:00.000Z",
        updated: "2026-01-02T00:00:00.000Z",
      },
      dependencies: ["2026-01-09-missing-dependency.json"],
    });
    // Ready is NEWER but its dependency is already completed.
    const readyRel = writeScopeFixture(root, "pending", "2026-01-09-ready.json", {
      title: "ready to go",
      plan: {
        status: "pending",
        created: "2026-01-09T00:00:00.000Z",
        updated: "2026-01-09T00:00:00.000Z",
      },
      dependencies: [depFilename],
    });

    const result = workNext(root);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.item.relPath).toBe(readyRel);
    }
  });

  it("treats a dependency on an incomplete (non-completed) scope as unsatisfied", () => {
    const root = tempGitRepo();
    const depRel = writeScopeFixture(root, "active", "2026-01-01-in-progress.json", {
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const depFilename = depRel.split("/").pop();
    if (depFilename === undefined) {
      throw new Error("unreachable");
    }

    writeScopeFixture(root, "pending", "2026-01-02-waiting.json", {
      title: "waiting",
      plan: {
        status: "pending",
        created: "2026-01-02T00:00:00.000Z",
        updated: "2026-01-02T00:00:00.000Z",
      },
      dependencies: [depFilename],
    });
    const freeRel = writeScopeFixture(root, "pending", "2026-01-03-free.json", {
      title: "free",
      plan: {
        status: "pending",
        created: "2026-01-03T00:00:00.000Z",
        updated: "2026-01-03T00:00:00.000Z",
      },
    });

    const result = workNext(root);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.item.relPath).toBe(freeRel);
    }
  });

  it("errors when a pending scope file is unparsable", () => {
    const root = tempGitRepo();
    mkdirSync(join(root, "xbrief", "pending"), { recursive: true });
    writeFileSync(join(root, "xbrief", "pending", "2026-01-01-broken.json"), "{ not json");
    const result = workNext(root);
    expect(result.kind).toBe("error");
  });
});
