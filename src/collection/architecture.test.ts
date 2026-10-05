/**
 * ARC-1 to ARC-6 and ARC-8 (ARC-8 also in test-support). ARC-7 is validator-only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const COLLECTION_DIR = join(ROOT, "src/collection");
const CLI_DIR = join(ROOT, "src/cli");

/** Exact ARC-1 non-test file set under src/collection/. */
const ARC1_COLLECTION_FILES = [
  "types.ts",
  "storage.ts",
  "client.ts",
  "consent.ts",
  "feedback.ts",
  "emit.ts",
  "session-state.ts",
  "metric-dimensions.ts",
  "index.ts",
] as const;

const OPT_IN_SPECS = new Set(["./types.js", "./storage.js", "./client.js", "./consent.js"]);

function nonTestTsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) {
      return count;
    }
    count += 1;
    from = idx + needle.length;
  }
}

/** Project-relative import/re-export specifiers (`./x`, `../x`). */
function projectImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    const spec = match[1];
    if (spec !== undefined) {
      out.push(spec);
    }
  }
  return out;
}

/** Named bindings imported from a project specifier (skips `import type`). */
function valueNamedImports(source: string, spec: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?!type\s)\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(re)) {
    if (match[2] !== spec) {
      continue;
    }
    const block = match[1];
    if (block === undefined) {
      continue;
    }
    for (const part of block.split(",")) {
      const cleaned = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (cleaned !== undefined && cleaned.length > 0) {
        out.push(cleaned);
      }
    }
  }
  return out;
}

/** wc -l semantics over UTF-8 text. */
function lineCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

