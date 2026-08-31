import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveConsentSignal } from "../collection/consent.js";
import { readCollectionFile } from "../collection/storage.js";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { run } from "./collection-opt-in.js";

afterAll(() => cleanupTempDirs());

describe("collection:opt-in CLI contact flags (attributed one-shot)", () => {
  it("accepts --first-name/--last-name/--email/--mobile (not unknown flags)", async () => {
    const root = tempDir("canon-optin-flags-");
    const err: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
    const code = await run([
      `--project-root=${root}`,
      "--confirm",
      "--first-name=Ada",
      "--last-name=Lovelace",
      "--email=ada@example.com",
      "--mobile=+15551234567",
    ]);
    spy.mockRestore();
    const joined = err.join("");
    expect(joined).not.toMatch(/unknown flag/i);
    // Network may fail in unit env; if save succeeded, attributed must stick.
    if (code === 0) {
      const file = readCollectionFile(root);
      expect(resolveConsentSignal(file).metricsMode).toBe("attributed");
      expect(file.identity?.email).toBe("ada@example.com");
    }
  });

  it("rejects contact flags without --confirm", async () => {
    const root = tempDir("canon-optin-noconfirm-");
    const code = await run([`--project-root=${root}`, "--email=ada@example.com"]);
    expect(code).toBe(1);
  });
});
