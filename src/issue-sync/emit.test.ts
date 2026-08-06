import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ghClient } from "../gh/rest.js";
import {
  cleanupTempDirs,
  scaffoldXbrief,
  tempDir,
  writeScopeFixture,
} from "../test-support/index.js";
import { emit } from "./emit.js";

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

afterAll(cleanupTempDirs);

describe("emit", () => {
  it("PATCHes the existing issue when the scope already has an issue reference", async () => {
    const root = tempDir("canon-emit-");
    scaffoldXbrief(root);
    const rel = writeScopeFixture(root, "pending", "2026-01-01-my-scope.xbrief.json", {
      title: "Updated title",
      narratives: { Description: "Updated body" },
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/12",
          type: "x-xbrief/github-issue",
          title: "old",
          "x-canonical/trust": "external",
        },
      ],
    });
    const calls: Call[] = [];
    const c = ghClient({
      fetchFn: fakeFetch({ "PATCH /repos/acme/widgets/issues/12": { body: {} } }, calls),
      env: { GH_TOKEN: "t" },
    });
    const result = await emit(c, REPO, root, "2026-01-01-my-scope.xbrief.json");
    expect(result.code).toBe(0);
    expect(result.created).toBe(false);
    expect(result.issueNumber).toBe(12);
    const patchCall = calls.find((call) => call.method === "PATCH");
    expect(patchCall?.body).toEqual({ title: "Updated title", body: "Updated body" });
    // scope file untouched by the PATCH path
    const scope = JSON.parse(readFileSync(join(root, rel), "utf8"));
    expect(scope.plan.title).toBe("Updated title");
  });

  it("POSTs a new issue and appends the reference + Origin when the scope has none", async () => {
    const root = tempDir("canon-emit-");
    scaffoldXbrief(root);
    const rel = writeScopeFixture(root, "pending", "2026-01-01-no-issue.xbrief.json", {
      title: "Needs an issue",
      narratives: { Description: "Body text" },
      references: [],
    });
    const calls: Call[] = [];
    const c = ghClient({
      fetchFn: fakeFetch(
        {
          "POST /repos/acme/widgets/issues": {
            body: { number: 42, html_url: "https://github.com/acme/widgets/issues/42" },
          },
        },
        calls,
      ),
      env: { GH_TOKEN: "t" },
    });
    const result = await emit(c, REPO, root, "2026-01-01-no-issue.xbrief.json");
    expect(result.code).toBe(0);
    expect(result.created).toBe(true);
    expect(result.issueNumber).toBe(42);

    const postCall = calls.find((call) => call.method === "POST");
    expect(postCall?.body).toEqual({ title: "Needs an issue", body: "Body text" });

    const scope = JSON.parse(readFileSync(join(root, rel), "utf8"));
    expect(scope.plan.references).toEqual([
      {
        uri: "https://github.com/acme/widgets/issues/42",
        type: "x-xbrief/github-issue",
        title: "Needs an issue",
        "x-canonical/trust": "external",
      },
    ]);
    expect(scope.plan.narratives.Origin).toBe("Emitted to issue #42");
    // round trip: emitting again now patches instead of creating another issue
    const calls2: Call[] = [];
    const c2 = ghClient({
      fetchFn: fakeFetch({ "PATCH /repos/acme/widgets/issues/42": { body: {} } }, calls2),
      env: { GH_TOKEN: "t" },
    });
    const second = await emit(c2, REPO, root, "2026-01-01-no-issue.xbrief.json");
    expect(second.code).toBe(0);
    expect(second.created).toBe(false);
    expect(second.issueNumber).toBe(42);
  });

  it("returns 2 when the scope cannot be found", async () => {
    const root = tempDir("canon-emit-");
    scaffoldXbrief(root);
    const c = ghClient({ fetchFn: fakeFetch({}, []), env: { GH_TOKEN: "t" } });
    const result = await emit(c, REPO, root, "nonexistent.json");
    expect(result.code).toBe(2);
    expect(result.message).toContain("not found");
  });

  it("returns 2 on API error", async () => {
    const root = tempDir("canon-emit-");
    scaffoldXbrief(root);
    writeScopeFixture(root, "pending", "2026-01-01-boom.xbrief.json", { references: [] });
    const c = ghClient({
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      env: { GH_TOKEN: "t" },
    });
    const result = await emit(c, REPO, root, "2026-01-01-boom.xbrief.json");
    expect(result.code).toBe(2);
  });
});