describe("ARC architecture", () => {
  it("ARC-1: non-test src/collection/ files are exactly the nine-module set (soft-emit.ts gone)", () => {
    const names = readdirSync(COLLECTION_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();
    expect(names).toEqual([...ARC1_COLLECTION_FILES].sort());
  });

  it("ARC-2: collection CLI is src/cli/collection.ts + feedback.ts; no collection-*.ts; solo task names unchanged", () => {
    expect(existsSync(join(CLI_DIR, "collection.ts"))).toBe(true);
    expect(existsSync(join(CLI_DIR, "feedback.ts"))).toBe(true);

    const stray = readdirSync(CLI_DIR).filter(
      (name) =>
        name.startsWith("collection-") && name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(stray).toEqual([]);

    const solo = read(join(ROOT, "tasks/solo.yml"));
    for (const task of [
      "collection:status",
      "collection:opt-in",
      "collection:decline",
      "collection:opt-out",
      "collection:identity",
      "collection:metric",
    ]) {
      expect(solo).toContain(`"${task}"`);
    }
  });

  it("ARC-3: single createCollector/optIn/optOut/ensureRegistered/chmodSync; submit twice", () => {
    const files = [
      ...nonTestTsFiles(COLLECTION_DIR),
      join(CLI_DIR, "collection.ts"),
      join(CLI_DIR, "feedback.ts"),
    ].filter((p) => existsSync(p));

    const combined = files.map(read).join("\n");
    expect(countOccurrences(combined, "createCollector(")).toBe(1);
    expect(countOccurrences(combined, ".optIn(")).toBe(1);
    expect(countOccurrences(combined, ".optOut(")).toBe(1);
    expect(countOccurrences(combined, ".ensureRegistered(")).toBe(1);
    expect(countOccurrences(combined, "chmodSync(")).toBe(1);
    expect(countOccurrences(combined, ".submit(")).toBe(2);

    // First four must not appear elsewhere under src/.
    const srcRoot = join(ROOT, "src");
    const walk: string[] = [];
    const stack = [srcRoot];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) {
        break;
      }
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!ent.name.endsWith(".ts") || ent.name.endsWith(".test.ts")) {
          continue;
        }
        if (files.includes(full)) {
          continue;
        }
        walk.push(full);
      }
    }
    for (const path of walk) {
      const text = read(path);
      expect(text.includes("createCollector("), relative(ROOT, path)).toBe(false);
      expect(text.includes(".optIn("), relative(ROOT, path)).toBe(false);
      expect(text.includes(".optOut("), relative(ROOT, path)).toBe(false);
      expect(text.includes(".ensureRegistered("), relative(ROOT, path)).toBe(false);
    }
  });

  it("ARC-4: opt-in service import boundaries (types/storage/client/consent)", () => {
    const typesSrc = read(join(COLLECTION_DIR, "types.ts"));
    expect(projectImports(typesSrc)).toEqual([]);

    const storageSrc = read(join(COLLECTION_DIR, "storage.ts"));
    const storageProject = projectImports(storageSrc).sort();
    expect(storageProject).toEqual(["../fs/contained-write.js", "./types.js"]);

    const collectionFiles = nonTestTsFiles(COLLECTION_DIR);
    const buildInfoImporters = collectionFiles.filter((path) =>
      read(path).includes('from "../build-info.js"'),
    );
    expect(buildInfoImporters.map((p) => relative(COLLECTION_DIR, p))).toEqual(["client.ts"]);

    const packageReaders = collectionFiles.filter((path) => {
      const text = read(path);
      return text.includes("package.json") && !path.endsWith("types.ts");
    });
    // client.ts is the only reader of package.json under src/collection/.
    expect(packageReaders.map((p) => relative(COLLECTION_DIR, p))).toEqual(["client.ts"]);

    const forbiddenFrom = [
      "./emit.js",
      "./session-state.js",
      "./metric-dimensions.js",
      "./feedback.js",
    ];
    for (const name of ["types.ts", "storage.ts", "client.ts", "consent.ts"]) {
      const imports = projectImports(read(join(COLLECTION_DIR, name)));
      for (const bad of forbiddenFrom) {
        expect(imports, `${name} must not import ${bad}`).not.toContain(bad);
      }
    }
  });

  it("ARC-4: metrics service imports from opt-in only usageCollector and hasUsageConsent", () => {
    const allowed = new Set(["usageCollector", "hasUsageConsent"]);
    for (const name of ["emit.ts", "session-state.ts"]) {
      const src = read(join(COLLECTION_DIR, name));
      const specs = projectImports(src);
      for (const spec of specs) {
        if (OPT_IN_SPECS.has(spec)) {
          const names = valueNamedImports(src, spec);
          for (const binding of names) {
            expect(
              allowed.has(binding),
              `${name} must not value-import ${binding} from ${spec}`,
            ).toBe(true);
          }
        }
      }
      // session-state may import contained-write; emit must not pull other project files outside collection/.
      const outside = specs.filter((s) => s.startsWith("../"));
      if (name === "session-state.ts") {
        expect(outside.every((s) => s === "../fs/contained-write.js")).toBe(true);
      } else {
        expect(outside, `${name} must not import outside src/collection/`).toEqual([]);
      }
    }
  });

  it("ARC-5: line budget ≤1500 over non-test collection + cli/collection.ts + cli/feedback.ts", () => {
    const paths = [
      ...nonTestTsFiles(COLLECTION_DIR),
      join(CLI_DIR, "collection.ts"),
      join(CLI_DIR, "feedback.ts"),
    ].filter((p) => existsSync(p));
    const total = paths.reduce((sum, path) => sum + lineCount(read(path)), 0);
    expect(total).toBeLessThanOrEqual(1500);
  });

  it("ARC-6: no @deprecated in architecture files; every index export used outside the module", () => {
    const archFiles = [
      ...nonTestTsFiles(COLLECTION_DIR),
      join(CLI_DIR, "collection.ts"),
      join(CLI_DIR, "feedback.ts"),
    ].filter((p) => existsSync(p));

    for (const path of archFiles) {
      expect(read(path).includes("@deprecated"), relative(ROOT, path)).toBe(false);
    }

    const indexSrc = read(join(COLLECTION_DIR, "index.ts"));
    const exported = new Set<string>();
    for (const match of indexSrc.matchAll(
      /export\s+(?:type\s+)?(?:\{([^}]+)\}|((?:async\s+)?function|const|class|enum)\s+(\w+))/g,
    )) {
      if (match[1] !== undefined) {
        for (const part of match[1].split(",")) {
          const cleaned = part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const name = cleaned[cleaned.length - 1];
          if (name !== undefined && name.length > 0) {
            exported.add(name);
          }
        }
      } else if (match[3] !== undefined) {
        exported.add(match[3]);
      }
    }
    expect(exported.size).toBeGreaterThan(0);

    // Collect identifiers imported from collection/index (or deep paths) by non-test files outside the module.
    const used = new Set<string>();
    const srcRoot = join(ROOT, "src");
    const stack = [srcRoot];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (dir === undefined) {
        break;
      }
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (full === COLLECTION_DIR) {
            continue;
          }
          stack.push(full);
          continue;
        }
        if (!ent.name.endsWith(".ts") || ent.name.endsWith(".test.ts")) {
          continue;
        }
        const text = read(full);
        if (!text.includes("collection/")) {
          continue;
        }
        for (const m of text.matchAll(
          /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'][^"']*collection[^"']*["']/g,
        )) {
          const block = m[1];
          if (block === undefined) {
            continue;
          }
          for (const part of block.split(",")) {
            const cleaned = part
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]
              ?.trim();
            if (cleaned !== undefined && cleaned.length > 0) {
              used.add(cleaned);
            }
          }
        }
        for (const m of text.matchAll(
          /import\s+(?:\*\s+as\s+(\w+)|(\w+))\s+from\s+["'][^"']*collection\/index\.js["']/g,
        )) {
          // namespace / default — count as using the barrel, not individual names
          void m;
        }
      }
    }

    const unused = [...exported].filter((name) => !used.has(name)).sort();
    expect(unused).toEqual([]);
  });
});
