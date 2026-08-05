/** Typed project policy (content/state.md "Project Policy"). Lives in xbrief/PROJECT.json -> policy.* */

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

/** PROJECT.json shape. */
export interface ProjectBrief {
  readonly title?: string;
  readonly policy?: Partial<Omit<ProjectPolicy, "runtimeAuthority">> & {
    readonly runtimeAuthority?: Partial<RuntimeAuthority>;
  };
  readonly quality?: { readonly commands?: readonly string[] };
}
