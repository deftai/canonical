import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Anonymous correlator (stored as `userKey` for read-compat) for cross-project
 * install clustering. Passed to the SDK as `CollectorConfig.correlator` — never
 * as `deployment.customer`. Path: `~/.config/canonical/identity.json`.
 */

export interface IdentityFile {
  readonly userKey: string;
}

export interface IdentityOptions {
  /** Override config home (tests). Defaults to `~/.config/canonical`. */
  readonly configDir?: string;
}

/** Correlator charset (CORR-1): lowercase alnum + hyphen, max 64. */
const USER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function defaultConfigDir(): string {
  return join(homedir(), ".config", "canonical");
}

export function identityPath(opts: IdentityOptions = {}): string {
  return join(opts.configDir ?? defaultConfigDir(), "identity.json");
}

function normalizeUserKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return USER_KEY_RE.test(key) ? key : null;
}

function atomicWriteOutsideProject(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
}

/**
 * Load or create the anonymous correlator (`userKey` field). Never throws for
 * expected I/O — returns a fresh in-memory key if persistence fails (caller may
 * still submit; correlation just won't stick across runs until disk works).
 */
export function ensureUserKey(opts: IdentityOptions = {}): string {
  const path = identityPath(opts);
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (parsed !== null && typeof parsed === "object") {
        const raw = (parsed as { userKey?: unknown }).userKey;
        if (typeof raw === "string") {
          const key = normalizeUserKey(raw);
          if (key !== null) {
            return key;
          }
        }
      }
    } catch {
      // fall through to mint
    }
  }

  const userKey = randomUUID().toLowerCase();
  try {
    atomicWriteOutsideProject(
      path,
      `${JSON.stringify({ userKey } satisfies IdentityFile, null, 2)}\n`,
    );
  } catch {
    // disk failed; still return a usable key for this process
  }
  return userKey;
}
