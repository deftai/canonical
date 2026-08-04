import { describe, expect, it } from "vitest";
import { ghClient } from "../gh/rest.js";
import { evaluateClean } from "./clean.js";

/** Route-map fake fetch: "METHOD /path" -> {status, body}. No live network ever. */
interface Route {
  readonly status?: number;
  readonly body: unknown;
}

function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const { pathname, search } = new URL(url);
    const key = `${method} ${pathname}${search}`;
    const route = routes[key] ?? routes[`${method} ${pathname}`];
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

function client(routes: Record<string, Route>) {
  return ghClient({ fetchFn: fakeFetch(routes), env: { GH_TOKEN: "t" } });
}

function baseRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /repos/acme/widgets/pulls/1": {
      body: { head: { sha: HEAD_SHA, ref: "feature" }, body: "Fixes #9", mergeable_state: "clean" },
    },
    "GET /repos/acme/widgets/commits/abc123/check-runs": {
      body: { check_runs: [{ status: "completed", conclusion: "success", name: "build" }] },
    },
    "GET /repos/acme/widgets/commits/abc123/status": {
      body: { state: "success", total_count: 1 },
    },
    "GET /repos/acme/widgets/pulls/1/reviews": { body: [] },
    ...overrides,
  };
}

describe("evaluateClean", () => {
  it("is CLEAN when checks pass, status succeeds, and there are no reviews", async () => {
    const result = await evaluateClean(client(baseRoutes()), REPO, 1);
    expect(result.clean).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.headSha).toBe(HEAD_SHA);
    expect(result.closingKeywordPresent).toBe(true);
    expect(result.upToDate).toBe(true);
  });

  it("is not CLEAN when a check run is not completed", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/check-runs": {
        body: { check_runs: [{ status: "in_progress", conclusion: null, name: "build" }] },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => r.includes("not completed"))).toBe(true);
  });

  it("is not CLEAN when a completed check run failed", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/check-runs": {
        body: { check_runs: [{ status: "completed", conclusion: "failure", name: "build" }] },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => r.includes("check run failed"))).toBe(true);
  });

  it("treats neutral and skipped conclusions as passing", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/check-runs": {
        body: {
          check_runs: [
            { status: "completed", conclusion: "neutral", name: "a" },
            { status: "completed", conclusion: "skipped", name: "b" },
          ],
        },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(true);
  });

  it("treats pending combined status with zero statuses as none (not blocking)", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/status": {
        body: { state: "pending", total_count: 0 },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(true);
  });

  it("is not CLEAN when combined status is pending with outstanding statuses", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/status": {
        body: { state: "pending", total_count: 2 },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => r.includes("combined status"))).toBe(true);
  });

  it("is not CLEAN when combined status failed", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/commits/abc123/status": {
        body: { state: "failure", total_count: 1 },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
  });

  it("is CLEAN with an APPROVED review on the current head SHA", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [{ user: { login: "alice" }, state: "APPROVED", commit_id: HEAD_SHA }],
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(true);
  });

  it("is not CLEAN with an un-superseded CHANGES_REQUESTED review", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [{ user: { login: "alice" }, state: "CHANGES_REQUESTED", commit_id: HEAD_SHA }],
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => r.startsWith("changes-requested:"))).toBe(true);
  });

  it("supersedes CHANGES_REQUESTED with a later APPROVED from the same reviewer", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [
          { user: { login: "alice" }, state: "CHANGES_REQUESTED", commit_id: "old-sha" },
          { user: { login: "alice" }, state: "APPROVED", commit_id: HEAD_SHA },
        ],
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(true);
  });

  it("supersedes CHANGES_REQUESTED that was itself dismissed", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [{ user: { login: "alice" }, state: "DISMISSED", commit_id: "old-sha" }],
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    // DISMISSED alone (no review on head) still fails the head-review-presence rule,
    // but must NOT be reported as an outstanding changes-requested reason.
    expect(result.reasons.some((r) => r.startsWith("changes-requested:"))).toBe(false);
  });

  it("requires at least one review on the current head SHA when reviews exist", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [{ user: { login: "alice" }, state: "APPROVED", commit_id: "stale-sha" }],
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.clean).toBe(false);
    expect(result.reasons.some((r) => r.includes("no review present for current head SHA"))).toBe(
      true,
    );
  });

  it("reports closingKeywordPresent false when the body has no closing keyword", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1": {
        body: {
          head: { sha: HEAD_SHA, ref: "feature" },
          body: "just a description",
          mergeable_state: "clean",
        },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.closingKeywordPresent).toBe(false);
  });

  it("reports upToDate false when mergeable_state is behind", async () => {
    const routes = baseRoutes({
      "GET /repos/acme/widgets/pulls/1": {
        body: {
          head: { sha: HEAD_SHA, ref: "feature" },
          body: "Fixes #9",
          mergeable_state: "behind",
        },
      },
    });
    const result = await evaluateClean(client(routes), REPO, 1);
    expect(result.upToDate).toBe(false);
  });
});
