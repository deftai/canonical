import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run } from "./orient.js";

afterAll(cleanupTempDirs);

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

describe("orient handler", () => {
  it("exits 0 ready on a clean repo with xbrief/", async () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = await run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("ready");
    expect(cap.out.join("")).toContain(
      "metricsMode=undecided metrics=not_prompted submissions=not_granted identity=anonymous",
    );
  });

  it("exits 1 when the tree is dirty without --allow-dirty", async () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "README.md"), "# dirty\n");
    const cap = captureStd();
    const code = await run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("dirty");
  });

  it("exits 0 when dirty and --allow-dirty is passed", async () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "README.md"), "# dirty\n");
    const cap = captureStd();
    const code = await run(["--project-root", root, "--allow-dirty"]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("--json emits sorted-key JSON including metricsMode/metrics/submissions/identity", async () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = await run(["--project-root", root, "--json"]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join("")) as {
      metrics: string;
      metrics_mode: string;
      submissions: string;
      identity: string;
      identity_mode: string;
      consent_line: string;
    };
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(parsed.metrics).toBe("not_prompted");
    expect(parsed.metrics_mode).toBe("undecided");
    expect(parsed.submissions).toBe("not_granted");
    expect(parsed.identity).toBe("anonymous");
    expect(parsed.identity_mode).toBe("anonymous");
    expect(parsed.consent_line).toBe(
      "metricsMode=undecided metrics=not_prompted submissions=not_granted identity=anonymous",
    );
  });

  it("returns 2 on a malformed flag", async () => {
    const cap = captureStd();
    const code = await run(["--nope"]);
    cap.restore();
    expect(code).toBe(2);
  });
});
