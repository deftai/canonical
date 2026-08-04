import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhSeams } from "../gh/index.js";
import {
  cleanupTempDirs,
  scaffoldBriefs,
  tempDir,
  writeScopeFixture,
} from "../test-support/index.js";
import { run } from "./issue-sync.js";

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

const fakeExec: GhSeams["exec"] = (cmd, args) => {
  if (cmd === "git" && args[0] === "remote") {
    return { status: 0, stdout: "https://github.com/acme/widgets.git\n" };
  }
  return { status: 1, stdout: "" };
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

afterAll(cleanupTempDirs);

describe("issue-sync run()", () => {
  it("exits 2 when the subcommand is missing", async () => {
    const code = await run([], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
    expect(errBuf).toContain("missing subcommand");
  });

  it("exits 2 on an unknown subcommand", async () => {
    const code = await run(["bogus"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
    expect(code).toBe(2);
    expect(errBuf).toContain("unknown subcommand");
  });

  describe("ingest", () => {
    it("exits 2 when neither an issue number nor --all is given", async () => {
      const code = await run(["ingest"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
      expect(code).toBe(2);
    });

    it("exits 2 when both an issue number and --all are given", async () => {
      const code = await run(["ingest", "9", "--all"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
      expect(code).toBe(2);
    });

    it("writes a scope for a single issue and exits 0", async () => {
      const root = tempDir("canon-issue-sync-cli-");
      scaffoldBriefs(root);
      const code = await run(["ingest", "9", `--project-root=${root}`, "--json"], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({
          "GET /repos/acme/widgets/issues/9": {
            body: {
              number: 9,
              title: "Fix it",
              body: "desc",
              html_url: "https://github.com/acme/widgets/issues/9",
            },
          },
        }),
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(outBuf.trim());
      expect(parsed.written).toHaveLength(1);
    });

    it("dedup skip: exits 1 when the issue is already ingested", async () => {
      const root = tempDir("canon-issue-sync-cli-");
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
      const code = await run(["ingest", "9", `--project-root=${root}`], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({
          "GET /repos/acme/widgets/issues/9": {
            body: {
              number: 9,
              title: "Fix it",
              body: "",
              html_url: "https://github.com/acme/widgets/issues/9",
            },
          },
        }),
      });
      expect(code).toBe(1);
      expect(outBuf).toContain("skip");
    });

    it("--dry-run plans writes without touching disk", async () => {
      const root = tempDir("canon-issue-sync-cli-");
      scaffoldBriefs(root);
      const code = await run(["ingest", "9", `--project-root=${root}`, "--dry-run"], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({
          "GET /repos/acme/widgets/issues/9": {
            body: {
              number: 9,
              title: "Fix it",
              body: "",
              html_url: "https://github.com/acme/widgets/issues/9",
            },
          },
        }),
      });
      expect(code).toBe(0);
      expect(outBuf).toContain("would write");
    });
  });

  describe("emit", () => {
    it("exits 2 when the scope id positional is missing", async () => {
      const code = await run(["emit"], { env: { GH_TOKEN: "t" }, exec: fakeExec });
      expect(code).toBe(2);
    });

    it("round-trips: creates then updates the same issue", async () => {
      const root = tempDir("canon-issue-sync-cli-");
      scaffoldBriefs(root);
      const rel = writeScopeFixture(root, "pending", "2026-01-01-emit-me.json", {
        title: "Emit me",
        references: [],
      });
      const created = await run(
        ["emit", "2026-01-01-emit-me.json", `--project-root=${root}`, "--json"],
        {
          env: { GH_TOKEN: "t" },
          exec: fakeExec,
          fetchFn: fakeFetch({
            "POST /repos/acme/widgets/issues": {
              body: { number: 77, html_url: "https://github.com/acme/widgets/issues/77" },
            },
          }),
        },
      );
      expect(created).toBe(0);
      const scope = JSON.parse(readFileSync(join(root, rel), "utf8"));
      expect(scope.references[0].uri).toBe("https://github.com/acme/widgets/issues/77");

      const updated = await run(["emit", "2026-01-01-emit-me.json", `--project-root=${root}`], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({ "PATCH /repos/acme/widgets/issues/77": { body: {} } }),
      });
      expect(updated).toBe(0);
    });
  });

  describe("reconcile", () => {
    it("exits 0 with no drift", async () => {
      const root = tempDir("canon-issue-sync-cli-");
      scaffoldBriefs(root);
      const code = await run(["reconcile", `--project-root=${root}`], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({
          "GET /repos/acme/widgets/issues?state=open&per_page=100": { body: [] },
        }),
      });
      expect(code).toBe(0);
    });

    it("exits 1 when drift is found", async () => {
      const root = tempDir("canon-issue-sync-cli-");
      scaffoldBriefs(root);
      const code = await run(["reconcile", `--project-root=${root}`, "--json"], {
        env: { GH_TOKEN: "t" },
        exec: fakeExec,
        fetchFn: fakeFetch({
          "GET /repos/acme/widgets/issues?state=open&per_page=100": {
            body: [{ number: 5, title: "Orphan", state: "open" }],
          },
        }),
      });
      expect(code).toBe(1);
      const parsed = JSON.parse(outBuf.trim());
      expect(parsed.findings).toHaveLength(1);
    });
  });
});
