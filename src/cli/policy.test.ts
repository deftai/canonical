import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { run } from "./policy.js";

afterAll(() => {
  cleanupTempDirs();
});

function writeProject(policy: Record<string, unknown> = {}): string {
  const root = tempDir("cli-policy-test-");
  mkdirSync(join(root, "briefs"), { recursive: true });
  writeFileSync(
    join(root, "briefs", "PROJECT.json"),
    `${JSON.stringify({ title: "t", policy }, null, 2)}\n`,
  );
  return root;
}

function auditRows(root: string): unknown[] {
  const path = join(root, "briefs", "audit.jsonl");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

let outBuf: string[];
let errBuf: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  outBuf = [];
  errBuf = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    outBuf.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errBuf.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  delete process.env.CANON_ACTOR;
});

describe("canon policy", () => {
  it("exits 2 when the subcommand is missing or unrecognized", () => {
    const root = writeProject();
    expect(run(["--project-root", root])).toBe(2);
    expect(run(["bogus", "--project-root", root])).toBe(2);
  });

  describe("show", () => {
    it("prints every registered field with effective value and a (default) marker when unset", () => {
      const root = writeProject();
      const code = run(["show", "--project-root", root]);
      expect(code).toBe(0);
      const text = outBuf.join("");
      expect(text).toContain("policy.allowDirectCommitsToDefault = false (default)");
      expect(text).toContain("policy.wipCap = 20 (default)");
      expect(text).toContain("policy.deliveryBranch = null (default)");
      expect(text).toContain("policy.requireHumanMerge = true (default)");
      expect(text).toContain("policy.runtimeAuthority.denyPaths = [] (default)");
    });

    it("omits the (default) marker for a field explicitly set in PROJECT.json", () => {
      const root = writeProject({ wipCap: 5 });
      const code = run(["show", "--project-root", root]);
      expect(code).toBe(0);
      const text = outBuf.join("");
      expect(text).toContain("policy.wipCap = 5\n");
      expect(text).not.toContain("policy.wipCap = 5 (default)");
    });

    it("--field filters to one field", () => {
      const root = writeProject();
      const code = run(["show", "--field", "wipCap", "--project-root", root]);
      expect(code).toBe(0);
      const text = outBuf.join("");
      expect(text).toContain("policy.wipCap = 20 (default)");
      expect(text).not.toContain("allowDirectCommitsToDefault");
    });

    it("exits 1 for an unknown field", () => {
      const root = writeProject();
      const code = run(["show", "--field", "notAField", "--project-root", root]);
      expect(code).toBe(1);
      expect(errBuf.join("")).toContain("unknown policy field: notAField");
    });

    it("--json prints a one-line payload", () => {
      const root = writeProject();
      const code = run(["show", "--field", "wipCap", "--project-root", root, "--json"]);
      expect(code).toBe(0);
      const line = outBuf.join("").trim();
      expect(line.split("\n")).toHaveLength(1);
      const parsed = JSON.parse(line);
      expect(parsed.ok).toBe(true);
      expect(parsed.fields).toEqual([{ default: true, field: "wipCap", value: 20 }]);
    });
  });

  describe("set", () => {
    it("writes the new value, prints old->new, and appends an audit row", () => {
      // PROJECT.json has no wipCap key yet, so the raw stored "old" value is
      // null (the default is a resolvePolicy-time fallback, not a stored value).
      const root = writeProject();
      const code = run([
        "set",
        "--field",
        "wipCap",
        "--value",
        "7",
        "--confirm",
        "--project-root",
        root,
      ]);
      expect(code).toBe(0);
      expect(outBuf.join("")).toContain("policy.wipCap: null -> 7");

      const project = JSON.parse(readFileSync(join(root, "briefs", "PROJECT.json"), "utf8"));
      expect(project.policy.wipCap).toBe(7);

      const rows = auditRows(root);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "policy-set",
        field: "wipCap",
        old: null,
        new: 7,
        actor: "cli",
      });
      expect(typeof (rows[0] as Record<string, unknown>).ts).toBe("string");
    });

    it("prints the prior explicit value as old when the field was already set", () => {
      const root = writeProject({ wipCap: 20 });
      const code = run([
        "set",
        "--field",
        "wipCap",
        "--value",
        "7",
        "--confirm",
        "--project-root",
        root,
      ]);
      expect(code).toBe(0);
      expect(outBuf.join("")).toContain("policy.wipCap: 20 -> 7");
    });

    it("uses CANON_ACTOR as the audit actor when set", () => {
      process.env.CANON_ACTOR = "agent-7";
      const root = writeProject();
      run(["set", "--field", "wipCap", "--value", "3", "--confirm", "--project-root", root]);
      const rows = auditRows(root);
      expect(rows[0]).toMatchObject({ actor: "agent-7" });
    });

    it("exits 1 for an unknown field, no write, no audit row", () => {
      const root = writeProject();
      const code = run([
        "set",
        "--field",
        "notAField",
        "--value",
        "x",
        "--confirm",
        "--project-root",
        root,
      ]);
      expect(code).toBe(1);
      expect(errBuf.join("")).toContain("unknown policy field: notAField");
      expect(auditRows(root)).toHaveLength(0);
    });

    it("exits 1 naming --confirm when it is absent", () => {
      const root = writeProject();
      const code = run(["set", "--field", "wipCap", "--value", "7", "--project-root", root]);
      expect(code).toBe(1);
      expect(errBuf.join("")).toContain("--confirm");
      expect(auditRows(root)).toHaveLength(0);
    });

    it("exits 1 on a type mismatch, no write, no audit row", () => {
      const root = writeProject();
      const code = run([
        "set",
        "--field",
        "wipCap",
        "--value",
        "not-a-number",
        "--confirm",
        "--project-root",
        root,
      ]);
      expect(code).toBe(1);
      expect(errBuf.join("")).toContain("wipCap expects a positive integer");
      expect(auditRows(root)).toHaveLength(0);
    });

    it("exits 2 when --field or --value is missing (usage error)", () => {
      const root = writeProject();
      expect(run(["set", "--value", "7", "--confirm", "--project-root", root])).toBe(2);
      expect(run(["set", "--field", "wipCap", "--confirm", "--project-root", root])).toBe(2);
    });
  });
});
