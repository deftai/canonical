import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  canon,
  cleanupTempDirs,
  installCollectionHarness,
  installCollectionTestHooks,
  readCollectionState,
} from "./index.js";

installCollectionTestHooks();
afterAll(() => cleanupTempDirs());

describe("canon harness", () => {
  it("ARC-8: installCollectionHarness stubs HOME away from the real home", () => {
    const realHome = process.env.HOME;
    const { home, root, fake } = installCollectionHarness();
    expect(home).not.toBe(realHome);
    expect(process.env.HOME).toBe(home);
    expect(process.env.USERPROFILE).toBe(home);
    // os.homedir() follows HOME — after the stub it must resolve to the temp home.
    expect(homedir()).toBe(home);
    expect(existsSync(root)).toBe(true);
    expect(typeof fake.fetch).toBe("function");
  });

  it("canon returns {code,out,err} for collection:status and injects project-root", async () => {
    const { root } = installCollectionHarness();
    const result = await canon(["collection:status"], { cwd: root });
    expect(result).toEqual(
      expect.objectContaining({
        code: expect.any(Number),
        out: expect.any(String),
        err: expect.any(String),
      }),
    );
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/metrics=not_prompted/);
  });

  it("readCollectionState returns {} when missing and parses written JSON", () => {
    const { root } = installCollectionHarness();
    expect(readCollectionState(root)).toEqual({});
    mkdirSync(join(root, ".canonical"), { recursive: true });
    writeFileSync(
      join(root, ".canonical", "collection.json"),
      `${JSON.stringify({ metricsMode: "undecided" }, null, 2)}\n`,
    );
    expect(readCollectionState(root)).toEqual({ metricsMode: "undecided" });
  });

  it("ARC-8: harness fake fetch throws on a host outside the baked collector URL", async () => {
    const { fake } = installCollectionHarness();
    await expect(fake.fetch("https://evil.example/collector/v1/registrations")).rejects.toThrow(
      /refused URL outside baked collector base/,
    );
  });
});
