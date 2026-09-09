#!/usr/bin/env node
/**
 * Suggest the next git tag / npm version for a staging publish.
 *
 * Rule: staging versions are prereleases of the *next* patch after the current
 * GA (`latest` on npm, else package.json). Example: latest 0.3.0 →
 * 0.3.1-staging.1, then .2, …
 *
 * Usage: node scripts/next-staging-version.mjs
 * Prints a single line: 0.3.1-staging.1
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const name = pkg.name;

function parseTriple(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bumpPatch(triple) {
  return `${triple[0]}.${triple[1]}.${triple[2] + 1}`;
}

async function npmView(args) {
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("npm", ["view", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const latestRaw = (await npmView([name, "version"])) || pkg.version;
const latestTriple = parseTriple(latestRaw);
if (latestTriple === null) {
  console.error(`next-staging-version: cannot parse base version from ${latestRaw}`);
  process.exit(2);
}

const base = bumpPatch(latestTriple);
const stagingPrefix = `${base}-staging.`;

let versions = [];
const allRaw = await npmView([name, "versions", "--json"]);
if (allRaw) {
  try {
    const parsed = JSON.parse(allRaw);
    versions = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    versions = [];
  }
}

let maxN = 0;
for (const v of versions) {
  if (typeof v !== "string" || !v.startsWith(stagingPrefix)) continue;
  const n = Number(v.slice(stagingPrefix.length));
  if (Number.isInteger(n) && n > maxN) maxN = n;
}

const next = `${stagingPrefix}${maxN + 1}`;
process.stdout.write(`${next}\n`);
