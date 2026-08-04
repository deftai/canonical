import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ghClient } from "../gh/rest.js";
import {
  cleanupTempDirs,
  scaffoldBriefs,
  tempDir,
  writeScopeFixture,
} from "../test-support/index.js";
import { ingest } from "./ingest.js";

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
const NOW = new Date("2026-08-04T00:00:00.000Z");

function client(routes: Record<string, Route>) {
  return ghClient({ fetchFn: fakeFetch(routes), env: { GH_TOKEN: "t" } });
}

afterAll(cleanupTempDirs);

describe("ingest", () => {
  it("writes a proposed scope for a single issue number", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    const c = client({
      "GET /repos/acme/widgets/issues/9": {
        body: {
          number: 9,
          title: "Fix the widget",
          body: "Some description\n\n- [ ] first thing\n- [x] second thing\n",
          html_url: "https://github.com/acme/widgets/issues/9",
        },
      },
    });
    const result = await ingest(c, REPO, root, { number: 9 }, NOW);
    expect(result.code).toBe(0);
    expect(result.written).toHaveLength(1);
    const path = result.written[0] as string;
    expect(path).toBe("briefs/proposed/2026-08-04-fix-the-widget-issue-9.json");
    const scope = JSON.parse(readFileSync(join(root, path), "utf8"));
    expect(scope.kind).toBe("story");
    expect(scope.plan.status).toBe("proposed");
    expect(scope.narratives.Description).toContain("Some description");
    expect(scope.narratives.Acceptance).toBe("first thing\nsecond thing");
    expect(scope.narratives.Origin).toBe("Ingested from issue #9");
    expect(scope.references).toEqual([
      {
        uri: "https://github.com/acme/widgets/issues/9",
        type: "issue",
        title: "Fix the widget",
        trust: "external",
      },
    ]);
  });

  it("skips (not error) an issue already referenced by an existing scope", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "pending", "2026-01-01-existing-issue-9.json", {
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/9",
          type: "issue",
          title: "x",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues/9": {
        body: {
          number: 9,
          title: "Fix the widget",
          body: "",
          html_url: "https://github.com/acme/widgets/issues/9",
        },
      },
    });
    const result = await ingest(c, REPO, root, { number: 9 }, NOW);
    expect(result.code).toBe(1);
    expect(result.written).toHaveLength(0);
    expect(result.skipped).toEqual([
      { issueNumber: 9, reason: "already ingested: https://github.com/acme/widgets/issues/9" },
    ]);
  });

  it("ingests --all open issues, filtering out pull requests, and skips duplicates", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "pending", "2026-01-01-already-there-issue-5.json", {
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/5",
          type: "issue",
          title: "x",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [
          {
            number: 5,
            title: "Already there",
            body: "",
            html_url: "https://github.com/acme/widgets/issues/5",
          },
          {
            number: 6,
            title: "New one",
            body: "",
            html_url: "https://github.com/acme/widgets/issues/6",
          },
          {
            number: 7,
            title: "A pull request",
            body: "",
            html_url: "https://github.com/acme/widgets/pull/7",
            pull_request: { url: "x" },
          },
        ],
      },
    });
    const result = await ingest(c, REPO, root, { all: true }, NOW);
    expect(result.code).toBe(0);
    expect(result.written).toEqual(["briefs/proposed/2026-08-04-new-one-issue-6.json"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.issueNumber).toBe(5);
  });

  it("--dry-run prints planned writes without touching disk", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    const c = client({
      "GET /repos/acme/widgets/issues/9": {
        body: {
          number: 9,
          title: "Fix the widget",
          body: "",
          html_url: "https://github.com/acme/widgets/issues/9",
        },
      },
    });
    const result = await ingest(c, REPO, root, { number: 9, dryRun: true }, NOW);
    expect(result.code).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.written).toEqual(["briefs/proposed/2026-08-04-fix-the-widget-issue-9.json"]);
    expect(
      existsSync(join(root, "briefs", "proposed", "2026-08-04-fix-the-widget-issue-9.json")),
    ).toBe(false);
    expect(
      readdirSync(join(root, "briefs", "proposed")).filter((f) => f !== ".gitkeep"),
    ).toHaveLength(0);
  });

  it("returns 1 when all matching issues are skipped as duplicates", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    writeScopeFixture(root, "pending", "2026-01-01-dup-issue-9.json", {
      references: [
        {
          uri: "https://github.com/acme/widgets/issues/9",
          type: "issue",
          title: "x",
          trust: "external",
        },
      ],
    });
    const c = client({
      "GET /repos/acme/widgets/issues?state=open&per_page=100": {
        body: [
          {
            number: 9,
            title: "Dup",
            body: "",
            html_url: "https://github.com/acme/widgets/issues/9",
          },
        ],
      },
    });
    const result = await ingest(c, REPO, root, { all: true }, NOW);
    expect(result.code).toBe(1);
  });

  it("returns 2 on API error", async () => {
    const root = tempDir("canon-ingest-");
    scaffoldBriefs(root);
    const c = ghClient({
      fetchFn: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      env: { GH_TOKEN: "t" },
    });
    const result = await ingest(c, REPO, root, { number: 9 }, NOW);
    expect(result.code).toBe(2);
  });
});
