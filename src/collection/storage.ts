import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStorage, StoredCredentials } from "@deft/collection-sdk";
import { atomicWriteJson } from "../fs/contained-write.js";
import { COLLECTION_FILE_REL, type CollectionFile, normalize } from "./types.js";
export function readState(projectRoot: string): CollectionFile {
  const path = join(projectRoot, COLLECTION_FILE_REL);
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
    } catch {}
  }
  return file;
}
export function writeState(projectRoot: string, file: CollectionFile): void {
  atomicWriteJson(projectRoot, COLLECTION_FILE_REL, file);
  try {
    chmodSync(join(projectRoot, COLLECTION_FILE_REL), 0o600);
  } catch {}
}
export function updateState(
  projectRoot: string,
  fn: (file: CollectionFile) => CollectionFile,
): CollectionFile {
  const next = fn(readState(projectRoot));
  writeState(projectRoot, next);
  return next;
}
export function credentialStorage(projectRoot: string): CredentialStorage {
  return {
    async load(): Promise<StoredCredentials | null> {
      const file = readState(projectRoot);
      const { installId, token } = file;
      if (
        typeof installId === "string" &&
        installId.length > 0 &&
        typeof token === "string" &&
        token.length > 0
      ) {
        return { installId, token };
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
      updateState(projectRoot, ({ metrics, submissions, attributed }) => ({
        ...(metrics !== undefined ? { metrics } : {}),
        ...(submissions !== undefined ? { submissions } : {}),
        ...(attributed !== undefined ? { attributed } : {}),
      }));
    },
  };
}
