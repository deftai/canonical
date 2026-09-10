import { describe, expect, it } from "vitest";
import { compareSemver, compareSemverDesc, isValidCanonicalSemver } from "./index.js";

describe("isValidCanonicalSemver", () => {
  it("accepts core, prerelease, build metadata, and optional v prefix", () => {
    expect(isValidCanonicalSemver("0.3.0")).toBe(true);
    expect(isValidCanonicalSemver("v0.3.0")).toBe(true);
    expect(isValidCanonicalSemver("1.0.0-alpha-1")).toBe(true);
    expect(isValidCanonicalSemver("1.0.0+build.1")).toBe(true);
    expect(isValidCanonicalSemver("1.0.0-rc.1+build.1")).toBe(true);
  });

  it("rejects leading-zero numeric parts and other invalid shapes", () => {
    expect(isValidCanonicalSemver("01.02.03")).toBe(false);
    expect(isValidCanonicalSemver("1.0")).toBe(false);
    expect(isValidCanonicalSemver("not-a-version")).toBe(false);
    expect(isValidCanonicalSemver("v01.0.0")).toBe(false);
  });
});

describe("compareSemver", () => {
  it("orders release versions above matching prereleases", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  it("orders prerelease identifiers per semver rules", () => {
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-beta.2")).toBeLessThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.2")).toBeLessThan(0);
  });

  it("ignores build metadata when ordering", () => {
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });
});

describe("compareSemverDesc", () => {
  it("sorts newer releases before older and before prereleases", () => {
    expect(compareSemverDesc("1.0.0", "1.0.0-rc.1")).toBeLessThan(0);
    expect(compareSemverDesc("0.3.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemverDesc("1.0.0-rc.2", "1.0.0-rc.1")).toBeLessThan(0);
  });
});
