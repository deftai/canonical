import { afterAll, describe, expect, it } from "vitest";
import { ghClient } from "../gh/rest.js";
import {
  cleanupTempDirs,
  scaffoldBriefs,
  tempDir,
  writeScopeFixture,
} from "../test-support/index.js";
import { reconcile } from "./reconcile.js";

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

function client(routes: Record<string, Route>) {
  return ghClient({ fetchFn: fakeFetch(routes), env: { GH_TOKEN: "t" } });
}

afterAll(cleanupTempDirs);

describe("reconcile", () => {
  it("reports no drift when everything matches", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "pending", "2026-01-01-a.json", {
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/1",
          type: "issue",
          title: "Issue one",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [{ number: 1, title: "Issue one", state: "open" }],
      },
      "GET /repos/acme/widgets/issues/1": {
        body: { number: 1, title: "Issue one", state: "open" },
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("flags a scope that is non-terminal while its origin issue is closed", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "active", "2026-01-01-a.json", {
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/1",
          type: "issue",
          title: "Issue one",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": { body: [] },
      "GET /repos/acme/widgets/issues/1": {
        body: { number: 1, title: "Issue one", state: "closed" },
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe("closed-issue-open-scope");
  });

  it("does not flag a closed issue when the scope is already terminal", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "completed", "2026-01-01-a.json", {
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/1",
          type: "issue",
          title: "Issue one",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": { body: [] },
      "GET /repos/acme/widgets/issues/1": {
        body: { number: 1, title: "Issue one", state: "closed" },
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(0);
  });

  it("flags an open issue with no corresponding scope", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [{ number: 3, title: "Orphan issue", state: "open" }],
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(1);
    expect(result.findings).toEqual([
      {
        kind: "orphan-open-issue",
        issueNumber: 3,
        message: 'open issue #3 ("Orphan issue") has no scope',
      },
    ]);
  });

  it("filters pull requests out of the open-issues list", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [{ number: 4, title: "A PR", state: "open", pull_request: { url: "x" } }],
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(0);
  });

  it("flags a title drift between the scope's reference and the live issue", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "pending", "2026-01-01-a.json", {
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/1",
          type: "issue",
          title: "Old title",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [{ number: 1, title: "New title", state: "open" }],
      },
      "GET /repos/acme/widgets/issues/1": {
        body: { number: 1, title: "New title", state: "open" },
      },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(1);
    expect(result.findings.some((f) => f.kind === "title-drift")).toBe(true);
  });

  it("returns 2 on API error", async () => {
    const root = tempDir("canon-reconcile-");
    scaffoldBriefs(root);
    const c = ghClient({
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      env: { GH_TOKEN: "t" },
    });
    const result = await reconcile(c, REPO, root);
    expect(result.code).toBe(2);
  });
});
