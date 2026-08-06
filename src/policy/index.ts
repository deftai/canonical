import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { atomicWriteText } from "../fs/contained-write.js";
import type {
  PolicyBlock,
  PolicyFieldName,
  ProjectDoc,
  ProjectPolicy,
  QualityBlock,
} from "../types/index.js";
import {
  POLICY_DEFAULTS,
  PROJECT_BRIEF_NAME,
  REGISTERED_POLICY_FIELDS,
  XBRIEF_VERSION,
} from "../types/index.js";
import { appendAudit } from "../xbrief/audit.js";
import { canonicalStringify } from "../xbrief/brief-io.js";

/**
 * Typed policy read/write over xbrief/PROJECT.xbrief.json (content/state.md
 * "Project Policy"). The project brief is an xBRIEF v0.8 document; policy and
 * quality ride in `x-canonical/*` extension properties on its plan.
 */

export function projectBriefPath(projectRoot: string): string {
  return join(projectRoot, "xbrief", PROJECT_BRIEF_NAME);
}

/** Minimal conformant PROJECT.xbrief.json body: the project as perpetual root plan. */
export function buildProjectSkeleton(title: string): ProjectDoc {
  return {
    xBRIEFInfo: { version: XBRIEF_VERSION },
    plan: {
      title,
      status: "running",
      items: [],
      "x-canonical/policy": {},
    },
  };
}

export type ReadProjectResult =
  | { readonly ok: true; readonly project: ProjectDoc }
  | { readonly ok: false; readonly message: string };

export function readProjectBrief(projectRoot: string): ReadProjectResult {
  const path = projectBriefPath(projectRoot);
  if (!existsSync(path)) {
    return { ok: true, project: {} };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: `${path}: not a JSON object` };
    }
    return { ok: true, project: parsed as ProjectDoc };
  } catch (err) {
    return { ok: false, message: `${path}: invalid JSON (${(err as Error).message})` };
  }
}

/** The plan["x-canonical/policy"] block, or {} when absent. */
export function projectPolicyBlock(project: ProjectDoc): PolicyBlock {
  return project.plan?.["x-canonical/policy"] ?? {};
}

/** The plan["x-canonical/quality"] block, or {} when absent. */
export function projectQualityBlock(project: ProjectDoc): QualityBlock {
  return project.plan?.["x-canonical/quality"] ?? {};
}

/** Effective policy: PROJECT doc x-canonical/policy over POLICY_DEFAULTS. requireHumanMerge defaults true when autoDeployOnMerge. */
export function resolvePolicy(projectRoot: string): ProjectPolicy | { readonly error: string } {
  const read = readProjectBrief(projectRoot);
  if (!read.ok) {
    return { error: read.message };
  }
  const p = projectPolicyBlock(read.project);
  const autoDeploy = p.autoDeployOnMerge ?? POLICY_DEFAULTS.autoDeployOnMerge;
  return {
    allowDirectCommitsToDefault:
      p.allowDirectCommitsToDefault ?? POLICY_DEFAULTS.allowDirectCommitsToDefault,
    wipCap: p.wipCap ?? POLICY_DEFAULTS.wipCap,
    deliveryBranch: p.deliveryBranch ?? POLICY_DEFAULTS.deliveryBranch,
    requireHumanMerge:
      p.requireHumanMerge ?? (autoDeploy ? true : POLICY_DEFAULTS.requireHumanMerge),
    autoDeployOnMerge: autoDeploy,
    runtimeAuthority: {
      denyPaths: p.runtimeAuthority?.denyPaths ?? POLICY_DEFAULTS.runtimeAuthority.denyPaths,
    },
  };
}

export function isRegisteredPolicyField(field: string): field is PolicyFieldName {
  return (REGISTERED_POLICY_FIELDS as readonly string[]).includes(field);
}

export interface SetPolicyOptions {
  readonly field: PolicyFieldName;
  readonly rawValue: string;
  readonly actor: string;
}

export type SetPolicyResult =
  | { readonly ok: true; readonly old: unknown; readonly new: unknown }
  | { readonly ok: false; readonly message: string };

type CoerceResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly bad: string };

function coerceValue(field: PolicyFieldName, raw: string): CoerceResult {
  switch (field) {
    case "allowDirectCommitsToDefault":
    case "requireHumanMerge":
    case "autoDeployOnMerge": {
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return { ok: false, bad: `${field} expects true|false, got ${JSON.stringify(raw)}` };
    }
    case "wipCap": {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, bad: `wipCap expects a positive integer, got ${JSON.stringify(raw)}` };
      }
      return { ok: true, value: n };
    }
    case "deliveryBranch":
      return { ok: true, value: raw };
    case "runtimeAuthority.denyPaths": {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
          return { ok: false, bad: "runtimeAuthority.denyPaths expects a JSON string array" };
        }
        return { ok: true, value: parsed };
      } catch {
        return { ok: false, bad: "runtimeAuthority.denyPaths expects a JSON string array" };
      }
    }
  }
}

export function setPolicy(projectRoot: string, opts: SetPolicyOptions): SetPolicyResult {
  const read = readProjectBrief(projectRoot);
  if (!read.ok) {
    return { ok: false, message: read.message };
  }
  const coercedResult = coerceValue(opts.field, opts.rawValue);
  if (!coercedResult.ok) {
    return { ok: false, message: coercedResult.bad };
  }
  const coerced = coercedResult.value;
  // A missing PROJECT doc gets the conformant skeleton before the policy write.
  const base =
    read.project.plan === undefined
      ? buildProjectSkeleton(basename(resolve(projectRoot)))
      : read.project;
  const project = base as Record<string, unknown>;
  const plan = { ...((project.plan as Record<string, unknown> | undefined) ?? {}) };
  const policy = { ...((plan["x-canonical/policy"] as Record<string, unknown> | undefined) ?? {}) };

  let oldValue: unknown;
  if (opts.field === "runtimeAuthority.denyPaths") {
    const ra = { ...((policy.runtimeAuthority as Record<string, unknown> | undefined) ?? {}) };
    oldValue = ra.denyPaths;
    ra.denyPaths = coerced;
    policy.runtimeAuthority = ra;
  } else {
    oldValue = policy[opts.field];
    policy[opts.field] = coerced;
  }

  plan["x-canonical/policy"] = policy;
  const next = { ...project, plan };
  atomicWriteText(projectRoot, `xbrief/${PROJECT_BRIEF_NAME}`, canonicalStringify(next));
  appendAudit(projectRoot, {
    kind: "policy-set",
    field: opts.field,
    old: oldValue ?? null,
    new: coerced,
    actor: opts.actor,
  });
  return { ok: true, old: oldValue ?? null, new: coerced };
}
