import { describe, expect, it } from "vitest";
import { ghClient } from "../gh/rest.js";
import { watchPr } from "./watch.js";

/** Route-map fake fetch: "METHOD /path" -> {status, body}[]. Each call to the same
 * route pops the next entry (or repeats the last) so polling can be simulated. */
interface Route {
  readonly status?: number;
  readonly body: unknown;
}

function fakeFetch(sequences: Record<string, readonly Route[]>): typeof fetch {
  const cursors: Record<string, number> = {};
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const { pathname } = new URL(url);
    const key = `${method} ${pathname}`;
    const seq = sequences[key];
    if (seq === undefined || seq.length === 0) {
      throw new Error(`no fake route for ${key}`);
    }
    const idx = cursors[key] ?? 0;
    const route = seq[Math.min(idx, seq.length - 1)];
    cursors[key] = idx + 1;
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

function client(sequences: Record<string, readonly Route[]>) {
  return ghClient({ fetchFn: fakeFetch(sequences), env: { GH_TOKEN: "t" } });
}

function pr(overrides: Record<string, unknown> = {}) {
  return {
    head: { sha: HEAD_SHA, ref: "feature" },
    body: "Fixes #9",
    mergeable_state: "clean",
    ...overrides,
  };
}

const CLEAN_CHECK_RUNS = { check_runs: [{ status: "completed", conclusion: "success" }] };
const CLEAN_STATUS = { state: "success", total_count: 1 };

describe("watchPr", () => {
  it("returns 0 immediately when the PR is already CLEAN (one-shot)", async () => {
    const c = client({
      "GET /repos/acme/widgets/pulls/1": [{ body: pr() }],
      "GET /repos/acme/widgets/commits/abc123/check-runs": [{ body: CLEAN_CHECK_RUNS }],
      "GET /repos/acme/widgets/commits/abc123/status": [{ body: CLEAN_STATUS }],
      "GET /repos/acme/widgets/pulls/1/reviews": [{ body: [] }],
    });
    const result = await watchPr(c, REPO, 1, { oneShot: true });
    expect(result.code).toBe(0);
  });

  it("returns 1 when an un-superseded CHANGES_REQUESTED is present on current head", async () => {
    const c = client({
      "GET /repos/acme/widgets/pulls/1": [{ body: pr() }],
      "GET /repos/acme/widgets/commits/abc123/check-runs": [{ body: CLEAN_CHECK_RUNS }],
      "GET /repos/acme/widgets/commits/abc123/status": [{ body: CLEAN_STATUS }],
      "GET /repos/acme/widgets/pulls/1/reviews": [
        { body: [{ user: { login: "alice" }, state: "CHANGES_REQUESTED", commit_id: HEAD_SHA }] },
      ],
    });
    const result = await watchPr(c, REPO, 1, { oneShot: true });
    expect(result.code).toBe(1);
    expect(result.message).toContain("CHANGES_REQUESTED");
  });

  it("one-shot returns 2 when not clean and no CHANGES_REQUESTED (e.g. checks pending)", async () => {
    const c = client({
      "GET /repos/acme/widgets/pulls/1": [{ body: pr() }],
      "GET /repos/acme/widgets/commits/abc123/check-runs": [
        { body: { check_runs: [{ status: "in_progress", conclusion: null }] } },
      ],
      "GET /repos/acme/widgets/commits/abc123/status": [{ body: CLEAN_STATUS }],
      "GET /repos/acme/widgets/pulls/1/reviews": [{ body: [] }],
    });
    const result = await watchPr(c, REPO, 1, { oneShot: true });
    expect(result.code).toBe(2);
  });

  it("polls (injected sleep/clock) until CLEAN, then returns 0", async () => {
    const c = client({
      "GET /repos/acme/widgets/pulls/1": [{ body: pr() }],
      "GET /repos/acme/widgets/commits/abc123/check-runs": [
        { body: { check_runs: [{ status: "in_progress", conclusion: null }] } },
        { body: { check_runs: [{ status: "in_progress", conclusion: null }] } },
        { body: CLEAN_CHECK_RUNS },
      ],
      "GET /repos/acme/widgets/commits/abc123/status": [{ body: CLEAN_STATUS }],
      "GET /repos/acme/widgets/pulls/1/reviews": [{ body: [] }],
    });
    let sleeps = 0;
    let clock = 0;
    const result = await watchPr(c, REPO, 1, {
      pollMs: 1000,
      timeoutMs: 60_000,
      sleep: async () => {
        sleeps++;
        clock += 1000;
      },
      now: () => clock,
    });
    expect(result.code).toBe(0);
    expect(sleeps).toBe(2);
  });

  it("times out (2) when the PR never reaches CLEAN and the clock exceeds the budget", async () => {
    const c = client({
      "GET /repos/acme/widgets/pulls/1": [{ body: pr() }],
      "GET /repos/acme/widgets/commits/abc123/check-runs": [
        { body: { check_runs: [{ status: "in_progress", conclusion: null }] } },
      ],
      "GET /repos/acme/widgets/commits/abc123/status": [{ body: CLEAN_STATUS }],
      "GET /repos/acme/widgets/pulls/1/reviews": [{ body: [] }],
    });
    let clock = 0;
    const result = await watchPr(c, REPO, 1, {
      pollMs: 1000,
      timeoutMs: 2500,
      sleep: async () => {
        clock += 1000;
      },
      now: () => clock,
    });
    expect(result.code).toBe(2);
    expect(result.message).toContain("timeout");
  });

  it("returns 2 on API error", async () => {
    const c = ghClient({
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      env: { GH_TOKEN: "t" },
    });
    const result = await watchPr(c, REPO, 1, { oneShot: true });
    expect(result.code).toBe(2);
    expect(result.message).toContain("API error");
  });
});
