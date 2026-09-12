/**
 * Semver validation and comparison for canonical release scopes.
 * Aligns with semver 2.0 (no leading-zero numeric parts; build metadata ignored for ordering).
 * Release `x-canonical/version` may include an optional `v` prefix (scm.md tag convention).
 */

const SEMVER_CORE =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

interface ParsedSemver {
  readonly major: bigint;
  readonly minor: bigint;
  readonly patch: bigint;
  readonly prerelease: readonly string[];
}

function compareNumericId(a: string, b: string): number {
  const diff = BigInt(a) - BigInt(b);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}

function comparePrereleaseId(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    return compareNumericId(a, b);
  }
  if (aNum) {
    return -1;
  }
  if (bNum) {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_CORE.exec(version);
  if (match === null) {
    return null;
  }
  const major = BigInt(match[1] ?? "0");
  const minor = BigInt(match[2] ?? "0");
  const patch = BigInt(match[3] ?? "0");
  const prereleaseRaw = match[4];
  const prerelease =
    prereleaseRaw === undefined || prereleaseRaw === "" ? [] : prereleaseRaw.split(".");
  return { major, minor, patch, prerelease };
}

/** True when `version` is valid semver, optionally prefixed with `v`. */
export function isValidCanonicalSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/** Ascending semver order (older first). Build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (av === null && bv === null) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (av === null) {
    return 1;
  }
  if (bv === null) {
    return -1;
  }
  for (const [partA, partB] of [
    [av.major, bv.major],
    [av.minor, bv.minor],
    [av.patch, bv.patch],
  ] as const) {
    if (partA !== partB) {
      return partA < partB ? -1 : 1;
    }
  }
  if (av.prerelease.length === 0 && bv.prerelease.length === 0) {
    return 0;
  }
  if (av.prerelease.length === 0) {
    return 1;
  }
  if (bv.prerelease.length === 0) {
    return -1;
  }
  const len = Math.max(av.prerelease.length, bv.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const idA = av.prerelease[i];
    const idB = bv.prerelease[i];
    if (idA === undefined) {
      return -1;
    }
    if (idB === undefined) {
      return 1;
    }
    const diff = comparePrereleaseId(idA, idB);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Descending semver order (newest first). */
export function compareSemverDesc(a: string, b: string): number {
  return compareSemver(b, a);
}
