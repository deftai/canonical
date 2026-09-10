import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD_CHANNEL, COLLECTION_BASE_URL, COLLECTION_ENV } from "./build-info.js";
import {
  buildChannel,
  resolveCollectionBaseUrl,
  resolveCollectionEnv,
} from "./collection/client.js";

const root = join(import.meta.dirname, "..");
const generatedPath = join(root, "src", "build-info.generated.ts");
const scriptPath = join(root, "scripts", "write-build-info.mjs");

function readGenerated(): string {
  return readFileSync(generatedPath, "utf8");
}

function restoreStagingBake(): void {
  execFileSync(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env, CANONICAL_BUILD_CHANNEL: "staging" },
    stdio: "pipe",
  });
}

afterAll(() => {
  restoreStagingBake();
});

describe("build-info bake", () => {
  it("defaults (committed/prebuild) are staging", () => {
    expect(BUILD_CHANNEL).toBe("staging");
    expect(COLLECTION_BASE_URL).toBe("https://api.deft-staging.co/collector");
    expect(COLLECTION_ENV).toBe("staging");
    expect(buildChannel()).toBe("staging");
    expect(resolveCollectionBaseUrl()).toBe(COLLECTION_BASE_URL);
    expect(resolveCollectionEnv()).toBe(COLLECTION_ENV);
  });

  it("ignores CANONICAL_COLLECTION_URL env (not customer-switchable)", () => {
    const prev = process.env.CANONICAL_COLLECTION_URL;
    process.env.CANONICAL_COLLECTION_URL = "https://evil.example/collector";
    try {
      expect(resolveCollectionBaseUrl()).toBe("https://api.deft-staging.co/collector");
    } finally {
      if (prev === undefined) delete process.env.CANONICAL_COLLECTION_URL;
      else process.env.CANONICAL_COLLECTION_URL = prev;
    }
  });

  it("write-build-info can bake production then restore staging", () => {
    execFileSync(process.execPath, [scriptPath], {
      cwd: root,
      env: { ...process.env, CANONICAL_BUILD_CHANNEL: "production" },
      stdio: "pipe",
    });
    const prod = readGenerated();
    expect(prod).toContain('"production"');
    expect(prod).toContain("https://api.deft.co/collector");

    restoreStagingBake();
    const staging = readGenerated();
    expect(staging).toContain('"staging"');
    expect(staging).toContain("https://api.deft-staging.co/collector");
  });

  it("rejects unknown channel", () => {
    expect(() =>
      execFileSync(process.execPath, [scriptPath], {
        cwd: root,
        env: { ...process.env, CANONICAL_BUILD_CHANNEL: "lab" },
        stdio: "pipe",
      }),
    ).toThrow();
    restoreStagingBake();
  });
});
