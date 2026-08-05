import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { swarmRun } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

function twoItems() {
  return [
    { id: "ac1", text: "does thing one", done: false },
    { id: "ac2", text: "does thing two", done: false },
  ];
}

function readyStory(overrides: Record<string, unknown> = {}) {
  return {
    kind: "story",
    items: twoItems(),
    swarm: {
      file_scope: ["src/foo/"],
      verify_commands: ["task check"],
      readiness: "ready",
    },
    ...overrides,
  };
}

describe("swarmRun -- stories readiness", () => {
  it("passes and writes a launch manifest for a ready, disjoint cohort", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.json", readyStory());
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.json",
      readyStory({
        swarm: { file_scope: ["src/bar/"], verify_commands: ["task check"], readiness: "ready" },
      }),
    );

    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.manifest?.stories).toHaveLength(2);
    expect(result.manifest?.stories[0]).toMatchObject({
      story_id: "2026-01-01-a.json",
      story_path: "xbrief/active/2026-01-01-a.json",
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
    const p = writeScopeFixture(root, "active", "2026-01-01-a.json", readyStory({ kind: "chore" }));
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('kind must be "story"'))).toBe(true);
  });

  it("rejects empty file_scope", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.json",
      readyStory({
        swarm: { file_scope: [], verify_commands: ["task check"], readiness: "ready" },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("file_scope"))).toBe(true);
  });

  it("rejects empty verify_commands", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.json",
      readyStory({ swarm: { file_scope: ["src/foo/"], verify_commands: [], readiness: "ready" } }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("verify_commands"))).toBe(true);
  });

  it("rejects fewer than 2 acceptance items", () => {
    const root = tempGitRepo({ withBriefs: true });
    const p = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.json",
      readyStory({ items: [{ id: "ac1", text: "only one", done: false }] }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("2-5 acceptance items"))).toBe(true);
  });

  it("rejects more than 5 acceptance items", () => {
    const root = tempGitRepo({ withBriefs: true });
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `ac${i}`,
      text: `item ${i}`,
      done: false,
    }));
    const p = writeScopeFixture(root, "active", "2026-01-01-a.json", readyStory({ items }));
    const result = swarmRun(root, { mode: "stories", storyPaths: [p] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("2-5 acceptance items"))).toBe(true);
  });

  it("rejects overlapping file_scope across the cohort (exact match)", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(root, "active", "2026-01-01-a.json", readyStory());
    const b = writeScopeFixture(root, "active", "2026-01-01-b.json", readyStory());
    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("overlaps"))).toBe(true);
  });

  it("rejects overlapping file_scope where one path is a prefix of the other", () => {
    const root = tempGitRepo({ withBriefs: true });
    const a = writeScopeFixture(
      root,
      "active",
      "2026-01-01-a.json",
      readyStory({
        swarm: { file_scope: ["src/foo"], verify_commands: ["task check"], readiness: "ready" },
      }),
    );
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.json",
      readyStory({
        swarm: {
          file_scope: ["src/foo/bar.ts"],
          verify_commands: ["task check"],
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
      "2026-01-01-a.json",
      readyStory({
        swarm: { file_scope: ["src/foo/"], verify_commands: ["task check"], readiness: "ready" },
      }),
    );
    const b = writeScopeFixture(
      root,
      "active",
      "2026-01-01-b.json",
      readyStory({
        swarm: { file_scope: ["src/foobar/"], verify_commands: ["task check"], readiness: "ready" },
      }),
    );
    const result = swarmRun(root, { mode: "stories", storyPaths: [a, b] });
    expect(result.code).toBe(0);
  });

  it("errors (2) on an unresolvable story path", () => {
    const root = tempGitRepo({ withBriefs: true });
    const result = swarmRun(root, { mode: "stories", storyPaths: ["xbrief/active/nope.json"] });
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
    const a = writeScopeFixture(root, "active", "2026-01-01-a.json", readyStory());
    const manifestPath = join(root, ".canonical", "cache", "launch-manifest.json");
    const manifest = {
      created: "2026-01-01T00:00:00.000Z",
      stories: [
        {
          story_id: "2026-01-01-a.json",
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
    expect(result.finalized).toEqual(["xbrief/completed/2026-01-01-a.json"]);
    expect(existsSync(join(root, "xbrief", "completed", "2026-01-01-a.json"))).toBe(true);
    expect(existsSync(join(root, "xbrief", "active", "2026-01-01-a.json"))).toBe(false);

    const audit = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8")
      .trim()
      .split("\n");
    const last = JSON.parse(audit[audit.length - 1] ?? "{}");
    expect(last.kind).toBe("swarm-finalize");
    expect(last.scope).toBe("xbrief/completed/2026-01-01-a.json");
  });

  it("skips manifest stories that are no longer in active/", () => {
    const root = tempGitRepo({ withBriefs: true });
    writeScopeFixture(root, "completed", "2026-01-01-a.json", {
      ...readyStory(),
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const manifestPath = join(root, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        created: "2026-01-01T00:00:00.000Z",
        stories: [
          {
            story_id: "2026-01-01-a.json",
            story_path: "xbrief/completed/2026-01-01-a.json",
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
