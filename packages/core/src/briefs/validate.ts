import type { LifecycleFolder, ValidationFinding, ValidationReport } from "@canonpack/types";
import {
  FOLDER_STATUS_MAP,
  REFERENCE_TYPES,
  SCOPE_KINDS,
  SCOPE_STATUSES,
  SWARM_READINESS,
  TRUST_LEVELS,
} from "@canonpack/types";
import { isValidScopeFilename, listScopes, readScope } from "./brief-io.js";

/**
 * `state:validate` -- every check named in content/canonical-tasks.md
 * (`state:validate` section) and content/state.md ("Scope Files",
 * "Origins & Trust", "Story Fields"). Pure: reads `briefs/**​/*.json`
 * relative to `projectRoot`, never throws, never writes.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function validateState(projectRoot: string): ValidationReport {
  const findings: ValidationFinding[] = [];
  const refs = listScopes(projectRoot);
  const originUriFile = new Map<string, string>();

  for (const ref of refs) {
    if (!isValidScopeFilename(ref.filename)) {
      findings.push({
        file: ref.relPath,
        code: "bad-filename",
        message:
          "filename must match YYYY-MM-DD-<slug>.json (slug [a-z0-9]+(-[a-z0-9]+)*, <=80 chars)",
      });
    }

    const result = readScope(ref.path);
    if (!result.ok) {
      findings.push({ file: ref.relPath, code: "invalid-json", message: result.message });
      continue;
    }

    validateScope(ref.relPath, ref.folder, result.scope as unknown, findings, originUriFile);
  }

  return { ok: findings.length === 0, findings, scanned: refs.length };
}

function validateScope(
  file: string,
  folder: LifecycleFolder,
  raw: unknown,
  findings: ValidationFinding[],
  originUriFile: Map<string, string>,
): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    findings.push({ file, code: "bad-shape", message: "scope must be a JSON object" });
    return;
  }
  const scope = raw as Record<string, unknown>;

  if (!isNonEmptyString(scope.title)) {
    findings.push({ file, code: "bad-title", message: "title must be a non-empty string" });
  }

  if (typeof scope.kind !== "string" || !(SCOPE_KINDS as readonly string[]).includes(scope.kind)) {
    findings.push({
      file,
      code: "bad-kind",
      message: `kind must be one of ${SCOPE_KINDS.join("|")}, got ${JSON.stringify(scope.kind)}`,
    });
  }

  const status = validatePlan(file, scope.plan, findings);
  if (status !== undefined) {
    const allowed = FOLDER_STATUS_MAP[folder] as readonly string[];
    if (!allowed.includes(status)) {
      findings.push({
        file,
        code: "folder-status-mismatch",
        message: `status "${status}" is not valid in folder "${folder}" (expected one of ${allowed.join("|")})`,
      });
    }
  }

  const hasIssueRef = validateReferences(file, scope.references, findings, originUriFile);

  if (hasIssueRef) {
    const narratives = scope.narratives;
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

  validateSwarm(file, scope.swarm, scope.items, findings);
}

function validatePlan(
  file: string,
  planRaw: unknown,
  findings: ValidationFinding[],
): string | undefined {
  if (typeof planRaw !== "object" || planRaw === null || Array.isArray(planRaw)) {
    findings.push({ file, code: "missing-plan", message: "plan must be an object" });
    return undefined;
  }
  const plan = planRaw as Record<string, unknown>;
  let status: string | undefined;
  if (
    typeof plan.status !== "string" ||
    !(SCOPE_STATUSES as readonly string[]).includes(plan.status)
  ) {
    findings.push({
      file,
      code: "bad-plan-status",
      message: `plan.status must be one of ${SCOPE_STATUSES.join("|")}, got ${JSON.stringify(plan.status)}`,
    });
  } else {
    status = plan.status;
  }
  if (!isIsoTimestamp(plan.created)) {
    findings.push({
      file,
      code: "bad-plan-created",
      message: "plan.created must be an ISO-8601 timestamp string",
    });
  }
  if (!isIsoTimestamp(plan.updated)) {
    findings.push({
      file,
      code: "bad-plan-updated",
      message: "plan.updated must be an ISO-8601 timestamp string",
    });
  }
  return status;
}

/** Validates references[]; returns true when the scope carries an issue-type reference. */
function validateReferences(
  file: string,
  referencesRaw: unknown,
  findings: ValidationFinding[],
  originUriFile: Map<string, string>,
): boolean {
  if (referencesRaw === undefined) {
    return false;
  }
  if (!Array.isArray(referencesRaw)) {
    findings.push({ file, code: "bad-references", message: "references must be an array" });
    return false;
  }

  let hasIssueRef = false;
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
    if (
      typeof ref.type !== "string" ||
      !(REFERENCE_TYPES as readonly string[]).includes(ref.type)
    ) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}].type must be one of ${REFERENCE_TYPES.join("|")}`,
      });
    }
    if (typeof ref.trust !== "string" || !(TRUST_LEVELS as readonly string[]).includes(ref.trust)) {
      findings.push({
        file,
        code: "bad-reference",
        message: `references[${idx}].trust must be one of ${TRUST_LEVELS.join("|")}`,
      });
    }
    if (ref.type === "issue" && isNonEmptyString(ref.uri)) {
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
    findings.push({ file, code: "bad-swarm-shape", message: "swarm must be an object" });
    return;
  }
  const swarm = swarmRaw as Record<string, unknown>;
  const fileScopeOk = isStringArray(swarm.file_scope);
  const verifyCommandsOk = isStringArray(swarm.verify_commands);

  if (!fileScopeOk) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: "swarm.file_scope must be an array of strings",
    });
  }
  if (!verifyCommandsOk) {
    findings.push({
      file,
      code: "bad-swarm-shape",
      message: "swarm.verify_commands must be an array of strings",
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
    if (!fileScopeOk || (swarm.file_scope as unknown[]).length === 0) {
      findings.push({
        file,
        code: "swarm-ready-empty-file-scope",
        message: "swarm.readiness=ready requires a non-empty file_scope",
      });
    }
    if (!verifyCommandsOk || (swarm.verify_commands as unknown[]).length === 0) {
      findings.push({
        file,
        code: "swarm-ready-empty-verify-commands",
        message: "swarm.readiness=ready requires non-empty verify_commands",
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
