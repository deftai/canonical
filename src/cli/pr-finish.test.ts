import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSeams } from "../gh/index.js";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { run } from "./pr-finish.js";

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
  "PUT /repos/acme/widgets/pulls/1/merge": { body: { merged: true } },
  "DELETE /repos/acme/widgets/git/refs/heads/feature": { body: {} },
  "GET /repos/acme/widgets/issues/9": { body: { state: "closed" } },
};

function projectRoot(policy: Record<string, unknown>): string {
  const root = tempDir("canon-pr-finish-cli-");
  mkdirSync(join(root, "xbrief"), { recursive: true });
  writeFileSync(join(root, "xbrief", "PROJECT.json"), JSON.stringify({ title: "t", policy }));
  return root;
}

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

afterAll(cleanupTempDirs);

describe("pr-finish run()", () => {
  it("exits 2 when the PR number is missing", async () => {
    const code = await run([], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
    expect(errBuf).toContain("missing required");
  });

  it("exits 2 on an invalid PR number", async () => {
    const code = await run(["nope"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
  });

  it("merges and reports issue-closed when policy allows agent merge", async () => {
    const root = projectRoot({ requireHumanMerge: false });
    const code = await run(["1", `--project-root=${root}`, "--json"], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(CLEAN_ROUTES),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(outBuf.trim());
    expect(parsed.merged).toBe(true);
    expect(parsed.issue_closed).toBe(true);
  });

  it("hands off to a human (exit 1, no merge) when policy.requireHumanMerge is true", async () => {
    const root = projectRoot({ requireHumanMerge: true });
    const code = await run(["1", `--project-root=${root}`], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(CLEAN_ROUTES),
    });
    expect(code).toBe(1);
    expect(outBuf).toContain("human");
  });

  it("exits 1 when the PR is not CLEAN", async () => {
    const root = projectRoot({ requireHumanMerge: false });
    const routes: Record<string, Route> = {
      ...CLEAN_ROUTES,
      "GET /repos/acme/widgets/commits/abc123/status": {
        body: { state: "failure", total_count: 1 },
      },
    };
    const code = await run(["1", `--project-root=${root}`], {
      env: { GH_TOKEN: "t" },
      exec: fakeExec,
      fetchFn: fakeFetch(routes),
    });
    expect(code).toBe(1);
  });
});
