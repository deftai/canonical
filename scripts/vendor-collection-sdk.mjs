#!/usr/bin/env node
/**
 * Copy built @deft/collection-sdk + @deft/schemas into vendor/ for local use
 * until those packages are published. Re-run after rebuilding the sibling repo.
 *
 * Usage:
 *   node scripts/vendor-collection-sdk.mjs
 *   DEFT_COLLECTION_ROOT=/path/to/deft-collection-endpoint node scripts/vendor-collection-sdk.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const canonicalRoot = resolve(here, "..");
const defaultSource = resolve(canonicalRoot, "../deft-collection/deft-collection-endpoint");
const sourceRoot = resolve(process.env.DEFT_COLLECTION_ROOT ?? defaultSource);
const vendorRoot = join(canonicalRoot, "vendor", "@deft");

function requireBuilt(pkgRel) {
  const dist = join(sourceRoot, pkgRel, "dist");
  const pkgJson = join(sourceRoot, pkgRel, "package.json");
  if (!existsSync(dist) || !existsSync(pkgJson)) {
    throw new Error(
      `missing built package at ${join(sourceRoot, pkgRel)} (run npm run build there first)`,
    );
  }
  return { dist, pkgJson, pkgRel };
}

function vendorPackage(name, pkgRel, extraFiles = []) {
  const { dist, pkgJson } = requireBuilt(pkgRel);
  const dest = join(vendorRoot, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(dist, join(dest, "dist"), { recursive: true });
  // Slim package.json: drop private/scripts/devDeps; keep runtime exports.
  const raw = JSON.parse(readFileSync(pkgJson, "utf8"));
  const slim = {
    name: raw.name,
    version: raw.version ?? "0.0.0",
    type: raw.type ?? "module",
    main: raw.main,
    types: raw.types,
    exports: raw.exports,
    files: raw.files?.filter((f) => f !== "docs") ?? ["dist"],
    dependencies: raw.dependencies ?? {},
  };
  // Point schemas dep at the sibling vendored package when present.
  if (slim.dependencies["@deft/schemas"] !== undefined) {
    slim.dependencies["@deft/schemas"] = "file:../schemas";
  }
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(slim, null, 2)}\n`);
  for (const rel of extraFiles) {
    const from = join(sourceRoot, pkgRel, rel);
    if (existsSync(from)) {
      cpSync(from, join(dest, rel));
    }
  }
  return dest;
}

const schemasDest = vendorPackage("schemas", "packages/schemas");
const sdkDest = vendorPackage("collection-sdk", "packages/sdk", ["openapi.json"]);

const stamp = {
  vendoredAt: new Date().toISOString(),
  sourceRoot,
  packages: {
    "@deft/schemas": schemasDest,
    "@deft/collection-sdk": sdkDest,
  },
};
writeFileSync(join(vendorRoot, "VENDOR_STAMP.json"), `${JSON.stringify(stamp, null, 2)}\n`);
process.stdout.write(`vendored @deft/schemas + @deft/collection-sdk from ${sourceRoot}\n`);
