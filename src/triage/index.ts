import { resolvePolicy } from "../policy/index.js";
import type { ScopeDoc, ScopeReference } from "../types/index.js";
import { withPlan } from "../types/index.js";
import { appendAudit } from "../xbrief/audit.js";
import {
  findScope,
  listScopes,
  readScope,
  transitionScope,
  writeScope,
} from "../xbrief/brief-io.js";

/**
 * `triage` verb (content/canonical-tasks.md #triage, content/state.md Lifecycle).
 * Decides the fate of a proposed/ candidate. Every decision appends one
 * {kind:"triage", verb, scope, note?} row to xbrief/audit.jsonl; accept over
 * the WIP cap additionally appends a {kind:"wip-cap-override"} row when
 * `force` is used to push through.
 */

export const TRIAGE_VERBS = ["accept", "reject", "defer", "duplicate"] as const;
export type TriageVerb = (typeof TRIAGE_VERBS)[number];

export function isTriageVerb(value: string): value is TriageVerb {
  return (TRIAGE_VERBS as readonly string[]).includes(value);
}

export interface TriageOptions {
  readonly verb: TriageVerb;
  /** Identifier resolved via findScope (relative path, filename, or slug fragment). */
  readonly scope: string;
  readonly note?: string;
  /** accept: override the WIP cap. */
  readonly force?: boolean;
  /**
   * duplicate: URI of the winning scope/origin this candidate duplicates.
   * Recorded as a `{type: "x-xbrief/plan", "x-canonical/trust": "internal"}` reference.
   */
  readonly winningUri?: string;
  readonly now?: Date;
}

export type TriageResult =
  | {
      readonly ok: true;
      readonly verb: TriageVerb;
      readonly scope: string;
      readonly status: string;
      readonly wipCapOverride?: boolean;
    }
  | { readonly ok: false; readonly code: 1 | 2; readonly message: string };

const RESULT_STATUS: Readonly<Record<TriageVerb, "pending" | "cancelled" | "proposed">> = {
  accept: "pending",
  reject: "cancelled",
  defer: "proposed",
  duplicate: "cancelled",
};

function appendNote(existing: string | undefined, note: string): string {
  return existing !== undefined && existing !== "" ? `${existing}\n${note}` : note;
}

export function triageDecide(projectRoot: string, opts: TriageOptions): TriageResult {
  const now = opts.now ?? new Date();
  const found = findScope(projectRoot, opts.scope);
  if (found === null) {
    return { ok: false, code: 2, message: `no scope matching '${opts.scope}'` };
  }
  if ("ambiguous" in found) {
    return {
      ok: false,
      code: 2,
      message: `'${opts.scope}' is ambiguous: ${found.ambiguous.join(", ")}`,
    };
  }
  const ref = found;

  if (ref.folder !== "proposed") {
    return {
      ok: false,
      code: 1,
      message: `${ref.relPath} is not in proposed/ (folder: ${ref.folder}) -- triage only decides on candidates`,
    };
  }

  const readResult = readScope(ref.path);
  if (!readResult.ok) {
    return { ok: false, code: 2, message: readResult.message };
  }
  const scope = readResult.scope;

  let wipCapOverride = false;

  switch (opts.verb) {
    case "accept": {
      const policy = resolvePolicy(projectRoot);
      if ("error" in policy) {
        return { ok: false, code: 2, message: policy.error };
      }
      const wip = listScopes(projectRoot).filter(
        (s) => s.folder === "pending" || s.folder === "active",
      ).length;
      if (wip >= policy.wipCap) {
        if (opts.force !== true) {
          return {
            ok: false,
            code: 1,
            message: `WIP cap reached: ${wip}/${policy.wipCap} scopes in pending+active -- use --force to override`,
          };
        }
        wipCapOverride = true;
        appendAudit(
          projectRoot,
          { kind: "wip-cap-override", scope: ref.relPath, wip, wipCap: policy.wipCap },
          now,
        );
      }
      transitionScope(projectRoot, ref, scope, "pending", now);
      break;
    }
    case "reject": {
      transitionScope(projectRoot, ref, scope, "cancelled", now);
      break;
    }
    case "defer": {
      if (opts.note === undefined || opts.note.trim() === "") {
        return { ok: false, code: 2, message: "defer requires --note" };
      }
      const updated: ScopeDoc = withPlan(scope, {
        updated: now.toISOString(),
        narratives: {
          ...scope.plan.narratives,
          Note: appendNote(scope.plan.narratives?.Note, opts.note),
        },
      });
      writeScope(projectRoot, ref.relPath, updated);
      break;
    }
    case "duplicate": {
      if (opts.winningUri === undefined || opts.winningUri.trim() === "") {
        return { ok: false, code: 2, message: "duplicate requires a winning-uri" };
      }
      const reference: ScopeReference = {
        uri: opts.winningUri,
        type: "x-xbrief/plan",
        "x-canonical/trust": "internal",
      };
      const withReference: ScopeDoc = withPlan(scope, {
        references: [...(scope.plan.references ?? []), reference],
      });
      transitionScope(projectRoot, ref, withReference, "cancelled", now);
      break;
    }
  }

  appendAudit(
    projectRoot,
    {
      kind: "triage",
      verb: opts.verb,
      scope: ref.relPath,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    },
    now,
  );

  return {
    ok: true,
    verb: opts.verb,
    scope: ref.relPath,
    status: RESULT_STATUS[opts.verb],
    ...(wipCapOverride ? { wipCapOverride: true } : {}),
  };
}
