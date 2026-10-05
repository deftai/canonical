import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStorage, StoredCredentials } from "@deft/collection-sdk";
import { atomicWriteJson } from "../fs/contained-write.js";
import {
  COLLECTION_FILE_REL,
  type CollectionFile,
  type MetricsRecord,
  normalize,
  type SubmissionsRecord,
  signal,
} from "./types.js";

export function collectionFilePath(projectRoot: string): string {
  return join(projectRoot, COLLECTION_FILE_REL);
}

export function readState(projectRoot: string): CollectionFile {
  const path = collectionFilePath(projectRoot);
  if (!existsSync(path)) {
    return {};
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  const { file, changed } = normalize(parsed);
  if (changed) {
    try {
      writeState(projectRoot, file);
    } catch {
      // best-effort persist; still return normalized view
    }
  }
  return file;
}

export function writeState(projectRoot: string, file: CollectionFile): void {
  atomicWriteJson(projectRoot, COLLECTION_FILE_REL, file);
  try {
    chmodSync(collectionFilePath(projectRoot), 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
}

export function updateState(
  projectRoot: string,
  fn: (file: CollectionFile) => CollectionFile,
): CollectionFile {
  const next = fn(readState(projectRoot));
  writeState(projectRoot, next);
  return next;
}

/** CredentialStorage adapter — save/clear keep all consent fields (STO-5). */
export function credentialStorage(projectRoot: string): CredentialStorage {
  return {
    async load(): Promise<StoredCredentials | null> {
      const file = readState(projectRoot);
      if (
        typeof file.installId === "string" &&
        file.installId.length > 0 &&
        typeof file.token === "string" &&
        file.token.length > 0
      ) {
        return { installId: file.installId, token: file.token };
      }
      return null;
    },
    async save(creds: StoredCredentials): Promise<void> {
      updateState(projectRoot, (existing) => ({
        ...existing,
        installId: creds.installId,
        token: creds.token,
      }));
    },
    async clear(): Promise<void> {
      updateState(projectRoot, (existing) => {
        const next: CollectionFile = {
          ...(existing.metrics !== undefined ? { metrics: existing.metrics } : {}),
          ...(existing.submissions !== undefined ? { submissions: existing.submissions } : {}),
          ...(existing.attributed !== undefined ? { attributed: existing.attributed } : {}),
        };
        return next;
      });
    },
  };
}

/** @internal test helper — accepts legacy shapes and normalizes on write. */
export function writeCollectionFile(projectRoot: string, file: CollectionFile): void {
  writeState(projectRoot, normalize(file).file);
}

/** @internal test helper — write a metrics record (strips legacy scopes). */
export function writeMetricsMirror(projectRoot: string, metrics: MetricsRecord): void {
  const lean: MetricsRecord = {
    decision: metrics.decision,
    consentVersion: metrics.consentVersion,
    decidedAt: metrics.decidedAt,
    ...(typeof metrics.expiresAt === "number" ? { expiresAt: metrics.expiresAt } : {}),
  };
  updateState(projectRoot, (existing) => ({ ...existing, metrics: lean }));
}

export function hasSubmissionsGrant(file: CollectionFile, nowMs: number = Date.now()): boolean {
  return signal(file, nowMs).submissions === "granted";
}

export function hasScopeConsent(
  file: CollectionFile,
  scope: string,
  nowMs: number = Date.now(),
): boolean {
  if (scope === "usage") {
    return signal(file, nowMs).metrics === "active";
  }
  if (!hasSubmissionsGrant(file, nowMs)) {
    return false;
  }
  return (["feedback", "bug", "feature"] as readonly string[]).includes(scope);
}

export type { SubmissionsRecord };
