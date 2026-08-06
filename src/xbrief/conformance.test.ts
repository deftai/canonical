import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, describe, expect, it } from "vitest";
import { buildProjectSkeleton } from "../policy/index.js";
import {
  acceptanceItem,
  cleanupTempDirs,
  scopeFixture,
  tempGitRepo,
  writeScopeFixture,
} from "../test-support/index.js";
import type { ScopeDoc, ValidationFinding } from "../types/index.js";
import { canonicalStringify, readScope, transitionScope, writeScope } from "./brief-io.js";
import { buildScopeSkeleton } from "./skeleton.js";
import { validateCoreDocument } from "./validate.js";

/**
 * Conformance oracle: every document shape canonical emits must validate
 * against the REAL xBRIEF v0.8 JSON Schema (third_party/xBRIEF, the pinned
 * spec repo), and canonical's shipped core validator must agree with the
 * spec's own examples corpus. This suite is what makes "canonical state is
 * xBRIEF" a checked invariant instead of an aspiration.
 */

const XBRIEF_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "third_party",
  "xBRIEF",
);
const SCHEMA_PATH = join(XBRIEF_ROOT, "schemas", "xbrief-core-0.8.schema.json");
const EXAMPLES_DIR = join(XBRIEF_ROOT, "examples");

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateSchema = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));

function ajvErrors(doc: unknown): string {
  validateSchema(doc);
  return JSON.stringify(validateSchema.errors ?? [], null, 2);
}

function expectSchemaValid(doc: unknown): void {
  expect(validateSchema(doc), ajvErrors(doc)).toBe(true);
}

function coreFindings(doc: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  validateCoreDocument("test-doc", doc, findings);
  return findings;
}

afterAll(() => {
  cleanupTempDirs();
});

describe("emitted documents pass the real 0.8 JSON Schema", () => {
  it("scope fixture (default shape)", () => {
    expectSchemaValid(scopeFixture());
  });

  it("scope fixture with every canonical block populated", () => {
    const doc = scopeFixture({
      items: [acceptanceItem("ac1", "does the thing"), acceptanceItem("ac2", "and this", true)],
      references: [
        {
          uri: "https://github.com/x/y/issues/1",
          type: "x-xbrief/github-issue",
          title: "origin",
          "x-canonical/trust": "external",
        },
      ],
      narratives: { Description: "d", Acceptance: "a", Origin: "Ingested from issue #1" },
      "x-canonical/dependencies": ["2026-01-01-other.xbrief.json"],
      "x-canonical/swarm": {
        filesScope: ["src/a/"],
        verifyCommands: ["task check"],
        readiness: "ready",
      },
      "x-canonical/delivery": {
        disposition: "delivered",
        pr: "https://github.com/x/y/pull/2",
        sha: "abc123",
        branch: "main",
      },
    });
    expectSchemaValid(doc);
    expect(coreFindings(doc)).toEqual([]);
  });

  it("scope:new skeleton", () => {
    const doc = buildScopeSkeleton("Add login rate limiting", new Date("2026-08-06T12:00:00Z"));
    expectSchemaValid(doc);
    expect(coreFindings(doc)).toEqual([]);
  });

  it("init PROJECT skeleton", () => {
    const doc = buildProjectSkeleton("my-project");
    expectSchemaValid(doc);
    expect(coreFindings(doc)).toEqual([]);
  });

  it("post-transition scope state (transitionScope output)", () => {
    const root = tempGitRepo();
    const rel = writeScopeFixture(root, "proposed", "2026-01-01-x.xbrief.json");
    const read = readScope(join(root, rel));
    if (!read.ok) {
      throw new Error(read.message);
    }
    const newRef = transitionScope(
      root,
      {
        path: join(root, rel),
        relPath: rel,
        folder: "proposed",
        filename: "2026-01-01-x.xbrief.json",
      },
      read.scope,
      "pending",
      new Date("2026-08-06T12:00:00Z"),
    );
    const after = readScope(newRef.path);
    if (!after.ok) {
      throw new Error(after.message);
    }
    expectSchemaValid(after.scope);
    expect(coreFindings(after.scope)).toEqual([]);
  });
});

