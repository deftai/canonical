import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { ensureUserKey, identityPath } from "./identity.js";

afterAll(() => cleanupTempDirs());

describe("collection identity", () => {
  it("mints a lowercase uuid userKey and reuses it on later calls", () => {
    const configDir = tempDir("canon-id-");
    const first = ensureUserKey({ configDir });
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const path = identityPath({ configDir });
    expect(existsSync(path)).toBe(true);
    const second = ensureUserKey({ configDir });
    expect(second).toBe(first);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { userKey: string };
    expect(raw.userKey).toBe(first);
    expect(existsSync(join(configDir, "identity.json"))).toBe(true);
  });
});
