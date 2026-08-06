import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  LifecycleFolder,
  ScopeDoc,
  ValidationFinding,
  ValidationReport,
} from "../types/index.js";
import {
  CONTINUE_BRIEF_NAME,
  FOLDER_STATUS_MAP,
  PLAN_BRIEF_NAME,
  PLAN_ITEM_STATUSES,
  PLAN_STATUSES,
  PROJECT_BRIEF_NAME,
  REFERENCE_TYPE_RE,
  SCOPE_KINDS,
  SCOPE_STATUSES,
  SPEC_BRIEF_NAME,
  SWARM_READINESS,
  TRUST_LEVELS,
  XBRIEF_REFERENCE_REGISTRY,
  XBRIEF_VERSION,
} from "../types/index.js";
import { isValidScopeFilename, listScopes, readScope } from "./brief-io.js";

/**
 * `state:validate` -- layered checks per content/canonical-tasks.md
 * (`state:validate` section) and content/state.md:
 *   1. parse (invalid-json)
 *   2. core xBRIEF v0.8 conformance (validateCoreDocument -- mirrors
 *      third_party/xBRIEF schema semantics; the conformance test suite pins
 *      it against the real JSON Schema and the spec's examples corpus)
 *   3. canonical profile (folders, filenames, x-canonical/* blocks)
 * Pure: reads `xbrief/**` relative to `projectRoot`, never throws, never writes.
 * Canonical emits no `edges`, so DAG constraints are not checked here.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** xBRIEF dateTime: ISO-8601 with an explicit Z or numeric offset (spec $defs/dateTime). */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isDateTime(value: unknown): value is string {
  return typeof value === "string" && DATE_TIME_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Plan/PlanItem id: dot-notation hierarchy, no colons (spec section 4.3). */
const ID_RE = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/;

/** Extension property name (spec section 7.1). */
const EXTENSION_KEY_RE = /^x-[a-z0-9-]+\//;

const ROOT_DOC_NAMES = [
  PROJECT_BRIEF_NAME,
  SPEC_BRIEF_NAME,
  PLAN_BRIEF_NAME,
  CONTINUE_BRIEF_NAME,
] as const;

const LEGACY_ROOT_NAMES = ["PROJECT.json", "spec.json", "plan.json", "continue.json"] as const;

export function validateState(projectRoot: string): ValidationReport {
  const findings: ValidationFinding[] = [];
  const refs = listScopes(projectRoot);
  const originUriFile = new Map<string, string>();
  let scanned = 0;

  for (const ref of refs) {
    scanned += 1;
    if (!ref.filename.endsWith(".xbrief.json")) {
      findings.push({
        file: ref.relPath,
        code: "legacy-file",
        message:
          "legacy pre-0.3 scope file -- state files are xBRIEF v0.8 documents named *.xbrief.json (re-run `canon init` and recreate scopes; see CHANGELOG 0.3.0)",
      });
      continue;
    }
    if (!isValidScopeFilename(ref.filename)) {
      findings.push({
        file: ref.relPath,
        code: "bad-filename",
        message:
          "filename must match YYYY-MM-DD-<slug>.xbrief.json (slug [a-z0-9]+(-[a-z0-9]+)*, <=80 chars)",
      });
    }

    const result = readScope(ref.path);
    if (!result.ok) {
      findings.push({ file: ref.relPath, code: "invalid-json", message: result.message });
      continue;
    }

    const doc = validateCoreDocument(ref.relPath, result.scope as unknown, findings);
    if (doc === null) {
      continue;
    }
    validateScopeProfile(ref.relPath, ref.folder, doc, findings, originUriFile);
  }

  scanned += validateRootDocs(projectRoot, findings);

  return { ok: findings.length === 0, findings, scanned };
}

/**
 * Core xBRIEF v0.8 conformance for one parsed document. Emits findings and
 * returns the document when its envelope+plan are usable for profile checks,
 * or null when the shape is too broken to continue.
 */
export function validateCoreDocument(
  file: string,
  raw: unknown,
  findings: ValidationFinding[],
): ScopeDoc | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    findings.push({ file, code: "bad-envelope", message: "document must be a JSON object" });
    return null;
  }
  const doc = raw as Record<string, unknown>;

  for (const legacy of ["todoList", "playbook"]) {
    if (legacy in doc) {
      findings.push({
        file,
        code: "bad-envelope",
        message: `legacy container "${legacy}" is forbidden in xBRIEF v0.5+ documents`,
      });
    }
  }

  const info = doc.xBRIEFInfo;
  if (typeof info !== "object" || info === null || Array.isArray(info)) {
    findings.push({
      file,
      code: "bad-envelope",
      message: "missing xBRIEFInfo envelope (object with a version field)",
    });
  } else {
    const version = (info as Record<string, unknown>).version;
    if (version !== XBRIEF_VERSION) {
      findings.push({
        file,
        code: "bad-version",
        message: `xBRIEFInfo.version must be "${XBRIEF_VERSION}", got ${JSON.stringify(version)}`,
      });
    }
  }

  const planRaw = doc.plan;
  if (typeof planRaw !== "object" || planRaw === null || Array.isArray(planRaw)) {
    findings.push({ file, code: "missing-plan", message: "plan must be an object" });
    return null;
  }
  const plan = planRaw as Record<string, unknown>;

  if (!isNonEmptyString(plan.title)) {
    findings.push({ file, code: "bad-title", message: "plan.title must be a non-empty string" });
  }
  if (plan.id !== undefined && (typeof plan.id !== "string" || !ID_RE.test(plan.id))) {
    findings.push({
      file,
      code: "bad-plan-id",
      message: `plan.id must match ${ID_RE} (dot-notation hierarchy, no colons)`,
    });
  }
  if (
    typeof plan.status !== "string" ||
    !(PLAN_STATUSES as readonly string[]).includes(plan.status)
  ) {
    findings.push({
      file,
      code: "bad-plan-status",
      message: `plan.status must be one of ${PLAN_STATUSES.join("|")}, got ${JSON.stringify(plan.status)}`,
    });
  }
  if (!Array.isArray(plan.items)) {
    findings.push({
      file,
      code: "bad-item",
      message: "plan.items must be an array (may be empty)",
    });
  } else {
    const seenIds = new Set<string>();
    plan.items.forEach((item, idx) => {
      validateCoreItem(file, `plan.items[${idx}]`, item, findings, seenIds);
    });
  }

  for (const field of ["created", "updated"] as const) {
    if (plan[field] !== undefined && !isDateTime(plan[field])) {
      findings.push({
        file,
        code: `bad-plan-${field}`,
        message: `plan.${field} must be an ISO-8601 timestamp with an explicit Z or numeric offset`,
      });
    }
  }

  const narratives = plan.narratives;
  if (narratives !== undefined) {
    if (typeof narratives !== "object" || narratives === null || Array.isArray(narratives)) {
      findings.push({ file, code: "bad-narrative", message: "plan.narratives must be an object" });
    } else {
      for (const [key, value] of Object.entries(narratives)) {
        if (typeof value !== "string") {
          findings.push({
            file,
            code: "bad-narrative",
            message: `plan.narratives.${key} must be a string`,
          });
        }
      }
    }
  }

  validateCoreReferences(file, plan.references, findings);

  return doc as unknown as ScopeDoc;
}

