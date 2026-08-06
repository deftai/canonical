/** `policy` -- content/canonical-tasks.md. `show [--field=]` | `set --field= --value= --confirm`. */
import { parseArgs, renderJson } from "../args/index.js";
import {
  isRegisteredPolicyField,
  projectPolicyBlock,
  readProjectBrief,
  resolvePolicy,
  setPolicy,
} from "../policy/index.js";
import type { GateExitCode, PolicyFieldName, ProjectPolicy } from "../types/index.js";
import { REGISTERED_POLICY_FIELDS } from "../types/index.js";

function formatPolicyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function getEffectiveValue(policy: ProjectPolicy, field: PolicyFieldName): unknown {
  if (field === "runtimeAuthority.denyPaths") {
    return policy.runtimeAuthority.denyPaths;
  }
  return policy[field];
}

function isExplicitlySet(rawPolicy: Record<string, unknown>, field: PolicyFieldName): boolean {
  if (field === "runtimeAuthority.denyPaths") {
    const ra = rawPolicy.runtimeAuthority as Record<string, unknown> | undefined;
    return ra?.denyPaths !== undefined;
  }
  return rawPolicy[field] !== undefined;
}

function emitFailure(
  json: boolean,
  code: GateExitCode,
  message: string,
  extra: Record<string, unknown> = {},
): number {
  if (json) {
    process.stdout.write(`${renderJson({ ok: false, code, message, ...extra })}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  return code;
}

function emitSuccess(json: boolean, message: string, extra: Record<string, unknown> = {}): number {
  if (json) {
    process.stdout.write(`${renderJson({ ok: true, code: 0, message, ...extra })}\n`);
  } else {
    process.stdout.write(`${message}\n`);
  }
  return 0;
}

function runShow(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["field", "project-root"],
    boolFlags: ["json"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: policy show: ${parsed.error}\n`);
    return 2;
  }
  const json = parsed.flags.json === true;
  const field = parsed.values.field;
  if (field !== undefined && !isRegisteredPolicyField(field)) {
    return emitFailure(json, 1, `unknown policy field: ${field}`);
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const resolved = resolvePolicy(projectRoot);
  if ("error" in resolved) {
    return emitFailure(json, 2, resolved.error);
  }
  const briefRead = readProjectBrief(projectRoot);
  if (!briefRead.ok) {
    return emitFailure(json, 2, briefRead.message);
  }
  const rawPolicy: Record<string, unknown> = projectPolicyBlock(briefRead.project) as Record<
    string,
    unknown
  >;

  const targetFields: readonly PolicyFieldName[] =
    field !== undefined && isRegisteredPolicyField(field) ? [field] : REGISTERED_POLICY_FIELDS;

  const rows = targetFields.map((f) => ({
    field: f,
    value: getEffectiveValue(resolved, f),
    default: !isExplicitlySet(rawPolicy, f),
  }));

  if (json) {
    process.stdout.write(`${renderJson({ ok: true, code: 0, fields: rows })}\n`);
    return 0;
  }
  for (const row of rows) {
    const suffix = row.default ? " (default)" : "";
    process.stdout.write(`policy.${row.field} = ${formatPolicyValue(row.value)}${suffix}\n`);
  }
  return 0;
}

function runSet(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["field", "value", "project-root"],
    boolFlags: ["confirm", "json"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: policy set: ${parsed.error}\n`);
    return 2;
  }
  const json = parsed.flags.json === true;
  const field = parsed.values.field;
  const rawValue = parsed.values.value;
  if (field === undefined || rawValue === undefined) {
    process.stderr.write("canon: policy set: requires --field and --value\n");
    return 2;
  }
  if (!isRegisteredPolicyField(field)) {
    return emitFailure(json, 1, `unknown policy field: ${field}`);
  }
  if (parsed.flags.confirm !== true) {
    return emitFailure(json, 1, "policy set requires --confirm");
  }

  const projectRoot = parsed.values["project-root"] ?? process.cwd();
  const actor = process.env.CANON_ACTOR ?? "cli";
  const result = setPolicy(projectRoot, { field, rawValue, actor });
  if (!result.ok) {
    return emitFailure(json, 1, result.message);
  }
  const message = `policy.${field}: ${formatPolicyValue(result.old)} -> ${formatPolicyValue(result.new)}`;
  return emitSuccess(json, message, { field, old: result.old, new: result.new });
}

export function run(argv: string[]): number {
  const [sub, ...rest] = argv;
  if (sub === "show") {
    return runShow(rest);
  }
  if (sub === "set") {
    return runSet(rest);
  }
  process.stderr.write("canon: policy: expected 'show' or 'set'\n");
  return 2;
}
