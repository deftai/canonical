import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeCollectionFile } from "../collection/storage.js";
import { CONSENT_VERSION } from "../collection/types.js";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { run } from "./feedback.js";

afterAll(() => cleanupTempDirs());

function captureStd(): { out: string[]; err: string[]; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function consentRoot(prefix: string): string {
  const root = tempDir(prefix);
  writeCollectionFile(root, {
    installId: "id",
    token: "tok",
    submissions: {
      granted: true,
      scopes: ["bug", "feedback", "feature"],
      consentVersion: CONSENT_VERSION,
      decidedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: Date.now() + 86_400_000,
    },
  });
  return root;
}

describe("feedback --help", () => {
  it("prints flags and multiline guidance with exit 0", async () => {
    const cap = captureStd();
    const code = await run(["--help"]);
    cap.restore();
    expect(code).toBe(0);
    const text = cap.out.join("");
    expect(text).toMatch(/--kind/);
    expect(text).toMatch(/--details-file/);
    expect(text).toMatch(/--summary-file/);
    expect(text).toMatch(/multiline|file flag|--\*-file/i);
  });
});

describe("feedback file flags", () => {
  it("reads --details-file into feature details", async () => {
    const root = consentRoot("canon-fb-details-file-");
    const body = 'line1\nline2 with spaces and "quotes"\n';
    const file = join(root, "details.md");
    writeFileSync(file, body);

    const cap = captureStd();
    const code = await run([
      `--project-root=${root}`,
      "--kind=feature",
      "--summary=from file",
      `--details-file=${file}`,
      "--dry-run",
      "--json",
    ]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join("")) as {
      code: number;
      dry_run: boolean;
      payload: { details?: string; summary?: string };
    };
    expect(parsed.code).toBe(0);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.payload.details).toBe(body);
    expect(parsed.payload.summary).toBe("from file");
  });

  it("reads --summary-file, --message-file, --context-file, --stack-file, --logs-file", async () => {
    const root = consentRoot("canon-fb-all-files-");
    const dir = join(root, "payload");
    mkdirSync(dir);
    writeFileSync(join(dir, "summary.txt"), "sum from file");
    writeFileSync(join(dir, "message.txt"), "msg from file");
    writeFileSync(join(dir, "context.txt"), "ctx from file");
    writeFileSync(join(dir, "stack.txt"), "Error: boom\n  at x:1");
    writeFileSync(join(dir, "logs.txt"), "log line 1\nlog line 2");

    const cap = captureStd();
    const code = await run([
      `--project-root=${root}`,
      "--kind=bug",
      `--summary-file=${join(dir, "summary.txt")}`,
      `--stack-file=${join(dir, "stack.txt")}`,
      `--logs-file=${join(dir, "logs.txt")}`,
      "--dry-run",
      "--json",
    ]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join("")) as {
      payload: { summary?: string; stack?: string; logs?: string };
    };
    expect(parsed.payload.summary).toBe("sum from file");
    expect(parsed.payload.stack).toBe("Error: boom\n  at x:1");
    expect(parsed.payload.logs).toBe("log line 1\nlog line 2");

    const cap2 = captureStd();
    const code2 = await run([
      `--project-root=${root}`,
      "--kind=feedback",
      `--message-file=${join(dir, "message.txt")}`,
      "--dry-run",
      "--json",
    ]);
    cap2.restore();
    expect(code2).toBe(0);
    const parsed2 = JSON.parse(cap2.out.join("")) as { payload: { message?: string } };
    expect(parsed2.payload.message).toBe("msg from file");

    const cap3 = captureStd();
    const code3 = await run([
      `--project-root=${root}`,
      "--kind=feature",
      `--summary-file=${join(dir, "summary.txt")}`,
      `--context-file=${join(dir, "context.txt")}`,
      "--dry-run",
      "--json",
    ]);
    cap3.restore();
    expect(code3).toBe(0);
    const parsed3 = JSON.parse(cap3.out.join("")) as {
      payload: { summary?: string; context?: string };
    };
    expect(parsed3.payload.summary).toBe("sum from file");
    expect(parsed3.payload.context).toBe("ctx from file");
  });

  it("exits 2 clearly when inline and file flags conflict", async () => {
    const root = consentRoot("canon-fb-conflict-");
    const file = join(root, "details.md");
    writeFileSync(file, "from file\n");

    const cap = captureStd();
    const code = await run([
      `--project-root=${root}`,
      "--kind=feature",
      "--summary=x",
      "--details=inline",
      `--details-file=${file}`,
    ]);
    cap.restore();
    expect(code).toBe(2);
    const err = cap.err.join("");
    expect(err).toMatch(/conflict/i);
    expect(err).toMatch(/--details/);
    expect(err).toMatch(/--details-file/);
  });

  it("exits 2 when details-file path is missing", async () => {
    const root = consentRoot("canon-fb-missing-file-");
    const cap = captureStd();
    const code = await run([
      `--project-root=${root}`,
      "--kind=feature",
      "--summary=x",
      `--details-file=${join(root, "nope.md")}`,
    ]);
    cap.restore();
    expect(code).toBe(2);
    const err = cap.err.join("");
    expect(err).toMatch(/cannot read|--details-file/i);
    expect(err).not.toMatch(/unknown flag/);
  });
});

describe("feedback --dry-run", () => {
  it("validates payload without submitting", async () => {
    const root = consentRoot("canon-fb-dry-");
    const cap = captureStd();
    const code = await run([
      `--project-root=${root}`,
      "--kind=feature",
      "--summary=dry summary",
      "--details=line1\nline2",
      "--dry-run",
      "--json",
    ]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join("")) as {
      code: number;
      dry_run: boolean;
      payload: { details?: string };
    };
    expect(parsed.dry_run).toBe(true);
    expect(parsed.payload.details).toBe("line1\nline2");
  });
});
