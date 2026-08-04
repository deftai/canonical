import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { GhSeams } from "../gh/rest.js";
import { cleanupTempDirs, git, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { scopeComplete } from "./complete.js";

afterAll(() => {
  cleanupTempDirs();
});

function status(overrides: Record<string, unknown> = {}) {
  return {
    status: "running",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function auditLines(root: string): unknown[] {
  const raw = readFileSync(join(root, "briefs", "audit.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("scopeComplete", () => {
  it("completes a non-code-bearing scope (kind: epic) with no disposition required", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "epic", plan: status() });

    const result = await scopeComplete(root, { scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: true, status: "completed" });
    expect(() =>
      readFileSync(join(root, "briefs", "completed", "2026-01-01-foo.json")),
    ).not.toThrow();
    expect(auditLines(root)).toContainEqual(
      expect.objectContaining({ kind: "scope-complete", disposition: null }),
    );
  });

  it("a code-bearing scope (kind: story) without --disposition is missing delivery evidence (exit 1)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "story", plan: status() });

    const result = await scopeComplete(root, { scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("rejects an unknown --disposition value (exit 2)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "story", plan: status() });

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "shipped",
    });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });

  it("accepts a story disposition without git evidence (e.g. accepted_not_delivered)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "story", plan: status() });

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "accepted_not_delivered",
    });

    expect(result).toMatchObject({ ok: true, status: "completed" });
    const written = JSON.parse(
      readFileSync(join(root, "briefs", "completed", "2026-01-01-foo.json"), "utf8"),
    );
    expect(written.delivery).toMatchObject({
      disposition: "accepted_not_delivered",
      branch: "main",
    });
  });

  it("delivered + --sha that IS an ancestor of the delivery branch verifies and writes the delivery block", async () => {
    const root = tempGitRepo();
    const sha = git(root, "rev-parse", "HEAD").trim();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "story", plan: status() });

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "delivered",
      sha,
      pr: "https://github.com/acme/widgets/pull/9",
    });

    expect(result).toMatchObject({ ok: true, status: "completed" });
    const written = JSON.parse(
      readFileSync(join(root, "briefs", "completed", "2026-01-01-foo.json"), "utf8"),
    );
    expect(written.delivery).toMatchObject({
      disposition: "delivered",
      sha,
      pr: "https://github.com/acme/widgets/pull/9",
      branch: "main",
    });
  });

  it("delivered + --sha that is NOT an ancestor of the delivery branch fails (exit 1)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", { kind: "story", plan: status() });
    // an orphan commit unrelated to main's history
    git(root, "checkout", "-q", "--orphan", "orphan-branch");
    git(root, "commit", "-q", "--allow-empty", "-m", "orphan");
    const orphanSha = git(root, "rev-parse", "HEAD").trim();
    git(root, "checkout", "-q", "main");

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "delivered",
      sha: orphanSha,
    });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("closes the origin issue via the injected gh client when a gh client can be built", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", {
      kind: "story",
      plan: status(),
      references: [
        { uri: "https://github.com/acme/widgets/issues/42", type: "issue", trust: "external" },
      ],
    });

    const calls: { readonly method: string; readonly url: string; readonly body?: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body });
      return fakeResponse({ id: 1 });
    });
    const ghSeams: GhSeams = {
      env: { GH_TOKEN: "test-token" },
      fetchFn: fetchFn as unknown as typeof fetch,
      exec: () => ({ status: 0, stdout: "https://github.com/acme/widgets.git\n" }),
    };

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "accepted_not_delivered",
      pr: "https://github.com/acme/widgets/pull/9",
      ghSeams,
    });

    expect(result).toMatchObject({ ok: true, status: "completed", issueClosed: true });
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        url: expect.stringContaining("/issues/42/comments"),
      }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        url: expect.stringContaining("/repos/acme/widgets/issues/42"),
      }),
    );
  });

  it("warns to stderr and does not fail when gh cannot be configured (GhConfigError)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", {
      kind: "story",
      plan: status(),
      references: [
        { uri: "https://github.com/acme/widgets/issues/42", type: "issue", trust: "external" },
      ],
    });

    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ghSeams: GhSeams = {
      env: {},
      exec: () => ({ status: 1, stdout: "" }),
    };

    const result = await scopeComplete(root, {
      scope: "2026-01-01-foo.json",
      disposition: "accepted_not_delivered",
      ghSeams,
    });

    expect(result).toMatchObject({ ok: true, status: "completed", issueClosed: false });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("github not configured"));
    warnSpy.mockRestore();
  });

  it("unknown scope id is a config error (exit 2)", async () => {
    const root = tempGitRepo();

    const result = await scopeComplete(root, { scope: "nope.json" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });
});
