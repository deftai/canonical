import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSeams } from "../gh/index.js";
import { run } from "./pr-watch.js";

interface Route {
  readonly status?: number;
  readonly body: unknown;
}

function fakeFetch(routes: Record<string, Route>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const { pathname } = new URL(url);
    const key = `${method} ${pathname}`;
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

const fakeExec: GhSeams["exec"] = (cmd, args) => {
  if (cmd === "git" && args[0] === "remote") {
    return { status: 0, stdout: "https://github.com/acme/widgets.git\n" };
  }
  return { status: 1, stdout: "" };
};

const HEAD_SHA = "abc123";
const CLEAN_ROUTES: Record<string, Route> = {
  "GET /repos/acme/widgets/pulls/1": {
    body: { head: { sha: HEAD_SHA, ref: "feature" }, body: "Fixes #9", mergeable_state: "clean" },
  },
  "GET /repos/acme/widgets/commits/abc123/check-runs": {
    body: { check_runs: [{ status: "completed", conclusion: "success" }] },
  },
  "GET /repos/acme/widgets/commits/abc123/status": { body: { state: "success", total_count: 1 } },
  "GET /repos/acme/widgets/pulls/1/reviews": { body: [] },
};

let outBuf: string;
let errBuf: string;

beforeEach(() => {
  outBuf = "";
  errBuf = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    outBuf += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errBuf += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pr-watch run()", () => {
  it("exits 2 when the PR number is missing", async () => {
    const code = await run([], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
    expect(errBuf).toContain("missing required");
  });

  it("exits 2 on an invalid PR number", async () => {
    const code = await run(["not-a-number"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
    expect(errBuf).toContain("invalid PR number");
  });

  it("exits 2 on an unknown flag", async () => {
    const code = await run(["1", "--bogus"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
  });

  it("exits 2 when there is no origin remote to resolve a repo from", async () => {
    const code = await run(["1"], {
      env: { GH_TOKEN: "t" },
      exec: () => ({ status: 1, stdout: "" }),
    });
    expect(code).toBe(2);
  });

  it("exits 0 and prints CLEAN json when the PR is CLEAN (one-shot)", async () => {
    const code = await run(["1", "--one-shot", "--json"], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(CLEAN_ROUTES),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(outBuf.trim());
    expect(parsed.code).toBe(0);
    expect(parsed.clean).toBe(true);
    expect(parsed.pr).toBe(1);
  });

  it("exits 1 when an un-superseded CHANGES_REQUESTED blocks the PR", async () => {
    const routes: Record<string, Route> = {
      ...CLEAN_ROUTES,
      "GET /repos/acme/widgets/pulls/1/reviews": {
        body: [{ user: { login: "alice" }, state: "CHANGES_REQUESTED", commit_id: HEAD_SHA }],
      },
    };
    const code = await run(["1", "--one-shot"], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(routes),
    });
    expect(code).toBe(1);
  });

  it("exits 2 (one-shot, not clean, no CR) when checks are still pending", async () => {
    const routes: Record<string, Route> = {
      ...CLEAN_ROUTES,
      "GET /repos/acme/widgets/commits/abc123/check-runs": {
        body: { check_runs: [{ status: "in_progress", conclusion: null }] },
      },
    };
    const code = await run(["1", "--one-shot"], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(routes),
    });
    expect(code).toBe(2);
  });

  it("exits 2 on an invalid --timeout", async () => {
    const code = await run(["1", "--timeout=nope"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
  });
});