describe("shipped core validator agrees with the spec's examples corpus", () => {
  const fixtures = readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith(".xbrief.json"))
    .sort();

  // invalid-cycle is invalid only under DAG analysis (edge cycle); it is
  // structurally schema-valid, and canonical performs no DAG checks because
  // it emits no edges. workflow-invoice-processing carries a colon-bearing
  // plan.id -- structurally invalid, and both oracles must flag it.
  const structurallyInvalid = new Set(["workflow-invoice-processing.xbrief.json"]);
  const dagOnlyInvalid = new Set(["invalid-cycle.xbrief.json"]);
  // Known upstream drift (pinned so a submodule bump surfaces the change):
  // both gantt examples carry date-only startDate/endDate values, which the
  // 0.8 schema's dateTime pattern (explicit Z/offset) rejects. Canonical
  // never emits those fields; its core validator checks only created/updated.
  const knownUpstreamDrift = new Set([
    "construction-project-gantt.xbrief.json",
    "software-development-gantt.xbrief.json",
  ]);

  for (const name of fixtures) {
    it(`agrees with ajv on ${name}`, () => {
      const doc: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, name), "utf8"));
      const findings = coreFindings(doc);
      if (structurallyInvalid.has(name)) {
        expect(validateSchema(doc)).toBe(false);
        expect(findings.length).toBeGreaterThan(0);
      } else if (dagOnlyInvalid.has(name)) {
        expectSchemaValid(doc);
        expect(findings).toEqual([]);
      } else if (knownUpstreamDrift.has(name)) {
        expect(validateSchema(doc)).toBe(false);
        expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
      } else {
        expectSchemaValid(doc);
        expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
      }
    });
  }
});

describe("serialization parity with the reference library", () => {
  it("canonicalStringify matches libxbrief-ts dumpsJson(canonical) on the examples corpus", async () => {
    // Deep import of the submodule's zod-free codec; vitest transforms the TS.
    const codec = (await import(
      "../../third_party/xBRIEF/libxbrief-ts/src/json-codec.js"
    )) as unknown as {
      dumpsJson: (doc: Record<string, unknown>, opts?: { canonical?: boolean }) => string;
    };
    const fixtures = readdirSync(EXAMPLES_DIR)
      .filter((name) => name.endsWith(".xbrief.json"))
      .sort();
    for (const name of fixtures) {
      const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, name), "utf8")) as Record<
        string,
        unknown
      >;
      expect(canonicalStringify(doc), name).toBe(codec.dumpsJson(doc, { canonical: true }));
    }
  });
});

describe("extension round-trip preservation (spec section 7.2)", () => {
  it("foreign x-<token>/ keys at every level survive transitionScope + writeScope", () => {
    const root = tempGitRepo();
    const filename = "2026-01-01-roundtrip.xbrief.json";
    const rel = writeScopeFixture(
      root,
      "proposed",
      filename,
      {
        "x-other/planNote": { nested: ["a", 1, null] },
        items: [{ ...acceptanceItem("ac1", "thing"), "x-other/itemFlag": true }],
        references: [
          {
            uri: "https://example.com",
            type: "x-canonical/user-request",
            "x-canonical/trust": "internal",
            "x-other/refMeta": "kept",
          },
        ],
      },
      {
        "x-other/rootBlob": { deep: { keys: [1, 2, 3] } },
        xBRIEFInfo: { version: "0.8", "x-other/infoTag": "kept" },
      },
    );
    const read = readScope(join(root, rel));
    if (!read.ok) {
      throw new Error(read.message);
    }
    const newRef = transitionScope(
      root,
      { path: join(root, rel), relPath: rel, folder: "proposed", filename },
      read.scope,
      "pending",
      new Date("2026-08-06T12:00:00Z"),
    );
    const after = readScope(newRef.path);
    if (!after.ok) {
      throw new Error(after.message);
    }
    const doc = after.scope as ScopeDoc;
    expect(doc["x-other/rootBlob"]).toEqual({ deep: { keys: [1, 2, 3] } });
    expect(doc.xBRIEFInfo["x-other/infoTag"]).toBe("kept");
    expect(doc.plan["x-other/planNote"]).toEqual({ nested: ["a", 1, null] });
    expect((doc.plan.items[0] as Record<string, unknown>)["x-other/itemFlag"]).toBe(true);
    const firstRef = doc.plan.references?.[0] as Record<string, unknown> | undefined;
    expect(firstRef?.["x-other/refMeta"]).toBe("kept");
    // And the mutated fields did change:
    expect(doc.plan.status).toBe("pending");
  });

  it("writeScope re-serialization is byte-stable (idempotent canonical form)", () => {
    const root = tempGitRepo();
    const rel = writeScopeFixture(root, "proposed", "2026-01-01-stable.xbrief.json");
    const read = readScope(join(root, rel));
    if (!read.ok) {
      throw new Error(read.message);
    }
    writeScope(root, rel, read.scope);
    const once = readFileSync(join(root, rel), "utf8");
    const reread = readScope(join(root, rel));
    if (!reread.ok) {
      throw new Error(reread.message);
    }
    writeScope(root, rel, reread.scope);
    expect(readFileSync(join(root, rel), "utf8")).toBe(once);
  });
});
