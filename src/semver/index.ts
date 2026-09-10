/**
 * Semver validation and comparison for canonical release scopes.
 * Aligns with semver 2.0 (no leading-zero numeric parts; build metadata ignored for ordering).
 * Release `x-canonical/version` may include an optional `v` prefix (scm.md tag convention).
 */

const SEMVER_CORE =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

function parsePrereleaseId(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

function comparePrereleaseId(a: string, b: string): number {
  const na = parsePrereleaseId(a);
  const nb = parsePrereleaseId(b);
  if (typeof na === "number" && typeof nb === "number") {
    return na - nb;
  }
  if (typeof na === "number") {
    return -1;
  }
  if (typeof nb === "number") {
    return 1;
  }
  return na.localeCompare(nb);
}

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_CORE.exec(version);
  if (match === null) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
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
    return a.localeCompare(b);
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
      return partA - partB;
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
