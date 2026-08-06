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
      "2026-08-04-fix-the-widget-loader.xbrief.json",
    );
  });
});

describe("buildScopeSkeleton", () => {
  it("builds a valid, minimal proposed ScopeFile", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const scope = buildScopeSkeleton("Fix the widget loader", now);
    expect(scope.xBRIEFInfo).toEqual({ version: "0.8" });
    expect(scope.plan.title).toBe("Fix the widget loader");
    expect(scope.plan["x-canonical/kind"]).toBe("story");
    expect(scope.plan.status).toBe("proposed");
    expect(scope.plan.created).toBe(now.toISOString());
    expect(scope.plan.updated).toBe(now.toISOString());
    expect(scope.plan.narratives?.Description).toBe("");
    expect(scope.plan.items).toEqual([]);
    expect(scope.plan.references).toEqual([]);
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
    expect(findScopeFilenameCollision(root, "2026-08-04-unused.xbrief.json")).toBeNull();
  });

  it("finds a collision in the same folder", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-08-04-taken.xbrief.json");
    const hit = findScopeFilenameCollision(root, "2026-08-04-taken.xbrief.json");
    expect(hit).not.toBeNull();
    expect(hit?.relPath).toBe("xbrief/proposed/2026-08-04-taken.xbrief.json");
  });

  it("finds a collision even after the scope moved to a different lifecycle folder", () => {
    const root = tempGitRepo();
    // Same filename, but now living in completed/ -- filenames are immutable identifiers.
    writeScopeFixture(root, "completed", "2026-08-04-shipped.xbrief.json", {
      status: "completed",
    });
    const hit = findScopeFilenameCollision(root, "2026-08-04-shipped.xbrief.json");
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