function validateCoreItem(
  file: string,
  path: string,
  raw: unknown,
  findings: ValidationFinding[],
  seenIds: Set<string>,
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    findings.push({ file, code: "bad-item", message: `${path} must be an object` });
    return;
  }
  const item = raw as Record<string, unknown>;
  if (!isNonEmptyString(item.title)) {
    findings.push({ file, code: "bad-item", message: `${path}.title must be a non-empty string` });
  }
  const status = item.status;
  if (typeof status !== "string" || !(PLAN_ITEM_STATUSES as readonly string[]).includes(status)) {
    findings.push({
      file,
      code: "bad-item",
      message: `${path}.status must be one of ${PLAN_ITEM_STATUSES.join("|")}`,
    });
  }
  const children = [
    ...(Array.isArray(item.items) ? item.items : []),
    ...(Array.isArray(item.subItems) ? item.subItems : []),
  ];
  const planRefs = Array.isArray(item.planRefs) ? item.planRefs : [];
  if (status === "auto") {
    const containerType =
      typeof item.type === "string" && ["group", "milestone", "epic"].includes(item.type);
    if (!containerType || (children.length === 0 && planRefs.length === 0)) {
      findings.push({
        file,
        code: "bad-item",
        message: `${path}.status "auto" is only legal on group|milestone|epic items with children`,
      });
    }
  }
  if (item.id !== undefined) {
    if (typeof item.id !== "string" || !ID_RE.test(item.id)) {
      findings.push({
        file,
        code: "bad-item",
        message: `${path}.id must match ${ID_RE} (dot-notation hierarchy, no colons)`,
      });
    } else if (seenIds.has(item.id)) {
      findings.push({
        file,
        code: "bad-item",
        message: `${path}.id "${item.id}" duplicates another item id in this plan`,
      });
    } else {
      seenIds.add(item.id);
    }
  }
  children.forEach((child, idx) => {
    validateCoreItem(file, `${path}.items[${idx}]`, child, findings, seenIds);
  });
}

