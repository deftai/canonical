/**
 * Universal exit-code contract for every canon verb (content/canonical-tasks.md):
 *   0 = ok/pass, 1 = rejected/not-ready/violation, 2 = misconfig/usage error.
 */
export type GateExitCode = 0 | 1 | 2;

export const GATE_EXIT_OK: GateExitCode = 0;
export const GATE_EXIT_VIOLATION: GateExitCode = 1;
export const GATE_EXIT_CONFIG_ERROR: GateExitCode = 2;

export interface GateResult {
  readonly code: GateExitCode;
  readonly message: string;
}
