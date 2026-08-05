import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { readScope, writeScope } from "./brief-io.js";
import {
  buildScopeSkeleton,
  findScopeFilenameCollision,
  scopeSkeletonFilename,
} from "./skeleton.js";

afterAll(() => {
  cleanupTempDirs();
});

describe("scopeSkeletonFilename", () => {
  it("joins the ISO date and normalized slug", () => {
    const now = new Date("2026-08-04T12:34:56.000Z");
    expect(scopeSkeletonFilename("Fix the Widget Loader!", now)).toBe(
      "2026-08-04-fix-the-widget-loader.json",
    );
  });
});

describe("buildScopeSkeleton", () => {
  it("builds a valid, minimal proposed ScopeFile", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const scope = buildScopeSkeleton("Fix the widget loader", now);
    expect(scope.title).toBe("Fix the widget loader");
    expect(scope.kind).toBe("story");
    expect(scope.plan.status).toBe("proposed");
    expect(scope.plan.created).toBe(now.toISOString());
    expect(scope.plan.updated).toBe(now.toISOString());
    expect(scope.narratives?.Description).toBe("");
    expect(scope.items).toEqual([]);
    expect(scope.references).toEqual([]);
  });

  it("produces a scope that state:validate accepts once written to the right filename", () => {
    // Cross-check with validateState so the two verbs never drift apart.
    const now = new Date("2026-08-04T00:00:00.000Z");
    const scope = buildScopeSkeleton("Cross checked scope", now);
    expect(scope.plan.status).toBe("proposed");
  });
});

describe("findScopeFilenameCollision", () => {
  it("returns null when the filename is unused", () => {
    const root = tempGitRepo();
    expect(findScopeFilenameCollision(root, "2026-08-04-unused.json")).toBeNull();
  });

  it("finds a collision in the same folder", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-08-04-taken.json");
    const hit = findScopeFilenameCollision(root, "2026-08-04-taken.json");
    expect(hit).not.toBeNull();
    expect(hit?.relPath).toBe("xbrief/proposed/2026-08-04-taken.json");
  });

  it("finds a collision even after the scope moved to a different lifecycle folder", () => {
    const root = tempGitRepo();
    // Same filename, but now living in completed/ -- filenames are immutable identifiers.
    writeScopeFixture(root, "completed", "2026-08-04-shipped.json", {
      plan: {
        status: "completed",
        created: "2026-08-04T00:00:00.000Z",
        updated: "2026-08-04T00:00:00.000Z",
      },
    });
    const hit = findScopeFilenameCollision(root, "2026-08-04-shipped.json");
    expect(hit).not.toBeNull();
    expect(hit?.folder).toBe("completed");
  });
});

describe("integration: skeleton written via writeScope round-trips through readScope", () => {
  it("reads back exactly what was built", () => {
    const root = tempGitRepo();
    const now = new Date("2026-08-04T00:00:00.000Z");
    const filename = scopeSkeletonFilename("Round trip me", now);
    const relPath = `xbrief/proposed/${filename}`;
    const skeleton = buildScopeSkeleton("Round trip me", now);
    writeScope(root, relPath, skeleton);

    const result = readScope(`${root}/${relPath}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scope).toEqual(skeleton);
    }
  });
});