function validateCoreReferences(
  file: string,
  referencesRaw: unknown,
  findings: ValidationFinding[],
): void {
  if (referencesRaw === undefined) {
    return;
  }
  if (!Array.isArray(referencesRaw)) {
    findings.push({ file, code: "bad-references", message: "plan.references must be an array" });
    return;
  }
  referencesRaw.forEach((entry, idx) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}] must be an object`,
      });
      return;
    }
    const ref = entry as Record<string, unknown>;
    if (!isNonEmptyString(ref.uri)) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}].uri must be a non-empty string`,
      });
    }
    const type = ref.type;
    if (typeof type !== "string" || !REFERENCE_TYPE_RE.test(type)) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}].type must match ^x-<token>/... (e.g. x-xbrief/github-issue)`,
      });
    } else if (
      type.startsWith("x-xbrief/") &&
      !(XBRIEF_REFERENCE_REGISTRY as readonly string[]).includes(type)
    ) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}].type "${type}" is not in the spec-administered x-xbrief/ registry (${XBRIEF_REFERENCE_REGISTRY.join("|")})`,
      });
    }
  });
}

/** Canonical-profile checks for one lifecycle scope document (content/state.md). */
function validateScopeProfile(
  file: string,
  folder: LifecycleFolder,
  doc: ScopeDoc,
  findings: ValidationFinding[],
  originUriFile: Map<string, string>,
): void {
  const plan = doc.plan as Record<string, unknown>;

  for (const key of Object.keys(doc)) {
    if (key !== "xBRIEFInfo" && key !== "plan" && !EXTENSION_KEY_RE.test(key)) {
      findings.push({
        file,
        code: "bad-envelope",
        message: `root key "${key}" is not allowed -- scope documents carry only xBRIEFInfo, plan, and x-<token>/ extensions`,
      });
    }
  }

  const status = plan.status;
  if (typeof status === "string" && (PLAN_STATUSES as readonly string[]).includes(status)) {
    if (!(SCOPE_STATUSES as readonly string[]).includes(status)) {
      findings.push({
        file,
        code: "bad-plan-status",
        message: `scope status must be one of ${SCOPE_STATUSES.join("|")} (canonical profile), got "${status}"`,
      });
    } else {
      const allowed = FOLDER_STATUS_MAP[folder] as readonly string[];
      if (!allowed.includes(status)) {
        findings.push({
          file,
          code: "folder-status-mismatch",
          message: `status "${status}" is not valid in folder "${folder}" (expected one of ${allowed.join("|")})`,
        });
      }
    }
  }

  for (const field of ["created", "updated"] as const) {
    if (plan[field] === undefined) {
      findings.push({
        file,
        code: `bad-plan-${field}`,
        message: `plan.${field} is required on scope documents`,
      });
    }
  }

  const kind = plan["x-canonical/kind"];
  if (typeof kind !== "string" || !(SCOPE_KINDS as readonly string[]).includes(kind)) {
    findings.push({
      file,
      code: "bad-kind",
      message: `plan["x-canonical/kind"] must be one of ${SCOPE_KINDS.join("|")}, got ${JSON.stringify(kind)}`,
    });
  }

  if (Array.isArray(plan.items)) {
    plan.items.forEach((raw, idx) => {
      if (typeof raw !== "object" || raw === null) {
        return; // core already flagged it
      }
      const item = raw as Record<string, unknown>;
      if (!isNonEmptyString(item.id)) {
        findings.push({
          file,
          code: "bad-item",
          message: `plan.items[${idx}].id is required on acceptance items (e.g. "ac${idx + 1}")`,
        });
      }
      if (item.status !== "pending" && item.status !== "completed") {
        findings.push({
          file,
          code: "bad-item",
          message: `plan.items[${idx}].status must be pending|completed on acceptance items`,
        });
      }
    });
  }

  const hasIssueRef = validateProfileReferences(file, plan.references, findings, originUriFile);
  if (hasIssueRef) {
    const narratives = plan.narratives;
    const origin =
      typeof narratives === "object" && narratives !== null
        ? (narratives as Record<string, unknown>).Origin
        : undefined;
    if (!isNonEmptyString(origin)) {
      findings.push({
        file,
        code: "missing-origin-narrative",
        message: "scope has an issue reference but no narratives.Origin",
      });
    }
  }

  const dependencies = plan["x-canonical/dependencies"];
  if (dependencies !== undefined) {
    if (!isStringArray(dependencies)) {
      findings.push({
        file,
        code: "bad-dependency",
        message: `plan["x-canonical/dependencies"] must be an array of scope filenames`,
      });
    } else {
      for (const dep of dependencies) {
        if (!isValidScopeFilename(dep)) {
          findings.push({
            file,
            code: "bad-dependency",
            message: `dependency "${dep}" is not a valid scope filename (YYYY-MM-DD-<slug>.xbrief.json)`,
          });
        }
      }
    }
  }

  validateSwarm(file, plan["x-canonical/swarm"], plan.items, findings);
}

