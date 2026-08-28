import type { CredentialStorage } from "./types.js";
/** Persists credentials as JSON at `filePath`, mode 0600 (owner read/write only). Missing file
 * reads as "no stored credentials" rather than an error. A leading `~/` (or a bare `~`) is
 * expanded under `os.homedir()`. Writes are atomic: a 0600 temp file is written and fsynced,
 * then renamed onto the target (IMPLEMENTATION §3.4 / SDK-3) — a crash mid-save must never leave
 * a truncated/partial target, since a truncated file reads as "no credentials" and would
 * silently mint and burn a new once-only install token. */
export declare function fileStorage(filePath: string): CredentialStorage;
//# sourceMappingURL=file.d.ts.map