import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { finishPr } from "./finish.js";

interface Route {
  readonly status?: number;
  readonly body: unknown;
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

function fakeFetch(routes: Record<string, Route>, calls: Call[]): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const { pathname } = new URL(url);
    const key = `${method} ${pathname}`;
    calls.push({
      method,
      path: pathname,
      body: init?.body !== undefined ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes[key];
    if (route === undefined) {
      throw new Error(`no fake route for ${key}`);
    }
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(route.body),
    } as Response;
  }) as typeof fetch;
}

const REPO = { owner: "acme", repo: "widgets" };
const HEAD_SHA = "abc123";

function projectRoot(policy: Record<string, unknown> = {}): string {
  const root = tempDir("canon-finish-");
  mkdirSync(join(root, "xbrief"), { recursive: true });
  writeFileSync(
    join(root, "xbrief", "PROJECT.xbrief.json"),
    JSON.stringify({
      xBRIEFInfo: { version: "0.8" },
      plan: { title: "t", status: "running", items: [], "x-canonical/policy": policy },
    }),
  );
  return root;
}

function cleanRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /repos/acme/widgets/pulls/1": {
      body: { head: { sha: HEAD_SHA, ref: "feature" }, body: "Fixes #9", mergeable_state: "clean" },
    },
    "GET /repos/acme/widgets/commits/abc123/check-runs": {
      body: { check_runs: [{ status: "completed", conclusion: "success" }] },
    },
    "GET /repos/acme/widgets/commits/abc123/status": { body: { state: "success", total_count: 1 } },
    "GET /repos/acme/widgets/pulls/1/reviews": { body: [] },
    "PUT /repos/acme/widgets/pulls/1/merge": { body: { merged: true } },
    "DELETE /repos/acme/widgets/git/refs/heads/feature": { body: {} },
    "GET /repos/acme/widgets/issues/9": { body: { state: "open" } },
    "POST /repos/acme/widgets/issues/9/comments": { body: {} },
    "PATCH /repos/acme/widgets/issues/9": { body: {} },
    ...overrides,
  };
}

afterAll(cleanupTempDirs);

describe("finishPr", () => {
  it("merges, deletes the branch, and closes the issue manually when still open", async () => {
    const calls: Call[] = [];
    const seams = { fetchFn: fakeFetch(cleanRoutes(), calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(0);
    expect(result.merged).toBe(true);
    expect(result.issueClosed).toBe(true);

    const sequence = calls.map((c) => `${c.method} ${c.path}`);
    expect(sequence).toContain("PUT /repos/acme/widgets/pulls/1/merge");
    expect(sequence).toContain("DELETE /repos/acme/widgets/git/refs/heads/feature");
    expect(sequence).toContain("GET /repos/acme/widgets/issues/9");
    expect(sequence).toContain("POST /repos/acme/widgets/issues/9/comments");
    expect(sequence).toContain("PATCH /repos/acme/widgets/issues/9");
    // squash merge method asserted on the recorded call body
    const mergeCall = calls.find((c) => c.path === "/repos/acme/widgets/pulls/1/merge");
    expect(mergeCall).toBeDefined();
    expect((mergeCall as Call).body as { merge_method: string }).toEqual({
      merge_method: "squash",
    });
    // issue close comment references the PR
    const commentCall = calls.find((c) => c.path === "/repos/acme/widgets/issues/9/comments");
    expect(commentCall).toBeDefined();
    expect((commentCall as Call).body as { body: string }).toEqual({ body: "Closed by PR #1" });
    const patchCall = calls.find(
      (c) => c.method === "PATCH" && c.path === "/repos/acme/widgets/issues/9",
    );
    expect(patchCall).toBeDefined();
    expect((patchCall as Call).body as { state: string }).toEqual({ state: "closed" });
    // merge happens before delete-ref, which happens before the issue-close verification
    const mergeIdx = sequence.indexOf("PUT /repos/acme/widgets/pulls/1/merge");
    const deleteIdx = sequence.indexOf("DELETE /repos/acme/widgets/git/refs/heads/feature");
    const issueGetIdx = sequence.indexOf("GET /repos/acme/widgets/issues/9");
    expect(mergeIdx).toBeLessThan(deleteIdx);
    expect(deleteIdx).toBeLessThan(issueGetIdx);
  });

  it("does not comment/close when the issue already auto-closed", async () => {
    const calls: Call[] = [];
    const routes = cleanRoutes({
      "GET /repos/acme/widgets/issues/9": { body: { state: "closed" } },
    });
    const seams = { fetchFn: fakeFetch(routes, calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(0);
    expect(result.issueClosed).toBe(true);
    const sequence = calls.map((c) => `${c.method} ${c.path}`);
    expect(sequence).not.toContain("POST /repos/acme/widgets/issues/9/comments");
    expect(sequence).not.toContain("PATCH /repos/acme/widgets/issues/9");
  });

  it("tolerates a failed branch delete and still reports success", async () => {
    const calls: Call[] = [];
    const routes = cleanRoutes({
      "DELETE /repos/acme/widgets/git/refs/heads/feature": {
        status: 422,
        body: { message: "nope" },
      },
    });
    const seams = { fetchFn: fakeFetch(routes, calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(0);
    expect(result.merged).toBe(true);
  });

  it("hands off to a human and does NOT merge when policy.requireHumanMerge is true", async () => {
    const calls: Call[] = [];
    const seams = { fetchFn: fakeFetch(cleanRoutes(), calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: true }));
    expect(result.code).toBe(1);
    expect(result.merged).toBe(false);
    expect(result.message).toContain("human");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("exits 1 when the PR is not CLEAN", async () => {
    const calls: Call[] = [];
    const routes = cleanRoutes({
      "GET /repos/acme/widgets/commits/abc123/status": {
        body: { state: "failure", total_count: 1 },
      },
    });
    const seams = { fetchFn: fakeFetch(routes, calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(1);
    expect(result.merged).toBe(false);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("exits 1 when the branch is not up to date", async () => {
    const calls: Call[] = [];
    const routes = cleanRoutes({
      "GET /repos/acme/widgets/pulls/1": {
        body: {
          head: { sha: HEAD_SHA, ref: "feature" },
          body: "Fixes #9",
          mergeable_state: "behind",
        },
      },
    });
    const seams = { fetchFn: fakeFetch(routes, calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(1);
    expect(result.message).toContain("up to date");
  });

  it("exits 1 when there is no closing keyword in the PR body", async () => {
    const calls: Call[] = [];
    const routes = cleanRoutes({
      "GET /repos/acme/widgets/pulls/1": {
        body: {
          head: { sha: HEAD_SHA, ref: "feature" },
          body: "no keyword here",
          mergeable_state: "clean",
        },
      },
    });
    const seams = { fetchFn: fakeFetch(routes, calls), env: { GH_TOKEN: "t" } };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(1);
    expect(result.message).toContain("closing keyword");
  });

  it("exits 2 on API error", async () => {
    const seams = {
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      env: { GH_TOKEN: "t" },
    };
    const result = await finishPr(seams, REPO, 1, projectRoot({ requireHumanMerge: false }));
    expect(result.code).toBe(2);
  });
});
