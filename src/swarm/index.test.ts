import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acceptanceItem,
  cleanupTempDirs,
  tempGitRepo,
  writeScopeFixture,
} from "../test-support/index.js";
import { swarmRun } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

function twoItems() {
  return [acceptanceItem("ac1", "does thing one"), acceptanceItem("ac2", "does thing two")];
}

function readyStory(overrides: Record<string, unknown> = {}) {
  return {
    "x-canonical/kind": "story",
    items: twoItems(),
    "x-canonical/swarm": {
      filesScope: ["src/foo/"],
      verifyCommands: ["task check"],
      readiness: "ready",
    },
    ...overrides,
  };
}

describe("swarmRun -- stories readiness", () => {
  it("passes and writes a launch manifest for a ready, disjoint cohort", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", readyStory());
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.xbrief.json",
      readyStory({
        "x-canonical/swarm": {
          filesScope: ["src/bar/"],
          verifyCommands: ["task check"],
          readiness: "ready",
        },
      }),
    );

    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.manifest?.stories).toHaveLength(2);
    expect(result.manifest?.stories[0]).toMatchObject({
      story_id: "2026-01-01-a.xbrief.json",
      story_path: "xbrief/active/2026-01-01-a.xbrief.json",
      worktree_path: ".scratch/worktrees/2026-01-01-a",
    });
    expect(result.manifest?.stories[0]?.base_branch).toBeTypeOf("string");

    const manifestPath = join(root, ".canonical", "cache", "launch-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(onDisk.stories).toHaveLength(2);
    expect(onDisk.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a non-story kind", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({ "x-canonical/kind": "chore" }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('kind must be "story"'))).toBe(true);
  });

  it("rejects empty filesScope", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({
        "x-canonical/swarm": { filesScope: [], verifyCommands: ["task check"], readiness: "ready" },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("filesScope"))).toBe(true);
  });

  it("rejects empty verifyCommands", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({
        "x-canonical/swarm": { filesScope: ["src/foo/"], verifyCommands: [], readiness: "ready" },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("verifyCommands"))).toBe(true);
  });

  it("rejects fewer than 2 acceptance items", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({ items: [acceptanceItem("ac1", "only one")] }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("2-5 acceptance items"))).toBe(true);
  });

  it("rejects more than 5 acceptance items", () => {
    const root = tempGitRepo({ withBriefs: true });
    const items = Array.from({ length: 6 }, (_, i) => acceptanceItem(`ac${i}`, `item ${i}`));
    const p = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", readyStory({ items }));
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("2-5 acceptance items"))).toBe(true);
  });

  it("rejects overlapping filesScope across the cohort (exact match)", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", readyStory());
    const b = writeScopeFixture(root, "active", "2026-01-01-b.xbrief.json", readyStory());
    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("overlaps"))).toBe(true);
  });

  it("rejects overlapping filesScope where one path is a prefix of the other", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({
        "x-canonical/swarm": {
          filesScope: ["src/foo"],
          verifyCommands: ["task check"],
          readiness: "ready",
        },
      }),
    );
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.xbrief.json",
      readyStory({
        "x-canonical/swarm": {
          filesScope: ["src/foo/bar.ts"],
          verifyCommands: ["task check"],
          readiness: "ready",
        },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("overlaps"))).toBe(true);
  });

  it("does not flag sibling directories that merely share a prefix string", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.xbrief.json",
      readyStory({
        "x-canonical/swarm": {
          filesScope: ["src/foo/"],
          verifyCommands: ["task check"],
          readiness: "ready",
        },
      }),
    );
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.xbrief.json",
      readyStory({
        "x-canonical/swarm": {
          filesScope: ["src/foobar/"],
          verifyCommands: ["task check"],
          readiness: "ready",
        },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(0);
  });

  it("errors (2) on an unresolvable story path", () => {
    const root = tempGitRepo({ withBriefs: true });
    const result = swarmRun(root, {
      mode: "stories",
      storyPaths: ["xbrief/active/nope.xbrief.json"],
    });
    expect(result.code).toBe(2);
  });

  it("errors (2) when no story paths are given", () => {
    const root = tempGitRepo({ withBriefs: true });
    const result = swarmRun(root, { mode: "stories", storyPaths: [] });
    expect(result.code).toBe(2);
  });
});

describe("swarmRun -- finalize", () => {
  it("transitions active-folder manifest stories to completed and appends audit rows", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.xbrief.json", readyStory());
    const manifestPath = join(root, ".canonical", "cache", "launch-manifest.json");
    const manifest = {
      created: "2026-01-01T00:00:00.000Z",
      stories: [
        {
          story_id: "2026-01-01-a.xbrief.json",
          story_path: a,
          worktree_path: ".scratch/worktrees/2026-01-01-a",
          base_branch: "main",
        },
      ],
    };
    mkdirSync(join(root, ".canonical", "cache"), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = swarmRun(root, { mode: "finalize", manifestPath });
    expect(result.code).toBe(0);
    expect(result.finalized).toEqual(["xbrief/completed/2026-01-01-a.xbrief.json"]);
    expect(existsSync(join(root, "xbrief", "completed", "2026-01-01-a.xbrief.json"))).toBe(true);
    expect(existsSync(join(root, "xbrief", "active", "2026-01-01-a.xbrief.json"))).toBe(false);

    const audit = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8")
      .trim()
      .split("\n");
    const last = JSON.parse(audit[audit.length - 1] ?? "{}");
    expect(last.kind).toBe("swarm-finalize");
    expect(last.scope).toBe("xbrief/completed/2026-01-01-a.xbrief.json");
  });

  it("skips manifest stories that are no longer in active/", () => {
    const root = tempGitRepo({ withBriefs: true });
    writeScopeFixture(root, "completed", "2026-01-01-a.xbrief.json", {
      ...readyStory(),
      status: "completed",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        created: "2026-01-01T00:00:00.000Z",
        stories: [
          {
            story_id: "2026-01-01-a.xbrief.json",
            story_path: "xbrief/completed/2026-01-01-a.xbrief.json",
            worktree_path: ".scratch/worktrees/2026-01-01-a",
            base_branch: "main",
          },
        ],
      }),
    );
    const result = swarmRun(root, { mode: "finalize", manifestPath });
    expect(result.code).toBe(0);
    expect(result.finalized).toEqual([]);
  });

  it("errors (2) when the manifest file is missing", () => {
    const root = tempGitRepo({ withBriefs: true });
    const result = swarmRun(root, { mode: "finalize", manifestPath: "no-such-manifest.json" });
    expect(result.code).toBe(2);
  });

  it("errors (2) on malformed manifest JSON", () => {
    const root = tempGitRepo({ withBriefs: true });
    const manifestPath = join(root, "bad-manifest.json");
    writeFileSync(manifestPath, "not json");
    const result = swarmRun(root, { mode: "finalize", manifestPath });
    expect(result.code).toBe(2);
  });
});
