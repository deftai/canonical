/**
 * WP2 G1: ARC-2, ARC-3, ARC-4 (opt-in service bullets), ARC-6.
 * ARC-1 / ARC-5 / metrics-service ARC-4 bullets land at WP3 G1.
 * ARC-7 is validator-only (no test).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const COLLECTION_DIR = join(ROOT, "src/collection");
const CLI_DIR = join(ROOT, "src/cli");

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

describe("ARC architecture (WP2)", () => {
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
