/** Typed project policy (content/state.md "Project Policy"). Lives in xbrief/PROJECT.xbrief.json -> plan["x-canonical/policy"]. */

export interface RuntimeAuthority {
  readonly denyPaths: readonly string[];
}

export interface ProjectPolicy {
  readonly allowDirectCommitsToDefault: boolean;
  readonly wipCap: number;
  readonly deliveryBranch: string | null;
  readonly requireHumanMerge: boolean;
  readonly autoDeployOnMerge: boolean;
  readonly runtimeAuthority: RuntimeAuthority;
}

export const POLICY_DEFAULTS: ProjectPolicy = {
  allowDirectCommitsToDefault: false,
  wipCap: 20,
  deliveryBranch: null,
  requireHumanMerge: true,
  autoDeployOnMerge: false,
  runtimeAuthority: { denyPaths: [] },
};

export type PolicyFieldName =
  | "allowDirectCommitsToDefault"
  | "wipCap"
  | "deliveryBranch"
  | "requireHumanMerge"
  | "autoDeployOnMerge"
  | "runtimeAuthority.denyPaths";

export const REGISTERED_POLICY_FIELDS: readonly PolicyFieldName[] = [
  "allowDirectCommitsToDefault",
  "wipCap",
  "deliveryBranch",
  "requireHumanMerge",
  "autoDeployOnMerge",
  "runtimeAuthority.denyPaths",
];

export interface PolicyAuditRecord {
  readonly ts: string;
  readonly field: PolicyFieldName;
  readonly old: unknown;
  readonly new: unknown;
  readonly actor: string;
}

export type PolicyBlock = Partial<Omit<ProjectPolicy, "runtimeAuthority">> & {
  readonly runtimeAuthority?: Partial<RuntimeAuthority>;
};

export interface QualityBlock {
  readonly commands?: readonly string[];
  readonly forwardCoverageRoots?: readonly string[];
}

/** PROJECT.xbrief.json shape: an xBRIEF document whose plan carries the project identity + policy. */
export interface ProjectDoc {
  readonly xBRIEFInfo?: { readonly version?: string; readonly [key: string]: unknown };
  readonly plan?: {
    readonly title?: string;
    readonly status?: string;
    readonly items?: readonly unknown[];
    readonly "x-canonical/policy"?: PolicyBlock;
    readonly "x-canonical/quality"?: QualityBlock;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}
