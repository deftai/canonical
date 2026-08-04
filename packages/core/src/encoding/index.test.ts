import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, git, tempGitRepo } from "../test-support/index.js";
import { evaluateEncoding } from "./index.js";

afterAll(cleanupTempDirs);

function commitAll(root: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "add fixtures");
}

describe("evaluateEncoding", () => {
  it("exits 0 when tracked files are clean", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "clean.md"), "# hello\n\nplain ascii text\n");
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("flags a U+FFFD replacement character with file:line", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "broken.txt"), `line one\nbad \uFFFD char\n`);
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({
        path: "broken.txt",
        line: 2,
        label: "U+FFFD replacement character",
      }),
    ]);
    expect(result.message).toContain("broken.txt:2");
  });

  it("flags a leading UTF-8 BOM", () => {
    const root = tempGitRepo();
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# title\n")]);
    writeFileSync(join(root, "bom.md"), buf);
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(1);
    expect(result.findings.some((f) => f.label === "leading UTF-8 BOM")).toBe(true);
  });

  it("flags cp1252-as-utf8 mojibake sequences", () => {
    const root = tempGitRepo();
    writeFileSync(
      join(root, "quote.md"),
      "it\u2019s fine\n".replace("\u2019", "\u00E2\u20AC\u2122"),
    );
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(1);
    expect(result.findings.some((f) => f.label.includes("cp1252-as-utf8"))).toBe(true);
  });

  it("flags non-ASCII punctuation only in machine-parsed files", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "CHANGELOG.md"), "## v1.0\n\n- shipped \u2014 done\n");
    writeFileSync(join(root, "notes.md"), "shipped \u2014 done\n");
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(1);
    const flaggedPaths = result.findings.map((f) => f.path);
    expect(flaggedPaths).toContain("CHANGELOG.md");
    expect(flaggedPaths).not.toContain("notes.md");
  });

  it("skips binary files via the null-byte heuristic", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "binary.bin.txt"), Buffer.from([0x00, 0x01, 0xff, 0xfe]));
    commitAll(root);
    const result = evaluateEncoding(root);
    expect(result.code).toBe(0);
  });

  it("skips node_modules/dist/.git path segments", () => {
    const root = tempGitRepo();
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "bad.txt"), "bad \uFFFD char\n");
    // dist/ is git-ignored in this scaffold's real repos, but force-add here
    // to prove the scanner itself skips the segment even if somehow tracked.
    git(root, "add", "-f", "dist/bad.txt");
    git(root, "commit", "-q", "-m", "force add dist");
    const result = evaluateEncoding(root);
    expect(result.code).toBe(0);
  });

  it("respects --staged and ignores unstaged corruption", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "clean.txt"), "fine\n");
    commitAll(root);
    writeFileSync(join(root, "clean.txt"), "bad \uFFFD char\n");
    const result = evaluateEncoding(root, { staged: true });
    expect(result.code).toBe(0);
  });

  it("catches unstaged corruption when scanning tracked files without --staged", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "clean.txt"), "fine\n");
    commitAll(root);
    writeFileSync(join(root, "clean.txt"), "bad \uFFFD char\n");
    const result = evaluateEncoding(root, { staged: false });
    expect(result.code).toBe(1);
  });
});