/** Validates profile rules on references[]; returns true when the scope carries an issue-origin reference. */
function validateProfileReferences(
  file: string,
  referencesRaw: unknown,
  findings: ValidationFinding[],
  originUriFile: Map<string, string>,
): boolean {
  if (!Array.isArray(referencesRaw)) {
    return false;
  }
  let hasIssueRef = false;
  referencesRaw.forEach((entry, idx) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return; // core already flagged it
    }
    const ref = entry as Record<string, unknown>;
    const trust = ref["x-canonical/trust"];
    if (typeof trust !== "string" || !(TRUST_LEVELS as readonly string[]).includes(trust)) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}]["x-canonical/trust"] must be one of ${TRUST_LEVELS.join("|")}`,
      });
    }
    if (ref.type === "x-xbrief/github-issue" && isNonEmptyString(ref.uri)) {
      hasIssueRef = true;
      const existing = originUriFile.get(ref.uri);
      if (existing === undefined) {
        originUriFile.set(ref.uri, file);
      } else if (existing !== file) {
        findings.push({
          file,
          code: "duplicate-origin-uri",
          message: `origin uri "${ref.uri}" already used by ${existing}`,
        });
      }
    }
  });
  return hasIssueRef;
}

function validateSwarm(
  file: string,
  swarmRaw: unknown,
  itemsRaw: unknown,
  findings: ValidationFinding[],
): void {
  if (swarmRaw === undefined) {
    return;
  }
  if (typeof swarmRaw !== "object" || swarmRaw === null || Array.isArray(swarmRaw)) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: "x-canonical/swarm must be an object",
    });
    return;
  }
  const swarm = swarmRaw as Record<string, unknown>;
  const filesScopeOk = isStringArray(swarm.filesScope);
  const verifyCommandsOk = isStringArray(swarm.verifyCommands);

  if (!filesScopeOk) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: "swarm.filesScope must be an array of strings",
    });
  }
  if (!verifyCommandsOk) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: "swarm.verifyCommands must be an array of strings",
    });
  }
  if (
    typeof swarm.readiness !== "string" ||
    !(SWARM_READINESS as readonly string[]).includes(swarm.readiness)
  ) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: `swarm.readiness must be one of ${SWARM_READINESS.join("|")}`,
    });
  }

  if (swarm.readiness === "ready") {
    if (!filesScopeOk || (swarm.filesScope as unknown[]).length === 0) {
      findings.push({
        file,
        code: "swarm-ready-empty-file-scope",
        message: "swarm.readiness=ready requires a non-empty filesScope",
      });
    }
    if (!verifyCommandsOk || (swarm.verifyCommands as unknown[]).length === 0) {
      findings.push({
        file,
        code: "swarm-ready-empty-verify-commands",
        message: "swarm.readiness=ready requires non-empty verifyCommands",
      });
    }
    const count = Array.isArray(itemsRaw) ? itemsRaw.length : 0;
    if (count < 2 || count > 5) {
      findings.push({
        file,
        code: "swarm-ready-acceptance-count",
        message: `swarm.readiness=ready requires 2-5 acceptance items, got ${count}`,
      });
    }
  }
}

/** Scan the root docs under xbrief/: envelope conformance + per-doc profile bits. Returns files scanned. */
function validateRootDocs(projectRoot: string, findings: ValidationFinding[]): number {
  let scanned = 0;

  for (const legacy of LEGACY_ROOT_NAMES) {
    const rel = `xbrief/${legacy}`;
    if (existsSync(join(projectRoot, rel))) {
      scanned += 1;
      findings.push({
        file: rel,
        code: "legacy-file",
        message: `legacy pre-0.3 root file -- replace with ${legacy.replace(".json", ".xbrief.json")} (xBRIEF v0.8 envelope; re-run \`canon init\` for a fresh skeleton)`,
      });
    }
  }

  for (const name of ROOT_DOC_NAMES) {
    const rel = `xbrief/${name}`;
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) {
      continue;
    }
    scanned += 1;
    const result = readScope(abs);
    if (!result.ok) {
      findings.push({ file: rel, code: "invalid-json", message: result.message });
      continue;
    }
    const doc = validateCoreDocument(rel, result.scope as unknown, findings);
    if (doc === null) {
      continue;
    }
    const plan = doc.plan as Record<string, unknown>;
    if (name === PLAN_BRIEF_NAME) {
      const sequence = plan["x-canonical/sequence"];
      if (sequence !== undefined && !isStringArray(sequence)) {
        findings.push({
          file: rel,
          code: "bad-root-doc",
          message: `plan["x-canonical/sequence"] must be an array of scope rel-paths`,
        });
      }
    }
    if (name === PROJECT_BRIEF_NAME) {
      const policy = plan["x-canonical/policy"];
      if (policy !== undefined && (typeof policy !== "object" || Array.isArray(policy))) {
        findings.push({
          file: rel,
          code: "bad-root-doc",
          message: `plan["x-canonical/policy"] must be an object`,
        });
      }
    }
  }

  return scanned;
}
