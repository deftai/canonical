/** Seven-value status enum (content/state.md). */
export const SCOPE_STATUSES = [
  "proposed",
  "pending",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export function isScopeStatus(value: unknown): value is ScopeStatus {
  return typeof value === "string" && (SCOPE_STATUSES as readonly string[]).includes(value);
}

/** Lifecycle folder names under xbrief/ (content/state.md Layout). */
export const LIFECYCLE_FOLDERS = [
  "proposed",
  "pending",
  "active",
  "completed",
  "cancelled",
] as const;

export type LifecycleFolder = (typeof LIFECYCLE_FOLDERS)[number];

/** status -> the folder it must live in (content/state.md table). */
export const STATUS_FOLDER_MAP: Readonly<Record<ScopeStatus, LifecycleFolder>> = {
  proposed: "proposed",
  pending: "pending",
  running: "active",
  blocked: "active",
  completed: "completed",
  failed: "completed",
  cancelled: "cancelled",
};

/** folder -> statuses legal inside it. */
export const FOLDER_STATUS_MAP: Readonly<Record<LifecycleFolder, readonly ScopeStatus[]>> = {
  proposed: ["proposed"],
  pending: ["pending"],
  active: ["running", "blocked"],
  completed: ["completed", "failed"],
  cancelled: ["cancelled"],
};

/** Scope filename contract: YYYY-MM-DD-<slug>.json, slug [a-z0-9]+(-[a-z0-9]+)*, <=80 chars. */
export const SCOPE_FILENAME_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/;
export const SCOPE_SLUG_MAX_LENGTH = 80;
