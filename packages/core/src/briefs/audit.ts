import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertContained } from "../fs/contained-write.js";

/** Append-only audit log at briefs/audit.jsonl (content/state.md Layout). */

export interface AuditRecord {
  readonly ts: string;
  readonly kind: string;
  readonly [key: string]: unknown;
}

export function auditLogPath(projectRoot: string): string {
  return join(projectRoot, "briefs", "audit.jsonl");
}

export function appendAudit(
  projectRoot: string,
  record: Omit<AuditRecord, "ts"> & { readonly ts?: string },
  now: Date = new Date(),
): void {
  const abs = assertContained(projectRoot, "briefs/audit.jsonl");
  const full: AuditRecord = { ts: record.ts ?? now.toISOString(), ...record } as AuditRecord;
  if (!existsSync(dirname(abs))) {
    mkdirSync(dirname(abs), { recursive: true });
  }
  appendFileSync(abs, `${JSON.stringify(full)}\n`, "utf8");
}
