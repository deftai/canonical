/** Finding record emitted by state:validate and reused by scope/triage/swarm gates. */
export interface ValidationFinding {
  /** Path relative to the project root (e.g. "xbrief/active/2026-08-04-foo.json"). */
  readonly file: string;
  /** Stable machine code, e.g. "bad-status", "folder-status-mismatch", "bad-filename". */
  readonly code: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly findings: readonly ValidationFinding[];
  /** Count of scope files examined. */
  readonly scanned: number;
}
