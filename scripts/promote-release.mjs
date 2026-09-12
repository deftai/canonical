#!/usr/bin/env node
/**
 * Point npm dist-tags latest + stable (+ prod) at an already-published
 * production version (plain X.Y.Z). Does not rebuild.
 *
 * Usage:
 *   node scripts/promote-release.mjs 0.3.1
 *   pnpm run promote -- 0.3.1
 *
 * Requires npm auth with dist-tag permission (npm login, or NPM_TOKEN).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const name = pkg.name;

// pnpm often forwards a literal "--" (`pnpm run promote -- 0.3.1` → argv ["--","0.3.1"]).
const raw = process.argv.slice(2).find((a) => a !== "--") ?? "";
const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/promote-release.mjs <X.Y.Z>");
  process.exit(2);
}

function run(args) {
  execFileSync("npm", args, { stdio: "inherit" });
}

try {
  execFileSync("npm", ["view", `${name}@${version}`, "version"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.error(`${name}@${version} is not on the registry. Publish v${version} first.`);
  process.exit(2);
}

run(["dist-tag", "add", `${name}@${version}`, "prod"]);
run(["dist-tag", "add", `${name}@${version}`, "latest"]);
run(["dist-tag", "add", `${name}@${version}`, "stable"]);
console.log(`Promoted ${name}@${version} → prod, latest, stable`);
run(["view", name, "dist-tags"]);
